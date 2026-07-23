//! Long-lived ACP provider connections on the shared Tokio runtime.
//!
//! One OS process + initialized JSON-RPC connection per `(provider, workspace)`.
//! Sessions are multiplexed concurrently; turns within one session are exclusive.

use crate::host::acp::fs_handler::FsHandler;
use crate::host::acp::session_runtime::SessionRuntime;
use crate::host::acp::terminal_handler::TerminalHandler;
use crate::host::acp::types::{NormalizedEvent, StopReason as LocalStopReason};
use agent_client_protocol::schema::v1::{
    AuthenticateRequest, CancelNotification, ClientCapabilities, ClientSessionCapabilities,
    CloseSessionRequest, ContentBlock, CreateTerminalRequest, DeleteSessionRequest,
    FileSystemCapabilities, Implementation, InitializeRequest, KillTerminalRequest,
    ListSessionsRequest, LoadSessionRequest, LogoutRequest, NewSessionRequest, PromptRequest,
    ReadTextFileRequest, ReadTextFileResponse, ReleaseTerminalRequest, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, ResumeSessionRequest, SessionConfigId,
    SessionConfigKind, SessionConfigOption, SessionConfigOptionCategory, SessionConfigOptionValue,
    SessionConfigOptionsCapabilities, SessionId, SessionNotification, SetSessionConfigOptionRequest,
    StopReason, TerminalOutputRequest, TextContent, WaitForTerminalExitRequest, WriteTextFileRequest,
    WriteTextFileResponse,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};
use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
    pub auth_method_ids: Vec<String>,
    pub supports_list_sessions: bool,
    pub supports_close_session: bool,
    pub supports_delete_session: bool,
    pub supports_resume_session: bool,
    pub supports_load_session: bool,
    pub supports_logout: bool,
    pub supports_additional_directories: bool,
}

pub struct TurnJob {
    pub cwd: PathBuf,
    pub prompt: String,
    pub model: Option<String>,
    pub turn_id: String,
    pub existing_session_id: Option<String>,
    /// Prefer resume over load when local timeline already exists.
    pub prefer_resume: bool,
    /// Seed EventPipeline from persisted thread sequence.
    pub initial_sequence: u64,
    /// Shared monotonic allocator (same Arc as SessionRuntime.sequence).
    pub sequence: Arc<AtomicU64>,
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

enum WorkerCmd {
    Turn(TurnJob),
    Authenticate {
        method_id: String,
        respond: oneshot::Sender<Result<(), String>>,
    },
    ListSessions {
        cwd: Option<PathBuf>,
        cursor: Option<String>,
        respond: oneshot::Sender<Result<Value, String>>,
    },
    CloseSession {
        session_id: String,
        respond: oneshot::Sender<Result<(), String>>,
    },
    DeleteSession {
        session_id: String,
        respond: oneshot::Sender<Result<(), String>>,
    },
    Logout {
        respond: oneshot::Sender<Result<(), String>>,
    },
    Shutdown,
}

#[derive(Clone, Default)]
struct ConnectionMeta {
    initialized: InitializedInfo,
    generation: u64,
    process_id: Option<u32>,
}

struct ConnShared {
    generation: AtomicU64,
    sessions: Mutex<HashMap<String, Arc<SessionRuntime>>>,
    terminal: TerminalHandler,
    auth_required: AtomicBool,
    caps: Mutex<InitializedInfo>,
}

impl ConnShared {
    fn session(&self, session_id: &str) -> Option<Arc<SessionRuntime>> {
        self.sessions
            .lock()
            .ok()
            .and_then(|guard| guard.get(session_id).cloned())
    }

    fn insert_session(&self, runtime: Arc<SessionRuntime>) {
        if let Ok(mut guard) = self.sessions.lock() {
            guard.insert(runtime.session_id.clone(), runtime);
        }
    }

    fn remove_session(&self, session_id: &str) {
        if let Ok(mut guard) = self.sessions.lock() {
            guard.remove(session_id);
        }
    }

