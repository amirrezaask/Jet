//! Long-lived ACP provider connections on the shared Tokio runtime.
//!
//! One OS process + initialized JSON-RPC connection per `(provider, workspace)`.
//! Turns are submitted as jobs; the worker owns initialize once and multiplexes
//! session/new|load + prompt on that connection.

use crate::host::acp::event_pipeline::EventPipeline;
use crate::host::acp::fs_handler::FsHandler;
use crate::host::acp::terminal_handler::TerminalHandler;
use crate::host::acp::types::{NormalizedEvent, TimelineItemKind};
use agent_client_protocol::schema::v1::{
    CancelNotification, ClientCapabilities, ClientSessionCapabilities, ContentBlock, ContentChunk,
    CreateTerminalRequest, FileSystemCapabilities, Implementation, InitializeRequest,
    KillTerminalRequest, LoadSessionRequest, NewSessionRequest, PromptRequest, ReadTextFileRequest,
    ReadTextFileResponse, ReleaseTerminalRequest, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, SessionConfigId, SessionConfigKind,
    SessionConfigOption, SessionConfigOptionCategory, SessionConfigOptionValue,
    SessionConfigOptionsCapabilities, SessionId, SessionNotification, SessionUpdate,
    SetSessionConfigOptionRequest, StopReason, TerminalOutputRequest, TextContent,
    WaitForTerminalExitRequest, WriteTextFileRequest, WriteTextFileResponse,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};
use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, watch};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(120);
const CONFIG_TIMEOUT: Duration = Duration::from_secs(30);
const CANCELLATION_TIMEOUT: Duration = Duration::from_secs(15);

pub struct AcpTurnResult {
    pub session_id: String,
    pub text: String,
    pub stop_reason: StopReason,
}

#[derive(Clone, Debug, Default)]
pub struct InitializedInfo {
    pub auth_required: bool,
    pub supports_list_sessions: bool,
    pub supports_close_session: bool,
}

pub struct TurnJob {
    pub cwd: PathBuf,
    pub prompt: String,
    pub model: Option<String>,
    pub turn_id: String,
    pub existing_session_id: Option<String>,
    pub cancel: watch::Receiver<bool>,
    pub on_session: Arc<dyn Fn(&str) + Send + Sync>,
    pub on_text: Arc<dyn Fn(&str) + Send + Sync>,
    pub on_activity: Arc<dyn Fn(&str) + Send + Sync>,
    pub on_event: Arc<dyn Fn(u64, NormalizedEvent) + Send + Sync>,
    pub on_permission: Arc<
        dyn Fn(RequestPermissionRequest) -> BoxFuture<'static, RequestPermissionOutcome>
            + Send
            + Sync,
    >,
    pub on_initialized: Arc<dyn Fn(InitializedInfo) + Send + Sync>,
    pub respond: oneshot::Sender<Result<AcpTurnResult, String>>,
}

struct SharedHandlers {
    cwd: Mutex<PathBuf>,
    capture: AtomicBool,
    output: Mutex<String>,
    terminal: TerminalHandler,
    on_text: Mutex<Option<Arc<dyn Fn(&str) + Send + Sync>>>,
    on_activity: Mutex<Option<Arc<dyn Fn(&str) + Send + Sync>>>,
    on_event: Mutex<Option<Arc<dyn Fn(u64, NormalizedEvent) + Send + Sync>>>,
    pipeline: Mutex<Option<EventPipeline>>,
    on_permission: Mutex<
        Option<
            Arc<
                dyn Fn(RequestPermissionRequest) -> BoxFuture<'static, RequestPermissionOutcome>
                    + Send
                    + Sync,
            >,
        >,
    >,
}

#[derive(Clone, Default)]
struct ConnectionMeta {
    initialized: InitializedInfo,
}

#[derive(Clone, Default)]
pub struct ConnectionPool {
    workers: Arc<Mutex<HashMap<String, mpsc::Sender<TurnJob>>>>,
    meta: Arc<Mutex<HashMap<String, ConnectionMeta>>>,
}

