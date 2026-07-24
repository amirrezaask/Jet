use super::acp::{TimelineItem, TimelineItemKind};
use super::line_rpc::{LineRpcClient, LineRpcError, LineRpcNotification, LineRpcServerRequest};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex as StdMutex},
    time::Duration,
};
use tokio::sync::{broadcast, mpsc, watch, Mutex};
use uuid::Uuid;

const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(15);
const THREAD_TIMEOUT: Duration = Duration::from_secs(30);
const TURN_TIMEOUT: Duration = Duration::from_secs(30);
const TURN_COMPLETION_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const MAX_PENDING_INTERACTIONS: usize = 128;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RuntimeMode {
    ApprovalRequired,
    AutoAcceptEdits,
    Auto,
    FullAccess,
}

impl RuntimeMode {
    pub fn from_product_value(value: Option<&str>) -> Self {
        match value {
            Some("approval-required") => Self::ApprovalRequired,
            Some("auto-accept-edits") => Self::AutoAcceptEdits,
            Some("auto") => Self::Auto,
            Some("full-access") | None => Self::FullAccess,
            Some(_) => Self::ApprovalRequired,
        }
    }

    fn settings(self) -> RuntimeSettings {
        match self {
            Self::ApprovalRequired => RuntimeSettings {
                approval_policy: "untrusted",
                sandbox: "read-only",
                approvals_reviewer: "user",
                sandbox_policy: json!({ "type": "readOnly" }),
            },
            Self::AutoAcceptEdits => RuntimeSettings {
                approval_policy: "on-request",
                sandbox: "workspace-write",
                approvals_reviewer: "user",
                sandbox_policy: json!({ "type": "workspaceWrite" }),
            },
            Self::Auto => RuntimeSettings {
                approval_policy: "on-request",
                sandbox: "workspace-write",
                approvals_reviewer: "auto_review",
                sandbox_policy: json!({ "type": "workspaceWrite" }),
            },
            Self::FullAccess => RuntimeSettings {
                approval_policy: "never",
                sandbox: "danger-full-access",
                approvals_reviewer: "user",
                sandbox_policy: json!({ "type": "dangerFullAccess" }),
            },
        }
    }
}

struct RuntimeSettings {
    approval_policy: &'static str,
    sandbox: &'static str,
    approvals_reviewer: &'static str,
    sandbox_policy: Value,
}

#[derive(Clone, Debug)]
pub struct CodexThreadOptions {
    pub cwd: std::path::PathBuf,
    pub runtime_mode: RuntimeMode,
    pub model: Option<String>,
    pub service_tier: Option<String>,
    pub ephemeral: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CodexThread {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CodexThreadOpenResponse {
    pub thread: CodexThread,
    #[serde(default)]
    pub model: String,
    #[serde(default, rename = "modelProvider")]
    pub model_provider: String,
}

#[derive(Clone, Debug)]
pub enum CodexTurnInput {
    Text(String),
    Image { url: String },
}

impl Serialize for CodexTurnInput {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::Text(text) => json!({ "type": "text", "text": text }).serialize(serializer),
            Self::Image { url } => json!({ "type": "image", "url": url }).serialize(serializer),
        }
    }
}