    fn settle_all_permissions_cancelled(&self) {
        // Permission waiters live in the supervisor; session runtimes clear callbacks.
        if let Ok(guard) = self.sessions.lock() {
            for runtime in guard.values() {
                if let Ok(mut slot) = runtime.on_permission.lock() {
                    *slot = None;
                }
                runtime.capture.store(false, Ordering::Release);
                runtime.turn_busy.store(false, Ordering::Release);
            }
        }
    }
}

struct WorkerHandle {
    tx: mpsc::Sender<WorkerCmd>,
    shutdown: watch::Sender<bool>,
}

#[derive(Clone, Default)]
pub struct ConnectionPool {
    workers: Arc<Mutex<HashMap<String, WorkerHandle>>>,
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
        let tx = self.ensure_worker(connection_key, command, args)?;
        let (respond_tx, respond_rx) = oneshot::channel();
        job.respond = respond_tx;
        tx.send(WorkerCmd::Turn(job))
            .await
            .map_err(|_| "ACP connection worker stopped".to_string())?;
        respond_rx
            .await
            .map_err(|_| "ACP connection worker dropped response".to_string())?
    }

    pub async fn authenticate(
        &self,
        connection_key: &str,
        method_id: String,
    ) -> Result<(), String> {
        let tx = self
            .workers
            .lock()
            .map_err(|_| "ACP connection pool lock poisoned")?
            .get(connection_key)
            .map(|handle| handle.tx.clone())
            .ok_or_else(|| "ACP connection not started".to_string())?;
        let (respond_tx, respond_rx) = oneshot::channel();
        tx.send(WorkerCmd::Authenticate {
            method_id,
            respond: respond_tx,
        })
        .await
        .map_err(|_| "ACP connection worker stopped".to_string())?;
        respond_rx
            .await
            .map_err(|_| "ACP authenticate dropped".to_string())?
    }

    pub async fn list_sessions(
        &self,
        connection_key: &str,
        cwd: Option<PathBuf>,
        cursor: Option<String>,
    ) -> Result<Value, String> {
        let tx = self
            .workers
            .lock()
            .map_err(|_| "ACP connection pool lock poisoned")?
            .get(connection_key)
            .map(|handle| handle.tx.clone())
            .ok_or_else(|| "ACP connection not started".to_string())?;
        let (respond_tx, respond_rx) = oneshot::channel();
        tx.send(WorkerCmd::ListSessions {
            cwd,
            cursor,
            respond: respond_tx,
        })
        .await
        .map_err(|_| "ACP connection worker stopped".to_string())?;
        respond_rx
            .await
            .map_err(|_| "ACP list_sessions dropped".to_string())?
    }

    pub async fn close_session(
        &self,
        connection_key: &str,
        session_id: String,
    ) -> Result<(), String> {
        let tx = self
            .workers
            .lock()
            .map_err(|_| "ACP connection pool lock poisoned")?
            .get(connection_key)
            .map(|handle| handle.tx.clone())
            .ok_or_else(|| "ACP connection not started".to_string())?;
        let (respond_tx, respond_rx) = oneshot::channel();
        tx.send(WorkerCmd::CloseSession {
            session_id,
            respond: respond_tx,
        })
        .await
        .map_err(|_| "ACP connection worker stopped".to_string())?;
        respond_rx
            .await
            .map_err(|_| "ACP close_session dropped".to_string())?
    }

    pub async fn delete_session(
        &self,
        connection_key: &str,
        session_id: String,
    ) -> Result<(), String> {
        let tx = self
            .workers
            .lock()
            .map_err(|_| "ACP connection pool lock poisoned")?
            .get(connection_key)
            .map(|handle| handle.tx.clone())
            .ok_or_else(|| "ACP connection not started".to_string())?;
        let (respond_tx, respond_rx) = oneshot::channel();
        tx.send(WorkerCmd::DeleteSession {
            session_id,
            respond: respond_tx,
        })
        .await
        .map_err(|_| "ACP connection worker stopped".to_string())?;
        respond_rx
            .await
            .map_err(|_| "ACP delete_session dropped".to_string())?
    }