impl ConnectionPool {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn run_turn(
        &self,
        connection_key: String,
        command: String,
        args: Vec<String>,
        mut job: TurnJob,
    ) -> Result<AcpTurnResult, String> {
        let tx = {
            let mut guard = self
                .workers
                .lock()
                .map_err(|_| "ACP connection pool lock poisoned")?;
            match guard.get(&connection_key) {
                Some(existing) if !existing.is_closed() => existing.clone(),
                _ => {
                    let tx = spawn_long_lived_worker(
                        connection_key.clone(),
                        command,
                        args,
                        self.meta.clone(),
                    );
                    guard.insert(connection_key.clone(), tx.clone());
                    tx
                }
            }
        };
        let (respond_tx, respond_rx) = oneshot::channel();
        job.respond = respond_tx;
        tx.send(job)
            .await
            .map_err(|_| "ACP connection worker stopped".to_string())?;
        respond_rx
            .await
            .map_err(|_| "ACP connection worker dropped response".to_string())?
    }

    pub fn force_stop(&self, connection_key: &str) {
        if let Ok(mut guard) = self.workers.lock() {
            guard.remove(connection_key);
        }
        if let Ok(mut meta) = self.meta.lock() {
            meta.remove(connection_key);
        }
    }

    pub fn connection_meta(&self, connection_key: &str) -> InitializedInfo {
        self.meta
            .lock()
            .ok()
            .and_then(|guard| guard.get(connection_key).map(|meta| meta.initialized.clone()))
            .unwrap_or_default()
    }

    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.workers.lock() {
            guard.clear();
        }
        if let Ok(mut meta) = self.meta.lock() {
            meta.clear();
        }
    }
}

fn spawn_long_lived_worker(
    connection_key: String,
    command: String,
    args: Vec<String>,
    meta: Arc<Mutex<HashMap<String, ConnectionMeta>>>,
) -> mpsc::Sender<TurnJob> {
    let (tx, rx) = mpsc::channel::<TurnJob>(32);
    tokio::spawn(async move {
        if let Err(error) = run_worker(connection_key.clone(), command, args, rx, meta).await {
            tracing::error!(%connection_key, %error, "ACP connection worker failed");
        }
    });
    tx
}