#[derive(Clone, Debug)]
pub struct CodexTurnOptions {
    pub thread_id: String,
    pub input: Vec<CodexTurnInput>,
    pub runtime_mode: RuntimeMode,
    pub model: Option<String>,
    pub service_tier: Option<String>,
    pub effort: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CodexTurn {
    pub id: String,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CodexTurnStartResponse {
    pub turn: CodexTurn,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CodexInitializeResponse {
    #[serde(rename = "userAgent")]
    pub user_agent: String,
    #[serde(rename = "codexHome")]
    pub codex_home: String,
    #[serde(rename = "platformFamily")]
    pub platform_family: String,
    #[serde(rename = "platformOs")]
    pub platform_os: String,
}

#[derive(Clone)]
pub struct CodexAppServer {
    client: LineRpcClient,
    initialize: CodexInitializeResponse,
}

pub struct CodexSession {
    server: CodexAppServer,
    thread_id: String,
    notifications: Mutex<broadcast::Receiver<LineRpcNotification>>,
    server_requests: Mutex<mpsc::Receiver<LineRpcServerRequest>>,
    turn_lock: Mutex<()>,
}

pub struct CodexSessionOptions {
    pub executable: std::path::PathBuf,
    pub extra_args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub thread: CodexThreadOptions,
    pub resume_thread_id: Option<String>,
}

#[derive(Clone)]
pub struct CodexTurnCallbacks {
    pub on_text_delta: Arc<dyn Fn(&str) + Send + Sync>,
    pub on_notification: Arc<dyn Fn(&LineRpcNotification) + Send + Sync>,
    pub on_server_request: Arc<dyn Fn(LineRpcServerRequest) + Send + Sync>,
}

impl Default for CodexTurnCallbacks {
    fn default() -> Self {
        Self {
            on_text_delta: Arc::new(|_| {}),
            on_notification: Arc::new(|_| {}),
            on_server_request: Arc::new(|_| {}),
        }
    }
}

pub struct CodexSessionTurnRequest {
    pub input: Vec<CodexTurnInput>,
    pub runtime_mode: RuntimeMode,
    pub model: Option<String>,
    pub service_tier: Option<String>,
    pub effort: Option<String>,
    pub cancel: watch::Receiver<bool>,
    pub callbacks: CodexTurnCallbacks,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CodexSessionTurnResult {
    pub thread_id: String,
    pub turn_id: String,
    pub text: String,
    pub status: String,
    pub error: Option<Value>,
    pub cancelled: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CodexTimelineUpdate {
    pub item: TimelineItem,
    pub append_text: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CodexInteractionKind {
    Permission,
    UserInput,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CodexInteraction {
    pub request_id: String,
    pub kind: CodexInteractionKind,
    pub payload: Value,
}

struct PendingCodexInteraction {
    thread_key: String,
    kind: CodexInteractionKind,
    request: LineRpcServerRequest,
}

#[derive(Clone, Default)]
pub struct CodexInteractionStore {
    pending: Arc<StdMutex<HashMap<String, PendingCodexInteraction>>>,
}

#[derive(Clone)]
pub struct CodexSupervisor {
    sessions: Arc<StdMutex<HashMap<String, Arc<tokio::sync::OnceCell<Arc<CodexSession>>>>>>,
    interactions: CodexInteractionStore,
}

pub struct CodexSupervisorTurnRequest {
    pub executable: std::path::PathBuf,
    pub extra_args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub workspace_root: std::path::PathBuf,
    pub thread_key: String,
    pub existing_provider_thread_id: Option<String>,
    pub prompt: String,
    pub images: Vec<(String, String)>,
    pub runtime_mode: RuntimeMode,
    pub model: Option<String>,
    pub service_tier: Option<String>,
    pub effort: Option<String>,
    pub cancel: watch::Receiver<bool>,
    pub on_session: Arc<dyn Fn(&str) + Send + Sync>,
    pub on_text_delta: Arc<dyn Fn(&str) + Send + Sync>,
    pub on_notification: Arc<dyn Fn(&LineRpcNotification) + Send + Sync>,
    pub on_interaction: Arc<dyn Fn(CodexInteraction) + Send + Sync>,
}

impl CodexAppServer {
    pub async fn start(
        executable: impl AsRef<Path>,
        extra_args: &[String],
        cwd: impl AsRef<Path>,
        env: &[(String, String)],
    ) -> Result<Self, LineRpcError> {
        let mut args = Vec::with_capacity(extra_args.len() + 1);
        args.push("app-server".to_string());
        args.extend_from_slice(extra_args);
        let client = LineRpcClient::spawn(executable, &args, cwd, env)?;
        let response = client
            .request(
                "initialize",
                json!({
                    "clientInfo": {
                        "name": "gharargah_desktop",
                        "title": "Gharargah Desktop",
                        "version": env!("CARGO_PKG_VERSION")
                    },
                    "capabilities": {
                        "experimentalApi": true
                    }
                }),
                INITIALIZE_TIMEOUT,
            )
            .await?;
        let initialize = decode("initialize", response)?;
        client.notify_without_params("initialized").await?;
        Ok(Self { client, initialize })
    }

    pub fn initialize_response(&self) -> &CodexInitializeResponse {
        &self.initialize
    }

    pub fn subscribe_notifications(&self) -> broadcast::Receiver<LineRpcNotification> {
        self.client.subscribe_notifications()
    }

    pub fn take_server_requests(
        &self,
    ) -> Result<mpsc::Receiver<LineRpcServerRequest>, LineRpcError> {
        self.client.take_server_requests()
    }

    pub async fn start_thread(
        &self,
        options: &CodexThreadOptions,
    ) -> Result<CodexThreadOpenResponse, LineRpcError> {
        let settings = options.runtime_mode.settings();
        let mut params = json!({
            "cwd": options.cwd,
            "approvalPolicy": settings.approval_policy,
            "sandbox": settings.sandbox,
            "approvalsReviewer": settings.approvals_reviewer,
            "ephemeral": options.ephemeral,
        });
        insert_optional(&mut params, "model", options.model.as_deref());
        insert_optional(&mut params, "serviceTier", options.service_tier.as_deref());
        let response = self
            .client
            .request("thread/start", params, THREAD_TIMEOUT)
            .await?;
        decode("thread/start", response)
    }

    pub async fn resume_thread(
        &self,
        thread_id: &str,
        options: &CodexThreadOptions,
    ) -> Result<CodexThreadOpenResponse, LineRpcError> {
        let settings = options.runtime_mode.settings();
        let mut params = json!({
            "threadId": thread_id,
            "cwd": options.cwd,
            "approvalPolicy": settings.approval_policy,
            "sandbox": settings.sandbox,
            "approvalsReviewer": settings.approvals_reviewer,
        });
        insert_optional(&mut params, "model", options.model.as_deref());
        insert_optional(&mut params, "serviceTier", options.service_tier.as_deref());
        let response = self
            .client
            .request("thread/resume", params, THREAD_TIMEOUT)
            .await?;
        decode("thread/resume", response)
    }

    pub async fn start_turn(
        &self,
        options: &CodexTurnOptions,
    ) -> Result<CodexTurnStartResponse, LineRpcError> {
        if options.input.is_empty() {
            return Err(LineRpcError::Protocol(
                "turn/start requires at least one input item".to_string(),
            ));
        }
        let settings = options.runtime_mode.settings();
        let mut params = json!({
            "threadId": options.thread_id,
            "input": options.input,
            "approvalPolicy": settings.approval_policy,
            "approvalsReviewer": settings.approvals_reviewer,
            "sandboxPolicy": settings.sandbox_policy,
        });
        insert_optional(&mut params, "model", options.model.as_deref());
        insert_optional(&mut params, "serviceTier", options.service_tier.as_deref());
        insert_optional(&mut params, "effort", options.effort.as_deref());
        let response = self
            .client
            .request("turn/start", params, TURN_TIMEOUT)
            .await?;
        decode("turn/start", response)
    }

    pub async fn interrupt_turn(&self, thread_id: &str, turn_id: &str) -> Result<(), LineRpcError> {
        self.client
            .request(
                "turn/interrupt",
                json!({
                    "threadId": thread_id,
                    "turnId": turn_id,
                }),
                TURN_TIMEOUT,
            )
            .await
            .map(|_| ())
    }

    pub async fn stop(&self) {
        self.client.stop().await;
    }
}

impl CodexSession {
    pub async fn open(options: CodexSessionOptions) -> Result<Self, LineRpcError> {
        let server = CodexAppServer::start(
            &options.executable,
            &options.extra_args,
            &options.thread.cwd,
            &options.env,
        )
        .await?;
        let notifications = server.subscribe_notifications();
        let server_requests = server.take_server_requests()?;

        let opened = if let Some(thread_id) = options.resume_thread_id.as_deref() {
            match server.resume_thread(thread_id, &options.thread).await {
                Ok(opened) => opened,
                Err(error) if is_recoverable_thread_resume_error(&error) => {
                    tracing::warn!(
                        %thread_id,
                        %error,
                        "Codex thread resume failed recoverably; starting a fresh thread"
                    );
                    server.start_thread(&options.thread).await?
                }
                Err(error) => return Err(error),
            }
        } else {
            server.start_thread(&options.thread).await?
        };

        Ok(Self {
            server,
            thread_id: opened.thread.id,
            notifications: Mutex::new(notifications),
            server_requests: Mutex::new(server_requests),
            turn_lock: Mutex::new(()),
        })
    }

    pub fn thread_id(&self) -> &str {
        &self.thread_id
    }

    pub fn initialize_response(&self) -> &CodexInitializeResponse {
        self.server.initialize_response()
    }

    pub async fn run_turn(
        &self,
        request: CodexSessionTurnRequest,
    ) -> Result<CodexSessionTurnResult, LineRpcError> {
        let _turn_guard = self.turn_lock.try_lock().map_err(|_| {
            LineRpcError::Protocol(format!(
                "a turn is already running for Codex thread {}",
                self.thread_id
            ))
        })?;
        let started = self
            .server
            .start_turn(&CodexTurnOptions {
                thread_id: self.thread_id.clone(),
                input: request.input,
                runtime_mode: request.runtime_mode,
                model: request.model,
                service_tier: request.service_tier,
                effort: request.effort,
            })
            .await?;
        let turn_id = started.turn.id;
        let mut notifications = self.notifications.lock().await;
        let mut server_requests = self.server_requests.lock().await;
        let mut cancel = request.cancel;
        let mut cancel_requested = *cancel.borrow();
        let mut cancel_channel_closed = false;
        if cancel_requested {
            self.server
                .interrupt_turn(&self.thread_id, &turn_id)
                .await?;
        }

        let completion = tokio::time::timeout(TURN_COMPLETION_TIMEOUT, async {
            let mut text = String::new();
            loop {
                tokio::select! {
                    notification = notifications.recv() => {
                        let notification = match notification {
                            Ok(notification) => notification,
                            Err(broadcast::error::RecvError::Closed) => {
                                return Err(LineRpcError::Closed);
                            }
                            Err(broadcast::error::RecvError::Lagged(count)) => {
                                return Err(LineRpcError::Protocol(format!(
                                    "Codex notification consumer lagged by {count} events"
                                )));
                            }
                        };
                        (request.callbacks.on_notification)(&notification);
                        if notification.method == "item/agentMessage/delta"
                            && notification.params.get("turnId").and_then(Value::as_str)
                                == Some(turn_id.as_str())
                        {
                            if let Some(delta) =
                                notification.params.get("delta").and_then(Value::as_str)
                            {
                                text.push_str(delta);
                                (request.callbacks.on_text_delta)(delta);
                            }
                        }
                        if notification.method == "turn/completed"
                            && notification.params.pointer("/turn/id").and_then(Value::as_str)
                                == Some(turn_id.as_str())
                        {
                            let turn = notification
                                .params
                                .get("turn")
                                .cloned()
                                .unwrap_or(Value::Null);
                            return Ok(CodexSessionTurnResult {
                                thread_id: self.thread_id.clone(),
                                turn_id: turn_id.clone(),
                                text,
                                status: turn
                                    .get("status")
                                    .and_then(Value::as_str)
                                    .unwrap_or("unknown")
                                    .to_string(),
                                error: turn.get("error").cloned().filter(|value| !value.is_null()),
                                cancelled: cancel_requested,
                            });
                        }
                    }
                    server_request = server_requests.recv() => {
                        let Some(server_request) = server_request else {
                            return Err(LineRpcError::Closed);
                        };
                        (request.callbacks.on_server_request)(server_request);
                    }
                    changed = cancel.changed(), if !cancel_requested && !cancel_channel_closed => {
                        if changed.is_err() {
                            cancel_channel_closed = true;
                        } else if *cancel.borrow() {
                            cancel_requested = true;
                            self.server.interrupt_turn(&self.thread_id, &turn_id).await?;
                        }
                    }
                }
            }
        })
        .await;

        match completion {
            Ok(result) => result,
            Err(_) => Err(LineRpcError::Timeout {
                method: "turn/completed".to_string(),
            }),
        }
    }

    pub async fn stop(&self) {
        self.server.stop().await;
    }
}

impl CodexInteractionStore {
    pub fn register(
        &self,
        thread_key: &str,
        request: LineRpcServerRequest,
    ) -> Result<Option<CodexInteraction>, LineRpcError> {
        let kind = match request.method.as_str() {
            "item/commandExecution/requestApproval"
            | "item/fileChange/requestApproval"
            | "item/permissions/requestApproval"
            | "applyPatchApproval"
            | "execCommandApproval" => CodexInteractionKind::Permission,
            "item/tool/requestUserInput" | "mcpServer/elicitation/request" => {
                CodexInteractionKind::UserInput
            }
            _ => {
                let message = format!("unsupported Codex server request: {}", request.method);
                request.try_reject(-32_601, message, None)?;
                return Ok(None);
            }
        };
        let request_id = Uuid::new_v4().to_string();
        let payload = match kind {
            CodexInteractionKind::Permission => permission_payload(&request_id, &request),
            CodexInteractionKind::UserInput => user_input_payload(&request_id, &request),
        };
        let mut pending = self
            .pending
            .lock()
            .expect("Codex interaction lock poisoned");
        if pending.len() >= MAX_PENDING_INTERACTIONS {
            drop(pending);
            request.try_reject(-32_001, "too many pending client interactions", None)?;
            return Err(LineRpcError::Backpressure);
        }
        pending.insert(
            request_id.clone(),
            PendingCodexInteraction {
                thread_key: thread_key.to_string(),
                kind,
                request,
            },
        );
        Ok(Some(CodexInteraction {
            request_id,
            kind,
            payload,
        }))
    }

    pub fn resolve_permission(&self, request_id: &str, option_id: &str) -> Result<(), String> {
        let decision = map_permission_decision(option_id)
            .ok_or_else(|| "invalid_permission_option".to_string())?;
        let pending = self
            .pending
            .lock()
            .map_err(|_| "Codex interaction lock poisoned")?
            .remove(request_id)
            .ok_or_else(|| "unknown_permission_request".to_string())?;
        if pending.kind != CodexInteractionKind::Permission {
            self.pending
                .lock()
                .map_err(|_| "Codex interaction lock poisoned")?
                .insert(request_id.to_string(), pending);
            return Err("interaction_kind_mismatch".to_string());
        }
        pending
            .request
            .try_respond(json!({ "decision": decision }))
            .map_err(|error| error.to_string())
    }

    pub fn resolve_user_input(&self, request_id: &str, answer: Value) -> Result<(), String> {
        let pending = self
            .pending
            .lock()
            .map_err(|_| "Codex interaction lock poisoned")?
            .remove(request_id)
            .ok_or_else(|| "unknown_user_input_request".to_string())?;
        if pending.kind != CodexInteractionKind::UserInput {
            self.pending
                .lock()
                .map_err(|_| "Codex interaction lock poisoned")?
                .insert(request_id.to_string(), pending);
            return Err("interaction_kind_mismatch".to_string());
        }
        let answers = answer.get("answers").cloned().unwrap_or_else(|| json!({}));
        pending
            .request
            .try_respond(json!({ "answers": answers }))
            .map_err(|error| error.to_string())
    }

    pub fn cancel_for_thread(&self, thread_key: &str) {
        let cancelled = {
            let mut pending = self
                .pending
                .lock()
                .expect("Codex interaction lock poisoned");
            let ids = pending
                .iter()
                .filter_map(|(id, interaction)| {
                    (interaction.thread_key == thread_key).then(|| id.clone())
                })
                .collect::<Vec<_>>();
            ids.into_iter()
                .filter_map(|id| pending.remove(&id))
                .collect::<Vec<_>>()
        };
        for interaction in cancelled {
            let response = match interaction.kind {
                CodexInteractionKind::Permission => json!({ "decision": "cancel" }),
                CodexInteractionKind::UserInput => json!({ "answers": {} }),
            };
            let _ = interaction.request.try_respond(response);
        }
    }

    pub fn cancel_all(&self) {
        let cancelled = {
            let mut pending = self
                .pending
                .lock()
                .expect("Codex interaction lock poisoned");
            std::mem::take(&mut *pending)
                .into_values()
                .collect::<Vec<_>>()
        };
        for interaction in cancelled {
            let response = match interaction.kind {
                CodexInteractionKind::Permission => json!({ "decision": "cancel" }),
                CodexInteractionKind::UserInput => json!({ "answers": {} }),
            };
            let _ = interaction.request.try_respond(response);
        }
    }

    pub fn pending_count(&self) -> usize {
        self.pending
            .lock()
            .expect("Codex interaction lock poisoned")
            .len()
    }
}

impl CodexSupervisor {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(StdMutex::new(HashMap::new())),
            interactions: CodexInteractionStore::default(),
        }
    }

    pub async fn run_turn(
        &self,
        request: CodexSupervisorTurnRequest,
    ) -> Result<CodexSessionTurnResult, LineRpcError> {
        let cell = {
            let mut sessions = self.sessions.lock().expect("Codex session lock poisoned");
            sessions
                .entry(request.thread_key.clone())
                .or_insert_with(|| Arc::new(tokio::sync::OnceCell::new()))
                .clone()
        };
        let executable = request.executable.clone();
        let extra_args = request.extra_args.clone();
        let env = request.env.clone();
        let thread_options = CodexThreadOptions {
            cwd: request.workspace_root.clone(),
            runtime_mode: request.runtime_mode,
            model: request.model.clone(),
            service_tier: request.service_tier.clone(),
            ephemeral: false,
        };
        let resume_thread_id = request.existing_provider_thread_id.clone();
        let session = match cell
            .get_or_try_init(|| async move {
                CodexSession::open(CodexSessionOptions {
                    executable,
                    extra_args,
                    env,
                    thread: thread_options,
                    resume_thread_id,
                })
                .await
                .map(Arc::new)
            })
            .await
        {
            Ok(session) => session.clone(),
            Err(error) => {
                self.remove_session_if_same(&request.thread_key, &cell);
                return Err(error);
            }
        };
        (request.on_session)(session.thread_id());

        let mut input = Vec::with_capacity(request.images.len() + 1);
        if !request.prompt.is_empty() {
            input.push(CodexTurnInput::Text(request.prompt));
        }
        for (data, mime_type) in request.images.into_iter().take(8) {
            let url = if data.starts_with("data:") {
                data
            } else {
                format!("data:{mime_type};base64,{data}")
            };
            input.push(CodexTurnInput::Image { url });
        }

        let thread_key = request.thread_key.clone();
        let interactions = self.interactions.clone();
        let on_interaction = request.on_interaction.clone();
        let result = session
            .run_turn(CodexSessionTurnRequest {
                input,
                runtime_mode: request.runtime_mode,
                model: request.model,
                service_tier: request.service_tier,
                effort: request.effort,
                cancel: request.cancel,
                callbacks: CodexTurnCallbacks {
                    on_text_delta: request.on_text_delta,
                    on_notification: request.on_notification,
                    on_server_request: Arc::new(move |server_request| {
                        match interactions.register(&thread_key, server_request) {
                            Ok(Some(interaction)) => on_interaction(interaction),
                            Ok(None) => {}
                            Err(error) => {
                                tracing::warn!(%error, "failed to register Codex interaction")
                            }
                        }
                    }),
                },
            })
            .await;
        self.interactions.cancel_for_thread(&request.thread_key);
        if matches!(result, Err(LineRpcError::Closed)) {
            self.remove_session_if_same(&request.thread_key, &cell);
        }
        result
    }

    pub fn resolve_permission(&self, request_id: &str, option_id: &str) -> Result<(), String> {
        self.interactions.resolve_permission(request_id, option_id)
    }

    pub fn resolve_user_input(&self, request_id: &str, answer: Value) -> Result<(), String> {
        self.interactions.resolve_user_input(request_id, answer)
    }

    pub fn force_stop(&self, thread_key: &str) -> bool {
        self.interactions.cancel_for_thread(thread_key);
        self.sessions
            .lock()
            .expect("Codex session lock poisoned")
            .remove(thread_key)
            .is_some()
    }

    pub fn shutdown(&self) {
        self.interactions.cancel_all();
        self.sessions
            .lock()
            .expect("Codex session lock poisoned")
            .clear();
    }

    pub fn session_count(&self) -> usize {
        self.sessions
            .lock()
            .expect("Codex session lock poisoned")
            .len()
    }

    fn remove_session_if_same(
        &self,
        thread_key: &str,
        expected: &Arc<tokio::sync::OnceCell<Arc<CodexSession>>>,
    ) {
        let mut sessions = self.sessions.lock().expect("Codex session lock poisoned");
        if sessions
            .get(thread_key)
            .is_some_and(|current| Arc::ptr_eq(current, expected))
        {
            sessions.remove(thread_key);
        }
    }
}

impl Default for CodexSupervisor {
    fn default() -> Self {
        Self::new()
    }
}

pub fn is_recoverable_thread_resume_error(error: &LineRpcError) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    message.contains("thread")
        && [
            "not found",
            "does not exist",
            "missing",
            "unknown",
            "invalid thread",
        ]
        .iter()
        .any(|needle| message.contains(needle))
}

pub fn normalize_notification(
    notification: &LineRpcNotification,
    session_id: &str,
) -> Option<CodexTimelineUpdate> {
    let turn_id = notification
        .params
        .get("turnId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let item_id = notification
        .params
        .get("itemId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let update = match notification.method.as_str() {
        "item/reasoning/textDelta" | "item/reasoning/summaryTextDelta" => CodexTimelineUpdate {
            item: TimelineItem {
                kind: TimelineItemKind::Thought,
                id: item_id.unwrap_or_else(|| {
                    format!("{}:reasoning", turn_id.as_deref().unwrap_or("codex-turn"))
                }),
                session_id: session_id.to_string(),
                turn_id,
                payload: json!({
                    "text": notification.params.get("delta").and_then(Value::as_str).unwrap_or("")
                }),
            },
            append_text: true,
        },
        "item/started" | "item/completed" => {
            let item = notification.params.get("item")?;
            let item_type = item.get("type").and_then(Value::as_str).unwrap_or("tool");
            if matches!(item_type, "agentMessage" | "userMessage" | "reasoning") {
                return None;
            }
            let id = item
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or(item_id)
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            let status = if notification.method == "item/completed" {
                item.get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("completed")
            } else {
                "running"
            };
            CodexTimelineUpdate {
                item: TimelineItem {
                    kind: TimelineItemKind::ToolCall,
                    id,
                    session_id: session_id.to_string(),
                    turn_id,
                    payload: json!({
                        "id": item.get("id").cloned().unwrap_or(Value::Null),
                        "name": codex_item_title(item),
                        "kind": item_type,
                        "status": status,
                        "input": item.get("command").or_else(|| item.get("query")).cloned().unwrap_or(Value::Null),
                        "output": item.get("aggregatedOutput").or_else(|| item.get("result")).cloned().unwrap_or(Value::Null),
                        "raw": item,
                    }),
                },
                append_text: false,
            }
        }
        "turn/plan/updated" => {
            let id = format!("{}:plan", turn_id.as_deref().unwrap_or("codex-turn"));
            let entries = notification
                .params
                .get("plan")
                .and_then(Value::as_array)
                .map(|steps| {
                    steps
                        .iter()
                        .enumerate()
                        .map(|(index, step)| {
                            json!({
                                "id": format!("{id}:{index}"),
                                "label": step.get("step").or_else(|| step.get("label")).or_else(|| step.get("content")).and_then(Value::as_str).unwrap_or(""),
                                "status": step.get("status").and_then(Value::as_str).unwrap_or("pending"),
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            CodexTimelineUpdate {
                item: TimelineItem {
                    kind: TimelineItemKind::Plan,
                    id: id.clone(),
                    session_id: session_id.to_string(),
                    turn_id,
                    payload: json!({
                        "id": id,
                        "entries": entries,
                        "explanation": notification.params.get("explanation").cloned().unwrap_or(Value::Null),
                    }),
                },
                append_text: false,
            }
        }
        "thread/tokenUsage/updated" => {
            let usage = notification.params.get("tokenUsage")?;
            CodexTimelineUpdate {
                item: TimelineItem {
                    kind: TimelineItemKind::Usage,
                    id: format!("{}:usage", turn_id.as_deref().unwrap_or("codex-turn")),
                    session_id: session_id.to_string(),
                    turn_id,
                    payload: json!({
                        "used": usage.pointer("/total/totalTokens").and_then(Value::as_u64).unwrap_or(0),
                        "limit": usage.get("modelContextWindow").cloned().unwrap_or(Value::Null),
                        "unit": "tokens",
                        "raw": usage,
                    }),
                },
                append_text: false,
            }
        }
        "error" => CodexTimelineUpdate {
            item: TimelineItem {
                kind: TimelineItemKind::Error,
                id: Uuid::new_v4().to_string(),
                session_id: session_id.to_string(),
                turn_id,
                payload: json!({
                    "text": notification.params.get("message").and_then(Value::as_str).unwrap_or("Codex error"),
                    "raw": notification.params,
                }),
            },
            append_text: false,
        },
        _ => return None,
    };
    Some(update)
}

fn codex_item_title(item: &Value) -> String {
    if let Some(command) = item.get("command") {
        if let Some(command) = command.as_str() {
            return command.to_string();
        }
        if let Some(parts) = command.as_array() {
            let title = parts
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" ");
            if !title.is_empty() {
                return title;
            }
        }
    }
    item.get("name")
        .or_else(|| item.get("tool"))
        .or_else(|| item.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("Codex tool")
        .to_string()
}

fn insert_optional(target: &mut Value, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        target[key] = json!(value);
    }
}

fn permission_payload(request_id: &str, request: &LineRpcServerRequest) -> Value {
    let title = match request.method.as_str() {
        "item/commandExecution/requestApproval" | "execCommandApproval" => "Run command",
        "item/fileChange/requestApproval" | "applyPatchApproval" => "Change files",
        "item/permissions/requestApproval" => "Grant permissions",
        _ => "Approve action",
    };
    json!({
        "id": request_id,
        "requestId": request_id,
        "title": title,
        "toolName": request.method,
        "description": request.params.get("reason").cloned().unwrap_or(Value::Null),
        "options": [
            { "id": "accept", "kind": "allow_once", "label": "Allow once" },
            { "id": "acceptForSession", "kind": "allow_always", "label": "Allow for session" },
            { "id": "decline", "kind": "reject_once", "label": "Decline" },
            { "id": "cancel", "kind": "cancel", "label": "Cancel turn" }
        ],
        "raw": {
            "method": request.method,
            "params": request.params,
        }
    })
}

fn user_input_payload(request_id: &str, request: &LineRpcServerRequest) -> Value {
    json!({
        "id": request_id,
        "requestId": request_id,
        "title": "Input requested",
        "questions": request.params.get("questions").cloned().unwrap_or_else(|| json!([])),
        "raw": {
            "method": request.method,
            "params": request.params,
        }
    })
}

fn map_permission_decision(option_id: &str) -> Option<&'static str> {
    match option_id {
        "accept" | "allow" | "allow_once" => Some("accept"),
        "acceptForSession" | "allow_always" | "allow_for_session" => Some("acceptForSession"),
        "decline" | "deny" | "reject" | "reject_once" => Some("decline"),
        "cancel" => Some("cancel"),
        _ => None,
    }
}

fn decode<T: for<'de> Deserialize<'de>>(method: &str, value: Value) -> Result<T, LineRpcError> {
    serde_json::from_value(value)
        .map_err(|error| LineRpcError::Protocol(format!("invalid `{method}` response: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_modes_match_codex_security_profiles() {
        let approval = RuntimeMode::ApprovalRequired.settings();
        assert_eq!(approval.approval_policy, "untrusted");
        assert_eq!(approval.sandbox, "read-only");
        assert_eq!(approval.approvals_reviewer, "user");
        assert_eq!(approval.sandbox_policy, json!({ "type": "readOnly" }));

        let auto = RuntimeMode::Auto.settings();
        assert_eq!(auto.approval_policy, "on-request");
        assert_eq!(auto.sandbox, "workspace-write");
        assert_eq!(auto.approvals_reviewer, "auto_review");

        let full = RuntimeMode::FullAccess.settings();
        assert_eq!(full.approval_policy, "never");
        assert_eq!(full.sandbox, "danger-full-access");
        assert_eq!(full.sandbox_policy, json!({ "type": "dangerFullAccess" }));
    }

    #[test]
    fn unknown_product_mode_fails_closed() {
        assert_eq!(
            RuntimeMode::from_product_value(Some("future-mode")),
            RuntimeMode::ApprovalRequired
        );
    }

    #[test]
    fn permission_decisions_map_to_codex_protocol_values() {
        assert_eq!(map_permission_decision("allow_once"), Some("accept"));
        assert_eq!(
            map_permission_decision("allow_always"),
            Some("acceptForSession")
        );
        assert_eq!(map_permission_decision("reject_once"), Some("decline"));
        assert_eq!(map_permission_decision("cancel"), Some("cancel"));
        assert_eq!(map_permission_decision("surprise"), None);
    }

    #[test]
    fn normalizes_reasoning_tools_plans_and_usage() {
        let reasoning = normalize_notification(
            &LineRpcNotification {
                method: "item/reasoning/textDelta".to_string(),
                params: json!({
                    "threadId": "thread",
                    "turnId": "turn",
                    "itemId": "reasoning",
                    "delta": "thinking"
                }),
            },
            "session",
        )
        .expect("reasoning update");
        assert_eq!(reasoning.item.kind, TimelineItemKind::Thought);
        assert!(reasoning.append_text);
        assert_eq!(reasoning.item.payload["text"], "thinking");

        let tool = normalize_notification(
            &LineRpcNotification {
                method: "item/completed".to_string(),
                params: json!({
                    "threadId": "thread",
                    "turnId": "turn",
                    "item": {
                        "id": "command",
                        "type": "commandExecution",
                        "command": ["/bin/echo", "ok"],
                        "status": "completed",
                        "aggregatedOutput": "ok"
                    }
                }),
            },
            "session",
        )
        .expect("tool update");
        assert_eq!(tool.item.kind, TimelineItemKind::ToolCall);
        assert_eq!(tool.item.id, "command");
        assert_eq!(tool.item.payload["name"], "/bin/echo ok");

        let plan = normalize_notification(
            &LineRpcNotification {
                method: "turn/plan/updated".to_string(),
                params: json!({
                    "threadId": "thread",
                    "turnId": "turn",
                    "plan": [{ "step": "Implement", "status": "inProgress" }]
                }),
            },
            "session",
        )
        .expect("plan update");
        assert_eq!(plan.item.kind, TimelineItemKind::Plan);
        assert_eq!(plan.item.payload["entries"][0]["label"], "Implement");

        let usage = normalize_notification(
            &LineRpcNotification {
                method: "thread/tokenUsage/updated".to_string(),
                params: json!({
                    "threadId": "thread",
                    "turnId": "turn",
                    "tokenUsage": {
                        "last": { "totalTokens": 5 },
                        "total": { "totalTokens": 42 },
                        "modelContextWindow": 1000
                    }
                }),
            },
            "session",
        )
        .expect("usage update");
        assert_eq!(usage.item.kind, TimelineItemKind::Usage);
        assert_eq!(usage.item.payload["used"], 42);
        assert_eq!(usage.item.payload["limit"], 1000);
    }
}