    pub async fn logout(&self, connection_key: &str) -> Result<(), String> {
        let tx = self
            .workers
            .lock()
            .map_err(|_| "ACP connection pool lock poisoned")?
            .get(connection_key)
            .map(|handle| handle.tx.clone())
            .ok_or_else(|| "ACP connection not started".to_string())?;
        let (respond_tx, respond_rx) = oneshot::channel();
        tx.send(WorkerCmd::Logout {
            respond: respond_tx,
        })
        .await
        .map_err(|_| "ACP connection worker stopped".to_string())?;
        respond_rx
            .await
            .map_err(|_| "ACP logout dropped".to_string())?
    }

    fn ensure_worker(
        &self,
        connection_key: String,
        command: String,
        args: Vec<String>,
    ) -> Result<mpsc::Sender<WorkerCmd>, String> {
        let mut guard = self
            .workers
            .lock()
            .map_err(|_| "ACP connection pool lock poisoned")?;
        if let Some(existing) = guard.get(&connection_key) {
            if !existing.tx.is_closed() {
                return Ok(existing.tx.clone());
            }
        }
        let handle = spawn_long_lived_worker(connection_key.clone(), command, args, self.meta.clone());
        let tx = handle.tx.clone();
        guard.insert(connection_key, handle);
        Ok(tx)
    }

    pub fn force_stop(&self, connection_key: &str) {
        let handle = self
            .workers
            .lock()
            .ok()
            .and_then(|mut guard| guard.remove(connection_key));
        if let Some(handle) = handle {
            let _ = handle.shutdown.send(true);
            let _ = handle.tx.try_send(WorkerCmd::Shutdown);
        }
        if let Ok(mut meta) = self.meta.lock() {
            if let Some(record) = meta.get_mut(connection_key) {
                record.generation = record.generation.saturating_add(1);
                record.process_id = None;
            }
        }
    }

    pub fn connection_meta(&self, connection_key: &str) -> InitializedInfo {
        self.meta
            .lock()
            .ok()
            .and_then(|guard| guard.get(connection_key).map(|meta| meta.initialized.clone()))
            .unwrap_or_default()
    }

    pub fn generation(&self, connection_key: &str) -> u64 {
        self.meta
            .lock()
            .ok()
            .and_then(|guard| guard.get(connection_key).map(|meta| meta.generation))
            .unwrap_or(0)
    }

    pub fn process_id(&self, connection_key: &str) -> Option<u32> {
        self.meta
            .lock()
            .ok()
            .and_then(|guard| guard.get(connection_key).and_then(|meta| meta.process_id))
    }