async fn run_worker(
    connection_key: String,
    command: String,
    args: Vec<String>,
    mut rx: mpsc::Receiver<TurnJob>,
    meta: Arc<Mutex<HashMap<String, ConnectionMeta>>>,
) -> Result<(), String> {
    let mut argv = vec![command];
    argv.extend(args);
    let transport = AcpAgent::from_args(argv).map_err(|error| error.to_string())?;
    let first = rx
        .recv()
        .await
        .ok_or_else(|| "ACP connection worker stopped before first turn".to_string())?;
    let on_initialized_first = first.on_initialized.clone();
    let shared = Arc::new(SharedHandlers {
        cwd: Mutex::new(first.cwd.clone()),
        capture: AtomicBool::new(false),
        output: Mutex::new(String::new()),
        terminal: TerminalHandler::new(first.cwd.clone()),
        on_text: Mutex::new(None),
        on_activity: Mutex::new(None),
        on_event: Mutex::new(None),
        pipeline: Mutex::new(None),
        on_permission: Mutex::new(None),
    });
    let shared_notify = shared.clone();
    let shared_perm = shared.clone();
    let shared_fs_read = shared.clone();
    let shared_fs_write = shared.clone();
    let shared_term_create = shared.clone();
    let shared_term_output = shared.clone();
    let shared_term_wait = shared.clone();
    let shared_term_kill = shared.clone();
    let shared_term_release = shared.clone();

    Client
        .builder()
        .name("gharargah")
        .on_receive_notification(
            {
                async move |notification: SessionNotification, _connection| {
                    if !shared_notify.capture.load(Ordering::Acquire) {
                        return Ok(());
                    }
                    handle_session_update(&shared_notify, notification.update);
                    Ok(())
                }
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            {
                async move |request: RequestPermissionRequest, responder, _connection| {
                    let callback = shared_perm
                        .on_permission
                        .lock()
                        .ok()
                        .and_then(|guard| guard.clone());
                    let outcome = match callback {
                        Some(callback) => callback(request).await,
                        None => RequestPermissionOutcome::Cancelled,
                    };
                    responder.respond(RequestPermissionResponse::new(outcome))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                async move |request: ReadTextFileRequest, responder, _connection| {
                    let cwd = shared_fs_read
                        .cwd
                        .lock()
                        .map_err(|_| {
                            agent_client_protocol::util::internal_error("cwd lock poisoned")
                        })?
                        .clone();
                    let handler = FsHandler::new(cwd).map_err(|error| {
                        agent_client_protocol::util::internal_error(error.to_string())
                    })?;
                    let mut content = handler.read_text_file(&request.path).map_err(|error| {
                        agent_client_protocol::util::internal_error(error.to_string())
                    })?;
                    if request.line.is_some() || request.limit.is_some() {
                        let start = request.line.unwrap_or(1).saturating_sub(1) as usize;
                        let limit = request.limit.unwrap_or(u32::MAX) as usize;
                        content = content
                            .lines()
                            .skip(start)
                            .take(limit)
                            .collect::<Vec<_>>()
                            .join("\n");
                    }
                    responder.respond(ReadTextFileResponse::new(content))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                async move |request: WriteTextFileRequest, responder, _connection| {
                    let cwd = shared_fs_write
                        .cwd
                        .lock()
                        .map_err(|_| {
                            agent_client_protocol::util::internal_error("cwd lock poisoned")
                        })?
                        .clone();
                    let handler = FsHandler::new(cwd).map_err(|error| {
                        agent_client_protocol::util::internal_error(error.to_string())
                    })?;
                    handler
                        .write_text_file(&request.path, &request.content)
                        .map_err(|error| {
                            agent_client_protocol::util::internal_error(error.to_string())
                        })?;
                    responder.respond(WriteTextFileResponse::new())
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                async move |request: CreateTerminalRequest, responder, _connection| {
                    let response = shared_term_create.terminal.create(request).map_err(|error| {
                        agent_client_protocol::util::internal_error(error.to_string())
                    })?;
                    responder.respond(response)
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                async move |request: TerminalOutputRequest, responder, _connection| {
                    let response = shared_term_output.terminal.output(request).map_err(|error| {
                        agent_client_protocol::util::internal_error(error.to_string())
                    })?;
                    responder.respond(response)
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                async move |request: WaitForTerminalExitRequest, responder, _connection| {
                    let response = shared_term_wait
                        .terminal
                        .wait_for_exit(request)
                        .await
                        .map_err(|error| {
                            agent_client_protocol::util::internal_error(error.to_string())
                        })?;
                    responder.respond(response)
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                async move |request: KillTerminalRequest, responder, _connection| {
                    let response = shared_term_kill.terminal.kill(request).map_err(|error| {
                        agent_client_protocol::util::internal_error(error.to_string())
                    })?;
                    responder.respond(response)
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            {
                async move |request: ReleaseTerminalRequest, responder, _connection| {
                    let response =
                        shared_term_release
                            .terminal
                            .release(request)
                            .map_err(|error| {
                                agent_client_protocol::util::internal_error(error.to_string())
                            })?;
                    responder.respond(response)
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(transport, async move |connection| {
            tracing::info!(%connection_key, "ACP provider process connected");
            let initialize = InitializeRequest::new(ProtocolVersion::V1)
                .client_capabilities(
                    ClientCapabilities::new()
                        .session(
                            ClientSessionCapabilities::new()
                                .config_options(SessionConfigOptionsCapabilities::new()),
                        )
                        .fs(
                            FileSystemCapabilities::new()
                                .read_text_file(true)
                                .write_text_file(true),
                        )
                        .terminal(true),
                )
                .client_info(
                    Implementation::new("gharargah", env!("CARGO_PKG_VERSION")).title("Gharargah"),
                );
            let initialized = tokio::time::timeout(
                HANDSHAKE_TIMEOUT,
                connection.send_request(initialize).block_task(),
            )
            .await
            .map_err(|_| agent_client_protocol::util::internal_error("ACP initialize timed out"))??;
            if initialized.protocol_version != ProtocolVersion::V1 {
                return Err(agent_client_protocol::util::internal_error(format!(
                    "unsupported ACP protocol version: {:?}",
                    initialized.protocol_version
                )));
            }

            let info = InitializedInfo {
                auth_required: !initialized.auth_methods.is_empty(),
                supports_list_sessions: initialized
                    .agent_capabilities
                    .session_capabilities
                    .list
                    .is_some(),
                supports_close_session: initialized
                    .agent_capabilities
                    .session_capabilities
                    .close
                    .is_some(),
            };
            if let Ok(mut guard) = meta.lock() {
                guard.insert(
                    connection_key.clone(),
                    ConnectionMeta {
                        initialized: info.clone(),
                    },
                );
            }
            on_initialized_first(info);

            let load_session = initialized.agent_capabilities.load_session;
            let mut next = Some(first);
            while let Some(job) = next {
                execute_turn_on_connection(&connection, &shared, job, load_session).await;
                next = rx.recv().await;
            }
            shared.terminal.release_all();
            Ok(())
        })
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn handle_session_update(shared: &SharedHandlers, update: SessionUpdate) {
    match update {
        SessionUpdate::AgentMessageChunk(ContentChunk {
            content: ContentBlock::Text(text),
            ..
        }) => {
            let snapshot = {
                let Ok(mut output) = shared.output.lock() else {
                    return;
                };
                output.push_str(&text.text);
                output.clone()
            };
            if let Some(on_text) = shared.on_text.lock().ok().and_then(|g| g.clone()) {
                on_text(&snapshot);
            }
            if let Ok(mut pipeline) = shared.pipeline.lock() {
                if let Some(pipeline) = pipeline.as_mut() {
                    pipeline.text_delta(&text.text);
                }
            }
        }
        SessionUpdate::AgentThoughtChunk(chunk) => {
            if let Some(on_activity) = shared.on_activity.lock().ok().and_then(|g| g.clone()) {
                on_activity("Thinking…");
            }
            let thought_text = chunk_text(&chunk).unwrap_or_default();
            if let Ok(mut pipeline) = shared.pipeline.lock() {
                if let Some(pipeline) = pipeline.as_mut() {
                    pipeline.timeline(
                        TimelineItemKind::Thought,
                        json!({ "text": thought_text }),
                    );
                }
            }
        }
        SessionUpdate::ToolCall(tool) => {
            let title = tool.title.clone();
            if let Some(on_activity) = shared.on_activity.lock().ok().and_then(|g| g.clone()) {
                on_activity(&format!("Tool: {title}"));
            }
            let payload = serde_json::to_value(&tool).unwrap_or(Value::Null);
            if let Ok(mut pipeline) = shared.pipeline.lock() {
                if let Some(pipeline) = pipeline.as_mut() {
                    pipeline.timeline(TimelineItemKind::ToolCall, payload);
                }
            }
        }
        SessionUpdate::ToolCallUpdate(update) => {
            let title = update
                .fields
                .title
                .clone()
                .unwrap_or_else(|| "tool".to_string());
            if let Some(on_activity) = shared.on_activity.lock().ok().and_then(|g| g.clone()) {
                on_activity(&format!("Tool: {title}"));
            }
            let payload = serde_json::to_value(&update).unwrap_or(Value::Null);
            if let Ok(mut pipeline) = shared.pipeline.lock() {
                if let Some(pipeline) = pipeline.as_mut() {
                    pipeline.timeline(TimelineItemKind::ToolCall, payload);
                }
            }
        }
        SessionUpdate::Plan(plan) => {
            let payload = serde_json::to_value(&plan).unwrap_or(Value::Null);
            if let Ok(mut pipeline) = shared.pipeline.lock() {
                if let Some(pipeline) = pipeline.as_mut() {
                    pipeline.timeline(TimelineItemKind::Plan, payload);
                }
            }
        }
        SessionUpdate::UsageUpdate(usage) => {
            let payload = serde_json::to_value(&usage).unwrap_or(Value::Null);
            if let Ok(mut pipeline) = shared.pipeline.lock() {
                if let Some(pipeline) = pipeline.as_mut() {
                    pipeline.timeline(TimelineItemKind::Usage, payload);
                }
            }
        }
        SessionUpdate::AvailableCommandsUpdate(commands) => {
            let mut payload = serde_json::to_value(&commands).unwrap_or(json!({}));
            if let Some(object) = payload.as_object_mut() {
                object.insert("type".to_string(), json!("commands"));
            } else {
                payload = json!({
                    "type": "commands",
                    "update": payload,
                });
            }
            if let Ok(mut pipeline) = shared.pipeline.lock() {
                if let Some(pipeline) = pipeline.as_mut() {
                    pipeline.timeline(TimelineItemKind::Status, payload);
                }
            }
        }
        SessionUpdate::ConfigOptionUpdate(config) => {
            let mut payload = serde_json::to_value(&config).unwrap_or(json!({}));
            if let Some(object) = payload.as_object_mut() {
                object.insert("type".to_string(), json!("config"));
            } else {
                payload = json!({
                    "type": "config",
                    "update": payload,
                });
            }
            if let Ok(mut pipeline) = shared.pipeline.lock() {
                if let Some(pipeline) = pipeline.as_mut() {
                    pipeline.timeline(TimelineItemKind::Status, payload);
                }
            }
        }
        _ => {}
    }
}

fn chunk_text(chunk: &ContentChunk) -> Option<String> {
    match &chunk.content {
        ContentBlock::Text(text) => Some(text.text.clone()),
        _ => None,
    }
}

async fn execute_turn_on_connection(
    connection: &ConnectionTo<Agent>,
    shared: &Arc<SharedHandlers>,
    job: TurnJob,
    load_session: bool,
) {
    shared.terminal.set_workspace_root(job.cwd.clone());
    if let Ok(mut cwd) = shared.cwd.lock() {
        *cwd = job.cwd.clone();
    }
    if let Ok(mut output) = shared.output.lock() {
        output.clear();
    }
    if let Ok(mut on_text) = shared.on_text.lock() {
        *on_text = Some(job.on_text.clone());
    }
    if let Ok(mut on_activity) = shared.on_activity.lock() {
        *on_activity = Some(job.on_activity.clone());
    }
    if let Ok(mut on_event) = shared.on_event.lock() {
        *on_event = Some(job.on_event.clone());
    }
    if let Ok(mut on_permission) = shared.on_permission.lock() {
        *on_permission = Some(job.on_permission.clone());
    }
    if let Ok(mut pipeline) = shared.pipeline.lock() {
        *pipeline = None;
    }
    shared.capture.store(false, Ordering::Release);

    let TurnJob {
        cwd,
        prompt,
        model,
        turn_id,
        existing_session_id,
        mut cancel,
        on_session,
        on_activity,
        respond,
        ..
    } = job;
    let result = run_prompt(
        connection,
        shared,
        cwd,
        prompt,
        model,
        turn_id,
        existing_session_id,
        &mut cancel,
        on_session,
        on_activity,
        load_session,
    )
    .await;
    let _ = respond.send(result);
}

async fn run_prompt(
    connection: &ConnectionTo<Agent>,
    shared: &Arc<SharedHandlers>,
    cwd: PathBuf,
    prompt: String,
    model: Option<String>,
    turn_id: String,
    existing_session_id: Option<String>,
    cancel: &mut watch::Receiver<bool>,
    on_session: Arc<dyn Fn(&str) + Send + Sync>,
    on_activity: Arc<dyn Fn(&str) + Send + Sync>,
    load_session: bool,
) -> Result<AcpTurnResult, String> {
    let (session_id, config) = if let Some(existing) =
        existing_session_id.clone().filter(|_| load_session)
    {
        let request = LoadSessionRequest::new(existing.clone(), cwd.clone());
        match tokio::time::timeout(HANDSHAKE_TIMEOUT, connection.send_request(request).block_task())
            .await
        {
            Ok(Ok(response)) => (SessionId::new(existing), response.config_options),
            Ok(Err(error)) => return Err(format!("ACP session/load failed: {error}")),
            Err(_) => return Err("ACP session/load timed out".to_string()),
        }
    } else {
        let response = tokio::time::timeout(
            HANDSHAKE_TIMEOUT,
            connection
                .send_request(NewSessionRequest::new(cwd))
                .block_task(),
        )
        .await
        .map_err(|_| "ACP session creation timed out".to_string())?
        .map_err(|error| error.to_string())?;
        (response.session_id, response.config_options)
    };
    on_session(session_id.0.as_ref());

    let on_event = shared
        .on_event
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
        .unwrap_or_else(|| Arc::new(|_, _| {}));
    if let Ok(mut pipeline) = shared.pipeline.lock() {
        *pipeline = Some(EventPipeline::new(
            session_id.0.to_string(),
            turn_id,
            move |sequence, event| on_event(sequence, event),
        ));
    }

    // Model switch via ACP session config (category=model). Soft-fail so a
    // missing/unsupported option never kills an otherwise healthy turn.
    if let Err(error) =
        apply_session_model(connection, &session_id, config.as_deref(), model.as_deref()).await
    {
        on_activity(&format!("Model switch skipped: {error}"));
    }

    shared.capture.store(true, Ordering::Release);

    if *cancel.borrow() {
        shared.capture.store(false, Ordering::Release);
        flush_and_clear_pipeline(shared);
        return Ok(AcpTurnResult {
            session_id: session_id.0.to_string(),
            text: shared.output.lock().map(|g| g.clone()).unwrap_or_default(),
            stop_reason: StopReason::Cancelled,
        });
    }

    let prompt = PromptRequest::new(
        session_id.clone(),
        vec![ContentBlock::Text(TextContent::new(prompt))],
    );
    let prompt_request = connection.send_request(prompt).block_task();
    tokio::pin!(prompt_request);
    let mut cancellation_sent = false;
    let cancellation_deadline = tokio::time::sleep(CANCELLATION_TIMEOUT);
    tokio::pin!(cancellation_deadline);
    let response = loop {
        tokio::select! {
            response = &mut prompt_request => break response.map_err(|error| format!("ACP prompt failed: {error}"))?,
            changed = cancel.changed(), if !cancellation_sent => {
                if changed.is_err() || *cancel.borrow() {
                    let _ = connection.send_notification(CancelNotification::new(session_id.clone()));
                    cancellation_sent = true;
                    cancellation_deadline.as_mut().reset(
                        tokio::time::Instant::now() + CANCELLATION_TIMEOUT,
                    );
                }
            }
            _ = &mut cancellation_deadline, if cancellation_sent => {
                flush_and_clear_pipeline(shared);
                return Err("provider_unresponsive_after_cancel".to_string());
            }
        }
    };
    shared.capture.store(false, Ordering::Release);
    flush_and_clear_pipeline(shared);
    Ok(AcpTurnResult {
        session_id: session_id.0.to_string(),
        text: shared.output.lock().map(|g| g.clone()).unwrap_or_default(),
        stop_reason: response.stop_reason,
    })
}

fn flush_and_clear_pipeline(shared: &SharedHandlers) {
    if let Ok(mut pipeline) = shared.pipeline.lock() {
        if let Some(pipeline) = pipeline.as_mut() {
            pipeline.flush_text();
        }
        *pipeline = None;
    }
}

fn model_config_option(options: &[SessionConfigOption]) -> Option<&SessionConfigOption> {
    options
        .iter()
        .find(|option| matches!(option.category, Some(SessionConfigOptionCategory::Model)))
        .or_else(|| {
            options.iter().find(|option| {
                option.id.0.as_ref().eq_ignore_ascii_case("model")
                    || option.name.eq_ignore_ascii_case("model")
            })
        })
}

fn select_has_value(kind: &SessionConfigKind, value: &str) -> bool {
    match kind {
        SessionConfigKind::Select(select) => match &select.options {
            agent_client_protocol::schema::v1::SessionConfigSelectOptions::Ungrouped(options) => {
                options
                    .iter()
                    .any(|option| option.value.0.as_ref() == value)
            }
            agent_client_protocol::schema::v1::SessionConfigSelectOptions::Grouped(groups) => {
                groups
                    .iter()
                    .flat_map(|group| group.options.iter())
                    .any(|option| option.value.0.as_ref() == value)
            }
            _ => false,
        },
        _ => false,
    }
}

async fn apply_session_model(
    connection: &ConnectionTo<Agent>,
    session_id: &SessionId,
    config_options: Option<&[SessionConfigOption]>,
    model: Option<&str>,
) -> Result<(), String> {
    let Some(model) = model.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(());
    };
    let Some(options) = config_options.filter(|items| !items.is_empty()) else {
        return Ok(());
    };
    let Some(option) = model_config_option(options) else {
        return Ok(());
    };
    if matches!(&option.kind, SessionConfigKind::Select(_))
        && !select_has_value(&option.kind, model)
    {
        // Unknown slug — skip rather than fail the turn. Catalog may be ahead of agent.
        return Ok(());
    }
    let request = SetSessionConfigOptionRequest::new(
        session_id.clone(),
        SessionConfigId::new(option.id.0.as_ref()),
        SessionConfigOptionValue::value_id(model.to_string()),
    );
    tokio::time::timeout(
        CONFIG_TIMEOUT,
        connection.send_request(request).block_task(),
    )
    .await
    .map_err(|_| "ACP session/set_config_option timed out".to_string())?
    .map_err(|error| error.to_string())?;
    Ok(())
}