    pub fn shutdown(&self) {
        let keys: Vec<String> = self
            .workers
            .lock()
            .ok()
            .map(|guard| guard.keys().cloned().collect())
            .unwrap_or_default();
        for key in keys {
            self.force_stop(&key);
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
) -> WorkerHandle {
    let (tx, rx) = mpsc::channel::<WorkerCmd>(64);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    tokio::spawn(async move {
        if let Err(error) =
            run_worker(connection_key.clone(), command, args, rx, shutdown_rx, meta).await
        {
            tracing::error!(%connection_key, %error, "ACP connection worker failed");
        }
    });
    WorkerHandle {
        tx,
        shutdown: shutdown_tx,
    }
}

async fn run_worker(
    connection_key: String,
    command: String,
    args: Vec<String>,
    mut rx: mpsc::Receiver<WorkerCmd>,
    mut shutdown_rx: watch::Receiver<bool>,
    meta: Arc<Mutex<HashMap<String, ConnectionMeta>>>,
) -> Result<(), String> {
    let mut argv = vec![command];
    argv.extend(args);
    let transport = AcpAgent::from_args(argv).map_err(|error| error.to_string())?;

    let first = loop {
        tokio::select! {
            changed = shutdown_rx.changed() => {
                if changed.is_err() || *shutdown_rx.borrow() {
                    return Ok(());
                }
            }
            cmd = rx.recv() => {
                match cmd {
                    Some(WorkerCmd::Turn(job)) => break job,
                    Some(WorkerCmd::Shutdown) | None => return Ok(()),
                    Some(other) => {
                        reject_cmd_without_connection(other);
                    }
                }
            }
        }
    };
    let on_initialized_first = first.on_initialized.clone();
    let generation = {
        let mut guard = meta.lock().map_err(|_| "meta lock poisoned")?;
        let record = guard.entry(connection_key.clone()).or_default();
        record.generation = record.generation.saturating_add(1);
        record.generation
    };

    let shared = Arc::new(ConnShared {
        generation: AtomicU64::new(generation),
        sessions: Mutex::new(HashMap::new()),
        terminal: TerminalHandler::new(first.cwd.clone()),
        auth_required: AtomicBool::new(false),
        caps: Mutex::new(InitializedInfo::default()),
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
                    let session_id = notification.session_id.0.to_string();
                    match shared_notify.session(&session_id) {
                        Some(runtime) => runtime.handle_update(notification.update),
                        None => {
                            tracing::debug!(
                                %session_id,
                                "ACP update for unknown session (dropped)"
                            );
                        }
                    }
                    Ok(())
                }
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            {
                async move |request: RequestPermissionRequest, responder, _connection| {
                    let session_id = request.session_id.0.to_string();
                    let callback = shared_perm
                        .session(&session_id)
                        .and_then(|runtime| {
                            runtime
                                .on_permission
                                .lock()
                                .ok()
                                .and_then(|guard| guard.clone())
                        });
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
                        .session(request.session_id.0.as_ref())
                        .map(|runtime| runtime.cwd())
                        .ok_or_else(|| {
                            agent_client_protocol::util::internal_error("unknown ACP session")
                        })?;
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
                        .session(request.session_id.0.as_ref())
                        .map(|runtime| runtime.cwd())
                        .ok_or_else(|| {
                            agent_client_protocol::util::internal_error("unknown ACP session")
                        })?;
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
                    if let Some(runtime) = shared_term_create.session(request.session_id.0.as_ref())
                    {
                        shared_term_create
                            .terminal
                            .set_workspace_root(runtime.cwd());
                    }
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

            let session_caps = &initialized.agent_capabilities.session_capabilities;
            let info = InitializedInfo {
                auth_required: !initialized.auth_methods.is_empty(),
                auth_method_ids: initialized
                    .auth_methods
                    .iter()
                    .map(|method| method.id().0.to_string())
                    .collect(),
                supports_list_sessions: session_caps.list.is_some(),
                supports_close_session: session_caps.close.is_some(),
                supports_delete_session: session_caps.delete.is_some(),
                supports_resume_session: session_caps.resume.is_some(),
                supports_load_session: initialized.agent_capabilities.load_session,
                supports_logout: initialized.agent_capabilities.auth.logout.is_some(),
                supports_additional_directories: session_caps.additional_directories.is_some(),
            };
            shared.auth_required.store(info.auth_required, Ordering::Release);
            if let Ok(mut caps) = shared.caps.lock() {
                *caps = info.clone();
            }
            if let Ok(mut guard) = meta.lock() {
                let record = guard.entry(connection_key.clone()).or_default();
                record.initialized = info.clone();
            }
            on_initialized_first(info.clone());

            let mut inflight = tokio::task::JoinSet::new();
            let mut pending = Some(WorkerCmd::Turn(first));
            loop {
                if *shutdown_rx.borrow() {
                    shared.settle_all_permissions_cancelled();
                    break;
                }
                let cmd = if let Some(cmd) = pending.take() {
                    Some(cmd)
                } else {
                    tokio::select! {
                        changed = shutdown_rx.changed() => {
                            if changed.is_err() || *shutdown_rx.borrow() {
                                shared.settle_all_permissions_cancelled();
                                break;
                            }
                            None
                        }
                        cmd = rx.recv() => cmd,
                    }
                };
                let Some(cmd) = cmd else {
                    if *shutdown_rx.borrow() {
                        break;
                    }
                    continue;
                };
                match cmd {
                    WorkerCmd::Shutdown => {
                        shared.settle_all_permissions_cancelled();
                        break;
                    }
                    WorkerCmd::Turn(job) => {
                        let connection = connection.clone();
                        let shared = shared.clone();
                        let caps = info.clone();
                        inflight.spawn(async move {
                            execute_turn_on_connection(&connection, &shared, job, &caps).await;
                        });
                    }
                    WorkerCmd::Authenticate { method_id, respond } => {
                        let result = tokio::time::timeout(
                            HANDSHAKE_TIMEOUT,
                            connection
                                .send_request(AuthenticateRequest::new(method_id))
                                .block_task(),
                        )
                        .await;
                        let mapped = match result {
                            Ok(Ok(_)) => {
                                shared.auth_required.store(false, Ordering::Release);
                                Ok(())
                            }
                            Ok(Err(error)) => Err(format!("authenticate failed: {error}")),
                            Err(_) => Err("authenticate timed out".to_string()),
                        };
                        let _ = respond.send(mapped);
                    }
                    WorkerCmd::ListSessions {
                        cwd,
                        cursor,
                        respond,
                    } => {
                        if !info.supports_list_sessions {
                            let _ = respond.send(Err("unsupported_capability".to_string()));
                            continue;
                        }
                        let mut request = ListSessionsRequest::new();
                        if let Some(cwd) = cwd {
                            request = request.cwd(cwd);
                        }
                        if let Some(cursor) = cursor {
                            request = request.cursor(cursor);
                        }
                        let result = tokio::time::timeout(
                            HANDSHAKE_TIMEOUT,
                            connection.send_request(request).block_task(),
                        )
                        .await;
                        let mapped = match result {
                            Ok(Ok(response)) => Ok(serde_json::to_value(response)
                                .unwrap_or(json!({"sessions":[]}))),
                            Ok(Err(error)) => Err(format!("session/list failed: {error}")),
                            Err(_) => Err("session/list timed out".to_string()),
                        };
                        let _ = respond.send(mapped);
                    }
                    WorkerCmd::CloseSession {
                        session_id,
                        respond,
                    } => {
                        if !info.supports_close_session {
                            let _ = respond.send(Err("unsupported_capability".to_string()));
                            continue;
                        }
                        let result = tokio::time::timeout(
                            HANDSHAKE_TIMEOUT,
                            connection
                                .send_request(CloseSessionRequest::new(session_id.clone()))
                                .block_task(),
                        )
                        .await;
                        let mapped = match result {
                            Ok(Ok(_)) => {
                                shared.remove_session(&session_id);
                                Ok(())
                            }
                            Ok(Err(error)) => Err(format!("session/close failed: {error}")),
                            Err(_) => Err("session/close timed out".to_string()),
                        };
                        let _ = respond.send(mapped);
                    }
                    WorkerCmd::DeleteSession {
                        session_id,
                        respond,
                    } => {
                        if !info.supports_delete_session {
                            let _ = respond.send(Err("unsupported_capability".to_string()));
                            continue;
                        }
                        let result = tokio::time::timeout(
                            HANDSHAKE_TIMEOUT,
                            connection
                                .send_request(DeleteSessionRequest::new(session_id.clone()))
                                .block_task(),
                        )
                        .await;
                        let mapped = match result {
                            Ok(Ok(_)) => {
                                shared.remove_session(&session_id);
                                Ok(())
                            }
                            Ok(Err(error)) => Err(format!("session/delete failed: {error}")),
                            Err(_) => Err("session/delete timed out".to_string()),
                        };
                        let _ = respond.send(mapped);
                    }
                    WorkerCmd::Logout { respond } => {
                        if !info.supports_logout {
                            let _ = respond.send(Err("unsupported_capability".to_string()));
                            continue;
                        }
                        let result = tokio::time::timeout(
                            HANDSHAKE_TIMEOUT,
                            connection.send_request(LogoutRequest::new()).block_task(),
                        )
                        .await;
                        let mapped = match result {
                            Ok(Ok(_)) => {
                                shared.auth_required.store(true, Ordering::Release);
                                Ok(())
                            }
                            Ok(Err(error)) => Err(format!("logout failed: {error}")),
                            Err(_) => Err("logout timed out".to_string()),
                        };
                        let _ = respond.send(mapped);
                    }
                }
            }
            while inflight.join_next().await.is_some() {}
            shared.terminal.release_all();
            Ok(())
        })
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn reject_cmd_without_connection(cmd: WorkerCmd) {
    match cmd {
        WorkerCmd::Authenticate { respond, .. } => {
            let _ = respond.send(Err("ACP connection not ready".to_string()));
        }
        WorkerCmd::ListSessions { respond, .. } => {
            let _ = respond.send(Err("ACP connection not ready".to_string()));
        }
        WorkerCmd::CloseSession { respond, .. } | WorkerCmd::DeleteSession { respond, .. } => {
            let _ = respond.send(Err("ACP connection not ready".to_string()));
        }
        WorkerCmd::Logout { respond } => {
            let _ = respond.send(Err("ACP connection not ready".to_string()));
        }
        WorkerCmd::Turn(job) => {
            let _ = job
                .respond
                .send(Err("ACP connection not ready".to_string()));
        }
        WorkerCmd::Shutdown => {}
    }
}

async fn execute_turn_on_connection(
    connection: &ConnectionTo<Agent>,
    shared: &Arc<ConnShared>,
    job: TurnJob,
    caps: &InitializedInfo,
) {
    let TurnJob {
        cwd,
        prompt,
        model,
        turn_id,
        existing_session_id,
        prefer_resume,
        initial_sequence,
        sequence,
        mut cancel,
        on_session,
        on_text,
        on_activity,
        on_event,
        on_permission,
        respond,
        ..
    } = job;

    if shared.auth_required.load(Ordering::Acquire) {
        let _ = respond.send(Err("authentication_required".to_string()));
        return;
    }

    let _ = initial_sequence; // sequence Arc is already seeded
    let result = run_prompt(
        connection,
        shared,
        cwd,
        prompt,
        model,
        turn_id,
        existing_session_id,
        prefer_resume,
        sequence,
        &mut cancel,
        on_session,
        on_text,
        on_activity,
        on_event,
        on_permission,
        caps,
    )
    .await;
    let _ = respond.send(result);
}

async fn run_prompt(
    connection: &ConnectionTo<Agent>,
    shared: &Arc<ConnShared>,
    cwd: PathBuf,
    prompt: String,
    model: Option<String>,
    turn_id: String,
    existing_session_id: Option<String>,
    prefer_resume: bool,
    sequence: Arc<AtomicU64>,
    cancel: &mut watch::Receiver<bool>,
    on_session: Arc<dyn Fn(&str) + Send + Sync>,
    on_text: Arc<dyn Fn(&str) + Send + Sync>,
    on_activity: Arc<dyn Fn(&str) + Send + Sync>,
    on_event: Arc<dyn Fn(u64, NormalizedEvent) + Send + Sync>,
    on_permission: Arc<
        dyn Fn(RequestPermissionRequest) -> BoxFuture<'static, RequestPermissionOutcome>
            + Send
            + Sync,
    >,
    caps: &InitializedInfo,
) -> Result<AcpTurnResult, String> {
    shared.terminal.set_workspace_root(cwd.clone());
    let generation = shared.generation.load(Ordering::Acquire);

    let (session_id, config) = if let Some(existing) = existing_session_id.clone() {
        restore_session(
            connection,
            shared,
            existing,
            cwd.clone(),
            prefer_resume,
            sequence.clone(),
            generation,
            caps,
            on_text.clone(),
            on_activity.clone(),
            on_event.clone(),
            on_permission.clone(),
        )
        .await?
    } else {
        let response = tokio::time::timeout(
            HANDSHAKE_TIMEOUT,
            connection
                .send_request(NewSessionRequest::new(cwd.clone()))
                .block_task(),
        )
        .await
        .map_err(|_| "ACP session creation timed out".to_string())?
        .map_err(|error| error.to_string())?;
        let session_id = response.session_id;
        let runtime = Arc::new(SessionRuntime::new(
            session_id.0.to_string(),
            cwd.clone(),
            sequence.clone(),
            generation,
        ));
        runtime.install_turn_callbacks(
            on_text.clone(),
            on_activity.clone(),
            on_event.clone(),
            on_permission.clone(),
        );
        shared.insert_session(runtime);
        (session_id, response.config_options)
    };

    let runtime = shared
        .session(session_id.0.as_ref())
        .ok_or_else(|| "session runtime missing after create/restore".to_string())?;

    if runtime
        .turn_busy
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(format!(
            "turn already running for session {}",
            session_id.0
        ));
    }

    on_session(session_id.0.as_ref());
    runtime.clear_output();
    runtime.install_turn_callbacks(on_text, on_activity, on_event, on_permission);
    if let Ok(mut thought) = runtime.thought_stream_id.lock() {
        *thought = None;
    }
    runtime.begin_pipeline(turn_id);
    runtime.replaying.store(false, Ordering::Release);
    runtime.capture.store(true, Ordering::Release);

    if let Err(error) =
        apply_session_model(connection, &session_id, config.as_deref(), model.as_deref()).await
    {
        // Soft-fail model switch.
        if let Some(on_activity) = runtime.on_activity.lock().ok().and_then(|g| g.clone()) {
            on_activity(&format!("Model switch skipped: {error}"));
        }
    }

    let turn_result = async {
        if *cancel.borrow() {
            let _ = connection.send_notification(CancelNotification::new(session_id.clone()));
            return Ok(AcpTurnResult {
                session_id: session_id.0.to_string(),
                text: runtime.output_snapshot(),
                stop_reason: StopReason::Cancelled,
            });
        }

        let prompt_req = PromptRequest::new(
            session_id.clone(),
            vec![ContentBlock::Text(TextContent::new(prompt))],
        );
        let prompt_request = connection.send_request(prompt_req).block_task();
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
                    return Err("provider_unresponsive_after_cancel".to_string());
                }
            }
        };
        Ok(AcpTurnResult {
            session_id: session_id.0.to_string(),
            text: runtime.output_snapshot(),
            stop_reason: response.stop_reason,
        })
    }
    .await;

    runtime.capture.store(false, Ordering::Release);
    runtime.flush_and_clear_pipeline();
    runtime.turn_busy.store(false, Ordering::Release);
    turn_result
}

async fn restore_session(
    connection: &ConnectionTo<Agent>,
    shared: &Arc<ConnShared>,
    existing: String,
    cwd: PathBuf,
    prefer_resume: bool,
    sequence: Arc<AtomicU64>,
    generation: u64,
    caps: &InitializedInfo,
    on_text: Arc<dyn Fn(&str) + Send + Sync>,
    on_activity: Arc<dyn Fn(&str) + Send + Sync>,
    on_event: Arc<dyn Fn(u64, NormalizedEvent) + Send + Sync>,
    on_permission: Arc<
        dyn Fn(RequestPermissionRequest) -> BoxFuture<'static, RequestPermissionOutcome>
            + Send
            + Sync,
    >,
) -> Result<(SessionId, Option<Vec<SessionConfigOption>>), String> {
    let runtime = shared.session(&existing).unwrap_or_else(|| {
        let runtime = Arc::new(SessionRuntime::new(
            existing.clone(),
            cwd.clone(),
            sequence.clone(),
            generation,
        ));
        shared.insert_session(runtime.clone());
        runtime
    });
    runtime.set_cwd(cwd.clone());
    runtime.install_turn_callbacks(on_text, on_activity, on_event, on_permission);

    let use_resume = prefer_resume && caps.supports_resume_session;
    if use_resume {
        runtime.replaying.store(false, Ordering::Release);
        runtime.capture.store(true, Ordering::Release);
        let request = ResumeSessionRequest::new(existing.clone(), cwd.clone());
        match tokio::time::timeout(HANDSHAKE_TIMEOUT, connection.send_request(request).block_task())
            .await
        {
            Ok(Ok(response)) => {
                return Ok((SessionId::new(existing), response.config_options));
            }
            Ok(Err(error)) => return Err(format!("session_resume_failed: {error}")),
            Err(_) => return Err("session_resume_failed: timed out".to_string()),
        }
    }

    if !caps.supports_load_session {
        if caps.supports_resume_session {
            runtime.replaying.store(false, Ordering::Release);
            runtime.capture.store(true, Ordering::Release);
            let request = ResumeSessionRequest::new(existing.clone(), cwd.clone());
            return match tokio::time::timeout(
                HANDSHAKE_TIMEOUT,
                connection.send_request(request).block_task(),
            )
            .await
            {
                Ok(Ok(response)) => Ok((SessionId::new(existing), response.config_options)),
                Ok(Err(error)) => Err(format!("session_resume_failed: {error}")),
                Err(_) => Err("session_resume_failed: timed out".to_string()),
            };
        }
        return Err("session_restore_unsupported".to_string());
    }

    // Register routing + capture BEFORE load so replay updates are kept.
    runtime.begin_pipeline(format!("{existing}:load"));
    runtime.replaying.store(true, Ordering::Release);
    runtime.capture.store(true, Ordering::Release);
    let request = LoadSessionRequest::new(existing.clone(), cwd);
    match tokio::time::timeout(HANDSHAKE_TIMEOUT, connection.send_request(request).block_task())
        .await
    {
        Ok(Ok(response)) => {
            // Flush replay into the event stream before the prompt turn starts.
            runtime.flush_and_clear_pipeline();
            runtime.replaying.store(false, Ordering::Release);
            Ok((SessionId::new(existing), response.config_options))
        }
        Ok(Err(error)) => {
            runtime.capture.store(false, Ordering::Release);
            runtime.flush_and_clear_pipeline();
            Err(format!("session_load_failed: {error}"))
        }
        Err(_) => {
            runtime.capture.store(false, Ordering::Release);
            runtime.flush_and_clear_pipeline();
            Err("session_load_failed: timed out".to_string())
        }
    }
}

fn apply_session_model<'a>(
    connection: &'a ConnectionTo<Agent>,
    session_id: &'a SessionId,
    config: Option<&'a [SessionConfigOption]>,
    model: Option<&'a str>,
) -> impl std::future::Future<Output = Result<(), String>> + 'a {
    async move {
        let Some(model) = model else {
            return Ok(());
        };
        let Some(options) = config else {
            return Ok(());
        };
        let Some(option) = model_config_option(options) else {
            return Ok(());
        };
        if matches!(&option.kind, SessionConfigKind::Select(_))
            && !select_has_value(&option.kind, model)
        {
            return Err(format!("model {model} not in session config options"));
        }
        let request = SetSessionConfigOptionRequest::new(
            session_id.clone(),
            option.id.clone(),
            SessionConfigOptionValue::value_id(model.to_string()),
        );
        tokio::time::timeout(CONFIG_TIMEOUT, connection.send_request(request).block_task())
            .await
            .map_err(|_| "session config timed out".to_string())?
            .map_err(|error| error.to_string())?;
        Ok(())
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

#[allow(dead_code)]
pub fn map_stop_reason(reason: StopReason) -> LocalStopReason {
    match reason {
        StopReason::EndTurn => LocalStopReason::EndTurn,
        StopReason::Cancelled => LocalStopReason::Cancelled,
        StopReason::MaxTokens => LocalStopReason::MaxTokens,
        StopReason::MaxTurnRequests => LocalStopReason::MaxTurnRequests,
        StopReason::Refusal => LocalStopReason::Refusal,
        _ => LocalStopReason::Unknown,
    }
}

// Silence unused import warning if SessionConfigId unused in some builds.
#[allow(dead_code)]
fn _keep_session_config_id(id: SessionConfigId) -> SessionConfigId {
    id
}
