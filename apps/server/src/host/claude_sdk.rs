use super::acp::{TimelineItem, TimelineItemKind};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fmt,
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{
    process::{ChildStdin, Command},
    sync::{broadcast, mpsc, oneshot, watch, Mutex as AsyncMutex},
};
use tokio_util::codec::{FramedRead, FramedWrite, LinesCodec};
use uuid::Uuid;

pub const MAX_CLAUDE_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
const OUTBOUND_CAPACITY: usize = 256;
const MESSAGE_CAPACITY: usize = 1_024;
const CONTROL_REQUEST_CAPACITY: usize = 128;
const PENDING_CONTROL_CAPACITY: usize = 1_024;
const MAX_PENDING_INTERACTIONS: usize = 128;
const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(60);
const CONTROL_TIMEOUT: Duration = Duration::from_secs(30);
const TURN_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const INTERRUPT_GRACE: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ClaudeSdkError {
    Spawn(String),
    Closed,
    Timeout { subtype: String },
    Remote(String),
    Protocol(String),
    Backpressure,
    RequestCancelled,
}

impl fmt::Display for ClaudeSdkError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Spawn(message) => write!(formatter, "failed to start Claude SDK process: {message}"),
            Self::Closed => formatter.write_str("Claude SDK process closed"),
            Self::Timeout { subtype } => {
                write!(formatter, "Claude SDK control request `{subtype}` timed out")
            }
            Self::Remote(message) => write!(formatter, "Claude SDK control request failed: {message}"),
            Self::Protocol(message) => write!(formatter, "Claude SDK protocol error: {message}"),
            Self::Backpressure => formatter.write_str("Claude SDK queue is full"),
            Self::RequestCancelled => {
                formatter.write_str("Claude SDK control request was cancelled by the provider")
            }
        }
    }
}

impl std::error::Error for ClaudeSdkError {}

type PendingResponse = oneshot::Sender<Result<Value, ClaudeSdkError>>;

#[derive(Clone)]
pub struct ClaudeControlRequest {
    pub request_id: String,
    pub request: Value,
    outbound: mpsc::Sender<Value>,
    cancelled: Arc<AtomicBool>,
    registry: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl fmt::Debug for ClaudeControlRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ClaudeControlRequest")
            .field("request_id", &self.request_id)
            .field("request", &self.request)
            .field("cancelled", &self.is_cancelled())
            .finish_non_exhaustive()
    }
}

impl ClaudeControlRequest {
    pub fn subtype(&self) -> Option<&str> {
        self.request.get("subtype").and_then(Value::as_str)
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub fn try_respond(self, response: Value) -> Result<(), ClaudeSdkError> {
        if self.is_cancelled() {
            return Err(ClaudeSdkError::RequestCancelled);
        }
        self.registry
            .lock()
            .expect("Claude SDK inbound-control lock poisoned")
            .remove(&self.request_id);
        self.outbound
            .try_send(json!({
                "type": "control_response",
                "response": {
                    "subtype": "success",
                    "request_id": self.request_id,
                    "response": response,
                }
            }))
            .map_err(map_try_send_error)
    }

    pub async fn respond(self, response: Value) -> Result<(), ClaudeSdkError> {
        if self.is_cancelled() {
            return Err(ClaudeSdkError::RequestCancelled);
        }
        self.registry
            .lock()
            .expect("Claude SDK inbound-control lock poisoned")
            .remove(&self.request_id);
        self.outbound
            .send(json!({
                "type": "control_response",
                "response": {
                    "subtype": "success",
                    "request_id": self.request_id,
                    "response": response,
                }
            }))
            .await
            .map_err(|_| ClaudeSdkError::Closed)
    }

    pub fn try_reject(self, message: impl Into<String>) -> Result<(), ClaudeSdkError> {
        if self.is_cancelled() {
            return Err(ClaudeSdkError::RequestCancelled);
        }
        self.registry
            .lock()
            .expect("Claude SDK inbound-control lock poisoned")
            .remove(&self.request_id);
        self.outbound
            .try_send(json!({
                "type": "control_response",
                "response": {
                    "subtype": "error",
                    "request_id": self.request_id,
                    "error": message.into(),
                }
            }))
            .map_err(map_try_send_error)
    }
}

struct ClaudeSdkInner {
    outbound: mpsc::Sender<Value>,
    pending: Arc<Mutex<HashMap<String, PendingResponse>>>,
    messages: broadcast::Sender<Value>,
    control_requests: Mutex<Option<mpsc::Receiver<ClaudeControlRequest>>>,
    shutdown: watch::Sender<bool>,
    closed: watch::Receiver<bool>,
    next_id: AtomicU64,
}

impl Drop for ClaudeSdkInner {
    fn drop(&mut self) {
        let _ = self.shutdown.send(true);
    }
}

#[derive(Clone)]
pub struct ClaudeSdkProcess {
    inner: Arc<ClaudeSdkInner>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClaudePermissionMode {
    Default,
    AcceptEdits,
    Auto,
    BypassPermissions,
    DontAsk,
    Plan,
}

impl ClaudePermissionMode {
    pub fn from_product_value(value: Option<&str>) -> Self {
        match value {
            Some("auto-accept-edits") => Self::AcceptEdits,
            Some("auto") => Self::Auto,
            Some("full-access") | None => Self::BypassPermissions,
            Some("approval-required") => Self::Default,
            Some(_) => Self::Default,
        }
    }

    pub fn as_cli_value(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::AcceptEdits => "acceptEdits",
            Self::Auto => "auto",
            Self::BypassPermissions => "bypassPermissions",
            Self::DontAsk => "dontAsk",
            Self::Plan => "plan",
        }
    }
}

#[derive(Clone, Debug)]
pub struct ClaudeProcessOptions {
    pub executable: PathBuf,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub permission_mode: ClaudePermissionMode,
    pub resume_session_id: Option<String>,
    pub new_session_id: Option<String>,
    pub extra_args: Vec<String>,
}

impl ClaudeProcessOptions {
    fn command_args(&self) -> Vec<String> {
        let mut args = vec![
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
            "--input-format".to_string(),
            "stream-json".to_string(),
            "--include-partial-messages".to_string(),
            "--permission-mode".to_string(),
            self.permission_mode.as_cli_value().to_string(),
            "--setting-sources=user,project,local".to_string(),
        ];
        if self.permission_mode == ClaudePermissionMode::BypassPermissions {
            args.push("--dangerously-skip-permissions".to_string());
        }
        if let Some(model) = self.model.as_deref().filter(|model| !model.is_empty()) {
            args.extend(["--model".to_string(), model.to_string()]);
        }
        if let Some(effort) = self.effort.as_deref().filter(|effort| !effort.is_empty()) {
            args.extend(["--effort".to_string(), effort.to_string()]);
        }
        if let Some(resume) = self
            .resume_session_id
            .as_deref()
            .filter(|resume| !resume.is_empty())
        {
            args.push(format!("--resume={resume}"));
        }
        if let Some(session_id) = self
            .new_session_id
            .as_deref()
            .filter(|session_id| !session_id.is_empty())
        {
            args.push(format!("--session-id={session_id}"));
        }
        args.extend(self.extra_args.iter().cloned());
        args
    }
}

impl ClaudeSdkProcess {
    pub fn spawn(options: &ClaudeProcessOptions) -> Result<Self, ClaudeSdkError> {
        let mut command = Command::new(&options.executable);
        command
            .args(options.command_args())
            .current_dir(&options.cwd)
            .env_remove("CLAUDECODE")
            .env("CLAUDE_CODE_ENTRYPOINT", "sdk-rs")
            .env("CLAUDE_AGENT_SDK_VERSION", env!("CARGO_PKG_VERSION"))
            .envs(options.env.iter().cloned())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut child = command
            .spawn()
            .map_err(|error| ClaudeSdkError::Spawn(error.to_string()))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| ClaudeSdkError::Spawn("child process did not expose stdin".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| ClaudeSdkError::Spawn("child process did not expose stdout".to_string()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| ClaudeSdkError::Spawn("child process did not expose stderr".to_string()))?;

        let (outbound_tx, outbound_rx) = mpsc::channel(OUTBOUND_CAPACITY);
        let (message_tx, _) = broadcast::channel(MESSAGE_CAPACITY);
        let (control_tx, control_rx) = mpsc::channel(CONTROL_REQUEST_CAPACITY);
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let (closed_tx, closed_rx) = watch::channel(false);
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let inbound_controls = Arc::new(Mutex::new(HashMap::new()));

        spawn_writer(
            stdin,
            outbound_rx,
            shutdown_rx.clone(),
            shutdown_tx.clone(),
            pending.clone(),
        );
        spawn_reader(
            stdout,
            outbound_tx.clone(),
            message_tx.clone(),
            control_tx,
            shutdown_rx.clone(),
            shutdown_tx.clone(),
            pending.clone(),
            inbound_controls.clone(),
        );
        spawn_stderr(stderr, shutdown_rx.clone());
        spawn_process_monitor(
            child,
            shutdown_rx,
            shutdown_tx.clone(),
            closed_tx,
            pending.clone(),
            inbound_controls.clone(),
        );

        Ok(Self {
            inner: Arc::new(ClaudeSdkInner {
                outbound: outbound_tx,
                pending,
                messages: message_tx,
                control_requests: Mutex::new(Some(control_rx)),
                shutdown: shutdown_tx,
                closed: closed_rx,
                next_id: AtomicU64::new(1),
            }),
        })
    }

    pub async fn initialize(&self, timeout: Duration) -> Result<Value, ClaudeSdkError> {
        self.control_request(json!({
            "subtype": "initialize",
            "hooks": Value::Null,
        }), timeout)
        .await
    }

    pub async fn control_request(
        &self,
        request: Value,
        timeout: Duration,
    ) -> Result<Value, ClaudeSdkError> {
        if *self.inner.closed.borrow() || *self.inner.shutdown.borrow() {
            return Err(ClaudeSdkError::Closed);
        }
        let subtype = request
            .get("subtype")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let request_id = format!(
            "gharargah_{}_{}",
            self.inner.next_id.fetch_add(1, Ordering::Relaxed),
            uuid::Uuid::new_v4().simple()
        );
        let (response_tx, response_rx) = oneshot::channel();
        {
            let mut pending = self
                .inner
                .pending
                .lock()
                .expect("Claude SDK pending lock poisoned");
            if pending.len() >= PENDING_CONTROL_CAPACITY {
                return Err(ClaudeSdkError::Backpressure);
            }
            pending.insert(request_id.clone(), response_tx);
        }
        let envelope = json!({
            "type": "control_request",
            "request_id": request_id,
            "request": request,
        });
        let outbound = self.inner.outbound.clone();
        let result = tokio::time::timeout(timeout, async move {
            outbound
                .send(envelope)
                .await
                .map_err(|_| ClaudeSdkError::Closed)?;
            response_rx.await.map_err(|_| ClaudeSdkError::Closed)?
        })
        .await;
        match result {
            Ok(result) => result,
            Err(_) => {
                self.inner
                    .pending
                    .lock()
                    .expect("Claude SDK pending lock poisoned")
                    .remove(&request_id);
                Err(ClaudeSdkError::Timeout { subtype })
            }
        }
    }

    pub async fn send_user_message(
        &self,
        content: Value,
        session_id: &str,
    ) -> Result<(), ClaudeSdkError> {
        if *self.inner.closed.borrow() || *self.inner.shutdown.borrow() {
            return Err(ClaudeSdkError::Closed);
        }
        self.inner
            .outbound
            .send(json!({
                "type": "user",
                "message": {
                    "role": "user",
                    "content": content,
                },
                "parent_tool_use_id": Value::Null,
                "session_id": session_id,
            }))
            .await
            .map_err(|_| ClaudeSdkError::Closed)
    }

    pub async fn interrupt(&self, timeout: Duration) -> Result<(), ClaudeSdkError> {
        self.control_request(json!({ "subtype": "interrupt" }), timeout)
            .await
            .map(|_| ())
    }

    pub async fn set_permission_mode(
        &self,
        mode: ClaudePermissionMode,
        timeout: Duration,
    ) -> Result<(), ClaudeSdkError> {
        self.control_request(
            json!({ "subtype": "set_permission_mode", "mode": mode.as_cli_value() }),
            timeout,
        )
        .await
        .map(|_| ())
    }

    pub async fn set_model(
        &self,
        model: Option<&str>,
        timeout: Duration,
    ) -> Result<(), ClaudeSdkError> {
        self.control_request(
            json!({ "subtype": "set_model", "model": model }),
            timeout,
        )
        .await
        .map(|_| ())
    }

    pub fn subscribe_messages(&self) -> broadcast::Receiver<Value> {
        self.inner.messages.subscribe()
    }

    pub fn take_control_requests(
        &self,
    ) -> Result<mpsc::Receiver<ClaudeControlRequest>, ClaudeSdkError> {
        self.inner
            .control_requests
            .lock()
            .expect("Claude SDK control-request lock poisoned")
            .take()
            .ok_or_else(|| {
                ClaudeSdkError::Protocol(
                    "control-request receiver has already been taken".to_string(),
                )
            })
    }

    pub fn is_closed(&self) -> bool {
        *self.inner.closed.borrow()
    }

    pub async fn stop(&self) {
        let _ = self.inner.shutdown.send(true);
        let mut closed = self.inner.closed.clone();
        if !*closed.borrow() {
            let _ = tokio::time::timeout(Duration::from_secs(5), closed.changed()).await;
        }
    }
}

fn spawn_writer(
    stdin: ChildStdin,
    mut outbound: mpsc::Receiver<Value>,
    mut shutdown: watch::Receiver<bool>,
    shutdown_tx: watch::Sender<bool>,
    pending: Arc<Mutex<HashMap<String, PendingResponse>>>,
) {
    tokio::spawn(async move {
        let mut writer = FramedWrite::new(
            stdin,
            LinesCodec::new_with_max_length(MAX_CLAUDE_MESSAGE_BYTES),
        );
        loop {
            tokio::select! {
                changed = shutdown.changed() => {
                    if changed.is_err() || *shutdown.borrow() {
                        break;
                    }
                }
                message = outbound.recv() => {
                    let Some(message) = message else {
                        break;
                    };
                    let serialized = match serde_json::to_string(&message) {
                        Ok(serialized) if serialized.len() <= MAX_CLAUDE_MESSAGE_BYTES => serialized,
                        Ok(_) => {
                            fail_pending(&pending, ClaudeSdkError::Protocol(
                                "outbound message exceeded the size limit".to_string(),
                            ));
                            let _ = shutdown_tx.send(true);
                            break;
                        }
                        Err(error) => {
                            fail_pending(&pending, ClaudeSdkError::Protocol(error.to_string()));
                            let _ = shutdown_tx.send(true);
                            break;
                        }
                    };
                    if let Err(error) = writer.send(serialized).await {
                        fail_pending(&pending, ClaudeSdkError::Protocol(error.to_string()));
                        let _ = shutdown_tx.send(true);
                        break;
                    }
                }
            }
        }
    });
}

#[allow(clippy::too_many_arguments)]
fn spawn_reader(
    stdout: tokio::process::ChildStdout,
    outbound: mpsc::Sender<Value>,
    messages: broadcast::Sender<Value>,
    control_requests: mpsc::Sender<ClaudeControlRequest>,
    mut shutdown: watch::Receiver<bool>,
    shutdown_tx: watch::Sender<bool>,
    pending: Arc<Mutex<HashMap<String, PendingResponse>>>,
    inbound_controls: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
) {
    tokio::spawn(async move {
        let mut reader = FramedRead::new(
            stdout,
            LinesCodec::new_with_max_length(MAX_CLAUDE_MESSAGE_BYTES),
        );
        loop {
            let line = tokio::select! {
                changed = shutdown.changed() => {
                    if changed.is_err() || *shutdown.borrow() {
                        break;
                    }
                    continue;
                }
                line = reader.next() => line,
            };
            let Some(line) = line else {
                break;
            };
            let line = match line {
                Ok(line) => line,
                Err(error) => {
                    fail_pending(&pending, ClaudeSdkError::Protocol(error.to_string()));
                    break;
                }
            };
            let message: Value = match serde_json::from_str(&line) {
                Ok(message) => message,
                Err(error) => {
                    fail_pending(
                        &pending,
                        ClaudeSdkError::Protocol(format!("invalid JSON: {error}")),
                    );
                    break;
                }
            };
            route_message(
                message,
                &outbound,
                &messages,
                &control_requests,
                &pending,
                &inbound_controls,
            );
        }
        let _ = shutdown_tx.send(true);
    });
}

fn route_message(
    message: Value,
    outbound: &mpsc::Sender<Value>,
    messages: &broadcast::Sender<Value>,
    control_requests: &mpsc::Sender<ClaudeControlRequest>,
    pending: &Arc<Mutex<HashMap<String, PendingResponse>>>,
    inbound_controls: &Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
) {
    match message.get("type").and_then(Value::as_str) {
        Some("control_response") => {
            let response = message.get("response").cloned().unwrap_or(Value::Null);
            let Some(request_id) = response
                .get("request_id")
                .and_then(Value::as_str)
                .map(str::to_string)
            else {
                return;
            };
            let Some(sender) = pending
                .lock()
                .expect("Claude SDK pending lock poisoned")
                .remove(&request_id)
            else {
                return;
            };
            let result = if response.get("subtype").and_then(Value::as_str) == Some("error") {
                Err(ClaudeSdkError::Remote(
                    response
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown control error")
                        .to_string(),
                ))
            } else {
                Ok(response.get("response").cloned().unwrap_or(Value::Null))
            };
            let _ = sender.send(result);
        }
        Some("control_request") => {
            let Some(request_id) = message
                .get("request_id")
                .and_then(Value::as_str)
                .map(str::to_string)
            else {
                return;
            };
            let cancelled = Arc::new(AtomicBool::new(false));
            inbound_controls
                .lock()
                .expect("Claude SDK inbound-control lock poisoned")
                .insert(request_id.clone(), cancelled.clone());
            let request = ClaudeControlRequest {
                request_id: request_id.clone(),
                request: message.get("request").cloned().unwrap_or(Value::Null),
                outbound: outbound.clone(),
                cancelled,
                registry: inbound_controls.clone(),
            };
            if control_requests.try_send(request).is_err() {
                inbound_controls
                    .lock()
                    .expect("Claude SDK inbound-control lock poisoned")
                    .remove(&request_id);
                let _ = outbound.try_send(json!({
                    "type": "control_response",
                    "response": {
                        "subtype": "error",
                        "request_id": request_id,
                        "error": "client control-request queue is full",
                    }
                }));
            }
        }
        Some("control_cancel_request") => {
            if let Some(request_id) = message.get("request_id").and_then(Value::as_str) {
                if let Some(cancelled) = inbound_controls
                    .lock()
                    .expect("Claude SDK inbound-control lock poisoned")
                    .remove(request_id)
                {
                    cancelled.store(true, Ordering::Release);
                }
            }
        }
        Some("transcript_mirror") => {
            // Session mirroring is intentionally disabled; never surface a potentially
            // large provider-internal transport frame to the product event stream.
        }
        _ => {
            let _ = messages.send(message);
        }
    }
}

fn spawn_stderr(stderr: tokio::process::ChildStderr, mut shutdown: watch::Receiver<bool>) {
    tokio::spawn(async move {
        let mut reader = FramedRead::new(
            stderr,
            LinesCodec::new_with_max_length(MAX_CLAUDE_MESSAGE_BYTES),
        );
        loop {
            tokio::select! {
                changed = shutdown.changed() => {
                    if changed.is_err() || *shutdown.borrow() {
                        break;
                    }
                }
                line = reader.next() => {
                    let Some(line) = line else {
                        break;
                    };
                    match line {
                        Ok(line) => tracing::debug!(target: "claude_sdk_stderr", "{line}"),
                        Err(error) => {
                            tracing::warn!(target: "claude_sdk_stderr", %error, "stderr stream failed");
                            break;
                        }
                    }
                }
            }
        }
    });
}

fn spawn_process_monitor(
    mut child: tokio::process::Child,
    mut shutdown: watch::Receiver<bool>,
    shutdown_tx: watch::Sender<bool>,
    closed_tx: watch::Sender<bool>,
    pending: Arc<Mutex<HashMap<String, PendingResponse>>>,
    inbound_controls: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
) {
    tokio::spawn(async move {
        tokio::select! {
            _ = child.wait() => {}
            changed = shutdown.changed() => {
                if changed.is_ok() && *shutdown.borrow() {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                }
            }
        }
        fail_pending(&pending, ClaudeSdkError::Closed);
        for (_, cancelled) in std::mem::take(
            &mut *inbound_controls
                .lock()
                .expect("Claude SDK inbound-control lock poisoned"),
        ) {
            cancelled.store(true, Ordering::Release);
        }
        let _ = shutdown_tx.send(true);
        let _ = closed_tx.send(true);
    });
}

fn fail_pending(
    pending: &Arc<Mutex<HashMap<String, PendingResponse>>>,
    error: ClaudeSdkError,
) {
    let pending = std::mem::take(
        &mut *pending
            .lock()
            .expect("Claude SDK pending lock poisoned"),
    );
    for (_, response) in pending {
        let _ = response.send(Err(error.clone()));
    }
}

fn map_try_send_error<T>(error: mpsc::error::TrySendError<T>) -> ClaudeSdkError {
    match error {
        mpsc::error::TrySendError::Full(_) => ClaudeSdkError::Backpressure,
        mpsc::error::TrySendError::Closed(_) => ClaudeSdkError::Closed,
    }
}

pub struct ClaudeSessionOptions {
    pub process: ClaudeProcessOptions,
}

pub struct ClaudeSession {
    process: ClaudeSdkProcess,
    initialize: Value,
    messages: AsyncMutex<broadcast::Receiver<Value>>,
    controls: AsyncMutex<mpsc::Receiver<ClaudeControlRequest>>,
    turn_lock: AsyncMutex<()>,
    session_id: Mutex<Option<String>>,
}

#[derive(Clone)]
pub struct ClaudeTurnCallbacks {
    pub on_session: Arc<dyn Fn(&str) + Send + Sync>,
    pub on_text_delta: Arc<dyn Fn(&str) + Send + Sync>,
    pub on_message: Arc<dyn Fn(&Value) + Send + Sync>,
    pub on_timeline: Arc<dyn Fn(ClaudeTimelineUpdate) + Send + Sync>,
    pub on_control_request: Arc<dyn Fn(ClaudeControlRequest) + Send + Sync>,
}

impl Default for ClaudeTurnCallbacks {
    fn default() -> Self {
        Self {
            on_session: Arc::new(|_| {}),
            on_text_delta: Arc::new(|_| {}),
            on_message: Arc::new(|_| {}),
            on_timeline: Arc::new(|_| {}),
            on_control_request: Arc::new(|request| {
                let _ = request.try_reject("Claude control request is unsupported");
            }),
        }
    }
}

pub struct ClaudeSessionTurnRequest {
    pub content: Value,
    pub permission_mode: ClaudePermissionMode,
    pub model: Option<String>,
    pub cancel: watch::Receiver<bool>,
    pub callbacks: ClaudeTurnCallbacks,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ClaudeSessionTurnResult {
    pub session_id: String,
    pub text: String,
    pub status: String,
    pub error: Option<String>,
    pub usage: Option<Value>,
    pub model_usage: Option<Value>,
    pub total_cost_usd: Option<f64>,
    pub cancelled: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ClaudeTimelineUpdate {
    pub item: TimelineItem,
    pub append_text: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClaudeInteractionKind {
    Permission,
    UserInput,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ClaudeInteraction {
    pub request_id: String,
    pub kind: ClaudeInteractionKind,
    pub payload: Value,
}

struct PendingClaudeInteraction {
    thread_key: String,
    kind: ClaudeInteractionKind,
    request: ClaudeControlRequest,
    original_input: Value,
    questions: Value,
    suggestions: Value,
}

#[derive(Clone, Default)]
pub struct ClaudeInteractionStore {
    pending: Arc<Mutex<HashMap<String, PendingClaudeInteraction>>>,
}

#[derive(Clone)]
pub struct ClaudeSupervisor {
    sessions: Arc<Mutex<HashMap<String, Arc<tokio::sync::OnceCell<Arc<ClaudeSession>>>>>>,
    interactions: ClaudeInteractionStore,
}

pub struct ClaudeSupervisorTurnRequest {
    pub executable: PathBuf,
    pub extra_args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub workspace_root: PathBuf,
    pub thread_key: String,
    pub existing_provider_session_id: Option<String>,
    pub prompt: String,
    pub images: Vec<(String, String)>,
    pub permission_mode: ClaudePermissionMode,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub cancel: watch::Receiver<bool>,
    pub on_session: Arc<dyn Fn(&str) + Send + Sync>,
    pub on_text_delta: Arc<dyn Fn(&str) + Send + Sync>,
    pub on_message: Arc<dyn Fn(&Value) + Send + Sync>,
    pub on_timeline: Arc<dyn Fn(ClaudeTimelineUpdate) + Send + Sync>,
    pub on_interaction: Arc<dyn Fn(ClaudeInteraction) + Send + Sync>,
}

impl ClaudeSession {
    pub async fn open(options: ClaudeSessionOptions) -> Result<Self, ClaudeSdkError> {
        let process = ClaudeSdkProcess::spawn(&options.process)?;
        let messages = process.subscribe_messages();
        let controls = process.take_control_requests()?;
        let initialize = match process.initialize(INITIALIZE_TIMEOUT).await {
            Ok(initialize) => initialize,
            Err(error) => {
                process.stop().await;
                return Err(error);
            }
        };
        Ok(Self {
            process,
            initialize,
            messages: AsyncMutex::new(messages),
            controls: AsyncMutex::new(controls),
            turn_lock: AsyncMutex::new(()),
            session_id: Mutex::new(
                options
                    .process
                    .resume_session_id
                    .filter(|value| !value.is_empty()),
            ),
        })
    }

    pub fn initialize_info(&self) -> &Value {
        &self.initialize
    }

    pub fn session_id(&self) -> Option<String> {
        self.session_id
            .lock()
            .expect("Claude session id lock poisoned")
            .clone()
    }

    pub async fn run_turn(
        &self,
        request: ClaudeSessionTurnRequest,
    ) -> Result<ClaudeSessionTurnResult, ClaudeSdkError> {
        let _turn_guard = self.turn_lock.try_lock().map_err(|_| {
            ClaudeSdkError::Protocol("a Claude turn is already running for this session".to_string())
        })?;
        self.process
            .set_permission_mode(request.permission_mode, CONTROL_TIMEOUT)
            .await?;
        self.process
            .set_model(request.model.as_deref(), CONTROL_TIMEOUT)
            .await?;

        let wire_session_id = self.session_id().unwrap_or_else(|| "default".to_string());
        self.process
            .send_user_message(request.content, &wire_session_id)
            .await?;

        let mut messages = self.messages.lock().await;
        let mut controls = self.controls.lock().await;
        let mut cancel = request.cancel;
        let mut cancel_requested = *cancel.borrow();
        let mut cancel_channel_closed = false;
        let mut interrupt_deadline = None;
        if cancel_requested {
            self.process.interrupt(CONTROL_TIMEOUT).await?;
            interrupt_deadline = Some(tokio::time::Instant::now() + INTERRUPT_GRACE);
        }
        let mut text = String::new();
        let mut streamed_assistant_text = false;

        let completion = tokio::time::timeout(TURN_TIMEOUT, async {
            loop {
                tokio::select! {
                    received = messages.recv() => {
                        let message = match received {
                            Ok(message) => message,
                            Err(broadcast::error::RecvError::Lagged(skipped)) => {
                                return Err(ClaudeSdkError::Protocol(format!(
                                    "Claude SDK message consumer lagged by {skipped} messages"
                                )));
                            }
                            Err(broadcast::error::RecvError::Closed) => {
                                return Err(ClaudeSdkError::Closed);
                            }
                        };
                        (request.callbacks.on_message)(&message);
                        if let Some(session_id) = durable_session_id(&message) {
                            let changed = {
                                let mut current = self
                                    .session_id
                                    .lock()
                                    .expect("Claude session id lock poisoned");
                                if current.as_deref() != Some(session_id) {
                                    *current = Some(session_id.to_string());
                                    true
                                } else {
                                    false
                                }
                            };
                            if changed {
                                (request.callbacks.on_session)(session_id);
                            }
                        }

                        if let Some(delta) = assistant_text_delta(&message) {
                            streamed_assistant_text = true;
                            text.push_str(delta);
                            (request.callbacks.on_text_delta)(delta);
                        } else if message.get("type").and_then(Value::as_str) == Some("assistant")
                            && !streamed_assistant_text
                        {
                            for fragment in assistant_text_blocks(&message) {
                                text.push_str(fragment);
                                (request.callbacks.on_text_delta)(fragment);
                            }
                        }
                        for update in normalize_message(&message, self.session_id().as_deref()) {
                            (request.callbacks.on_timeline)(update);
                        }

                        if message.get("type").and_then(Value::as_str) == Some("result") {
                            let session_id = message
                                .get("session_id")
                                .and_then(Value::as_str)
                                .or_else(|| self.session_id().as_deref().map(|_| ""))
                                .unwrap_or("default")
                                .to_string();
                            let session_id = if session_id.is_empty() {
                                self.session_id().unwrap_or_else(|| "default".to_string())
                            } else {
                                session_id
                            };
                            let subtype = message
                                .get("subtype")
                                .and_then(Value::as_str)
                                .unwrap_or("unknown");
                            let is_error = message
                                .get("is_error")
                                .and_then(Value::as_bool)
                                .unwrap_or(subtype != "success");
                            let errors = result_error_text(&message);
                            let interrupted = cancel_requested || is_interrupted_result(&message);
                            let status = if interrupted {
                                "interrupted"
                            } else if subtype == "success" && !is_error {
                                "completed"
                            } else {
                                "failed"
                            };
                            return Ok(ClaudeSessionTurnResult {
                                session_id,
                                text,
                                status: status.to_string(),
                                error: (status == "failed").then_some(errors).filter(|value| !value.is_empty()),
                                usage: message.get("usage").cloned().filter(|value| !value.is_null()),
                                model_usage: message.get("modelUsage").cloned().filter(|value| !value.is_null()),
                                total_cost_usd: message.get("total_cost_usd").and_then(Value::as_f64),
                                cancelled: interrupted,
                            });
                        }
                    }
                    control = controls.recv() => {
                        let Some(control) = control else {
                            return Err(ClaudeSdkError::Closed);
                        };
                        (request.callbacks.on_control_request)(control);
                    }
                    changed = cancel.changed(), if !cancel_requested && !cancel_channel_closed => {
                        if changed.is_err() {
                            cancel_channel_closed = true;
                        } else if *cancel.borrow() {
                            cancel_requested = true;
                            self.process.interrupt(CONTROL_TIMEOUT).await?;
                            interrupt_deadline = Some(tokio::time::Instant::now() + INTERRUPT_GRACE);
                        }
                    }
                    _ = async {
                        if let Some(deadline) = interrupt_deadline {
                            tokio::time::sleep_until(deadline).await;
                        }
                    }, if interrupt_deadline.is_some() => {
                        self.process.stop().await;
                        return Ok(ClaudeSessionTurnResult {
                            session_id: self.session_id().unwrap_or_else(|| "default".to_string()),
                            text,
                            status: "interrupted".to_string(),
                            error: None,
                            usage: None,
                            model_usage: None,
                            total_cost_usd: None,
                            cancelled: true,
                        });
                    }
                }
            }
        })
        .await;

        match completion {
            Ok(result) => result,
            Err(_) => Err(ClaudeSdkError::Timeout {
                subtype: "result".to_string(),
            }),
        }
    }

    pub async fn stop(&self) {
        self.process.stop().await;
    }
}

impl ClaudeInteractionStore {
    pub fn register(
        &self,
        thread_key: &str,
        request: ClaudeControlRequest,
    ) -> Result<Option<ClaudeInteraction>, ClaudeSdkError> {
        if request.subtype() != Some("can_use_tool") {
            let message = format!(
                "unsupported Claude control request: {}",
                request.subtype().unwrap_or("unknown")
            );
            request.try_reject(message)?;
            return Ok(None);
        }
        let tool_name = request
            .request
            .get("tool_name")
            .and_then(Value::as_str)
            .unwrap_or("Tool");
        let request_id = Uuid::new_v4().to_string();
        let kind = if tool_name == "AskUserQuestion" {
            ClaudeInteractionKind::UserInput
        } else {
            ClaudeInteractionKind::Permission
        };
        let original_input = request
            .request
            .get("input")
            .cloned()
            .unwrap_or_else(|| json!({}));
        let questions = original_input
            .get("questions")
            .cloned()
            .unwrap_or_else(|| json!([]));
        let suggestions = request
            .request
            .get("permission_suggestions")
            .cloned()
            .unwrap_or_else(|| json!([]));
        let payload = match kind {
            ClaudeInteractionKind::Permission => claude_permission_payload(&request_id, &request),
            ClaudeInteractionKind::UserInput => {
                claude_user_input_payload(&request_id, &request, &questions)
            }
        };
        let mut pending = self
            .pending
            .lock()
            .expect("Claude interaction lock poisoned");
        if pending.len() >= MAX_PENDING_INTERACTIONS {
            drop(pending);
            request.try_reject("too many pending client interactions")?;
            return Err(ClaudeSdkError::Backpressure);
        }
        pending.insert(
            request_id.clone(),
            PendingClaudeInteraction {
                thread_key: thread_key.to_string(),
                kind,
                request,
                original_input,
                questions,
                suggestions,
            },
        );
        Ok(Some(ClaudeInteraction {
            request_id,
            kind,
            payload,
        }))
    }

    pub fn resolve_permission(&self, request_id: &str, option_id: &str) -> Result<(), String> {
        let pending = self.take_kind(request_id, ClaudeInteractionKind::Permission)?;
        let response = match option_id {
            "accept" | "allow" | "allow_once" => json!({
                "behavior": "allow",
                "updatedInput": pending.original_input,
            }),
            "acceptForSession" | "allow_always" | "allow_for_session" => {
                let mut response = json!({
                    "behavior": "allow",
                    "updatedInput": pending.original_input,
                });
                if pending
                    .suggestions
                    .as_array()
                    .is_some_and(|suggestions| !suggestions.is_empty())
                {
                    response["updatedPermissions"] = pending.suggestions;
                }
                response
            }
            "decline" | "deny" | "reject" | "reject_once" => json!({
                "behavior": "deny",
                "message": "User declined tool execution.",
            }),
            "cancel" => json!({
                "behavior": "deny",
                "message": "User cancelled tool execution.",
                "interrupt": true,
            }),
            _ => {
                self.pending
                    .lock()
                    .map_err(|_| "Claude interaction lock poisoned")?
                    .insert(request_id.to_string(), pending);
                return Err("invalid_permission_option".to_string());
            }
        };
        pending
            .request
            .try_respond(response)
            .map_err(|error| error.to_string())
    }

    pub fn resolve_user_input(&self, request_id: &str, answer: Value) -> Result<(), String> {
        let pending = self.take_kind(request_id, ClaudeInteractionKind::UserInput)?;
        let answers = answer
            .get("answers")
            .cloned()
            .unwrap_or_else(|| json!({}));
        pending
            .request
            .try_respond(json!({
                "behavior": "allow",
                "updatedInput": {
                    "questions": pending.questions,
                    "answers": answers,
                }
            }))
            .map_err(|error| error.to_string())
    }

    fn take_kind(
        &self,
        request_id: &str,
        expected: ClaudeInteractionKind,
    ) -> Result<PendingClaudeInteraction, String> {
        let pending = self
            .pending
            .lock()
            .map_err(|_| "Claude interaction lock poisoned")?
            .remove(request_id)
            .ok_or_else(|| "unknown_interaction_request".to_string())?;
        if pending.kind == expected {
            Ok(pending)
        } else {
            self.pending
                .lock()
                .map_err(|_| "Claude interaction lock poisoned")?
                .insert(request_id.to_string(), pending);
            Err("interaction_kind_mismatch".to_string())
        }
    }

    pub fn cancel_for_thread(&self, thread_key: &str) {
        let cancelled = {
            let mut pending = self
                .pending
                .lock()
                .expect("Claude interaction lock poisoned");
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
            let _ = interaction.request.try_respond(json!({
                "behavior": "deny",
                "message": "Session stopped.",
                "interrupt": true,
            }));
        }
    }

    pub fn cancel_all(&self) {
        let cancelled = std::mem::take(
            &mut *self
                .pending
                .lock()
                .expect("Claude interaction lock poisoned"),
        );
        for interaction in cancelled.into_values() {
            let _ = interaction.request.try_respond(json!({
                "behavior": "deny",
                "message": "Client stopped.",
                "interrupt": true,
            }));
        }
    }

    pub fn pending_count(&self) -> usize {
        self.pending
            .lock()
            .expect("Claude interaction lock poisoned")
            .len()
    }
}

impl ClaudeSupervisor {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            interactions: ClaudeInteractionStore::default(),
        }
    }

    pub async fn run_turn(
        &self,
        request: ClaudeSupervisorTurnRequest,
    ) -> Result<ClaudeSessionTurnResult, ClaudeSdkError> {
        let cell = {
            let mut sessions = self.sessions.lock().expect("Claude session lock poisoned");
            sessions
                .entry(request.thread_key.clone())
                .or_insert_with(|| Arc::new(tokio::sync::OnceCell::new()))
                .clone()
        };
        let process = ClaudeProcessOptions {
            executable: request.executable.clone(),
            cwd: request.workspace_root.clone(),
            env: request.env.clone(),
            model: request.model.clone(),
            effort: request.effort.clone(),
            permission_mode: request.permission_mode,
            resume_session_id: request.existing_provider_session_id.clone(),
            new_session_id: None,
            extra_args: request.extra_args.clone(),
        };
        let session = match cell
            .get_or_try_init(|| async {
                ClaudeSession::open(ClaudeSessionOptions { process })
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
        if let Some(session_id) = session.session_id() {
            (request.on_session)(&session_id);
        }

        let content = build_claude_content(&request.prompt, request.images)?;
        let interactions = self.interactions.clone();
        let thread_key = request.thread_key.clone();
        let on_interaction = request.on_interaction.clone();
        let result = session
            .run_turn(ClaudeSessionTurnRequest {
                content,
                permission_mode: request.permission_mode,
                model: request.model,
                cancel: request.cancel,
                callbacks: ClaudeTurnCallbacks {
                    on_session: request.on_session,
                    on_text_delta: request.on_text_delta,
                    on_message: request.on_message,
                    on_timeline: request.on_timeline,
                    on_control_request: Arc::new(move |control| {
                        match interactions.register(&thread_key, control) {
                            Ok(Some(interaction)) => on_interaction(interaction),
                            Ok(None) => {}
                            Err(error) => {
                                tracing::warn!(%error, "failed to register Claude interaction");
                            }
                        }
                    }),
                },
            })
            .await;
        self.interactions.cancel_for_thread(&request.thread_key);
        if matches!(result, Err(ClaudeSdkError::Closed)) {
            self.remove_session_if_same(&request.thread_key, &cell);
        }
        result
    }

    pub fn resolve_permission(&self, request_id: &str, option_id: &str) -> Result<(), String> {
        self.interactions
            .resolve_permission(request_id, option_id)
    }

    pub fn resolve_user_input(&self, request_id: &str, answer: Value) -> Result<(), String> {
        self.interactions.resolve_user_input(request_id, answer)
    }

    pub fn force_stop(&self, thread_key: &str) -> bool {
        self.interactions.cancel_for_thread(thread_key);
        self.sessions
            .lock()
            .expect("Claude session lock poisoned")
            .remove(thread_key)
            .is_some()
    }

    pub fn shutdown(&self) {
        self.interactions.cancel_all();
        self.sessions
            .lock()
            .expect("Claude session lock poisoned")
            .clear();
    }

    pub fn session_count(&self) -> usize {
        self.sessions
            .lock()
            .expect("Claude session lock poisoned")
            .len()
    }

    fn remove_session_if_same(
        &self,
        thread_key: &str,
        expected: &Arc<tokio::sync::OnceCell<Arc<ClaudeSession>>>,
    ) {
        let mut sessions = self.sessions.lock().expect("Claude session lock poisoned");
        if sessions
            .get(thread_key)
            .is_some_and(|current| Arc::ptr_eq(current, expected))
        {
            sessions.remove(thread_key);
        }
    }
}

impl Default for ClaudeSupervisor {
    fn default() -> Self {
        Self::new()
    }
}

fn build_claude_content(
    prompt: &str,
    images: Vec<(String, String)>,
) -> Result<Value, ClaudeSdkError> {
    if prompt.is_empty() && images.is_empty() {
        return Err(ClaudeSdkError::Protocol(
            "Claude turn input cannot be empty".to_string(),
        ));
    }
    let mut blocks = Vec::with_capacity(images.len().min(8) + 1);
    if !prompt.is_empty() {
        blocks.push(json!({ "type": "text", "text": prompt }));
    }
    for (data, mime_type) in images.into_iter().take(8) {
        if !matches!(
            mime_type.as_str(),
            "image/gif" | "image/jpeg" | "image/png" | "image/webp"
        ) {
            return Err(ClaudeSdkError::Protocol(format!(
                "unsupported Claude image type `{mime_type}`"
            )));
        }
        let data = data
            .strip_prefix(&format!("data:{mime_type};base64,"))
            .unwrap_or(&data)
            .to_string();
        blocks.push(json!({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": mime_type,
                "data": data,
            }
        }));
    }
    Ok(Value::Array(blocks))
}

fn durable_session_id(message: &Value) -> Option<&str> {
    let session_id = message.get("session_id").and_then(Value::as_str)?;
    if session_id.is_empty() || session_id == "default" {
        return None;
    }
    if message.get("type").and_then(Value::as_str) == Some("system")
        && matches!(
            message.get("subtype").and_then(Value::as_str),
            Some("hook_started" | "hook_progress" | "hook_response")
        )
    {
        return None;
    }
    Some(session_id)
}

fn assistant_text_delta(message: &Value) -> Option<&str> {
    if message.get("type").and_then(Value::as_str) != Some("stream_event")
        || message.pointer("/event/type").and_then(Value::as_str)
            != Some("content_block_delta")
        || message
            .pointer("/event/delta/type")
            .and_then(Value::as_str)
            != Some("text_delta")
    {
        return None;
    }
    message
        .pointer("/event/delta/text")
        .and_then(Value::as_str)
}

fn assistant_text_blocks(message: &Value) -> Vec<&str> {
    message
        .pointer("/message/content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect()
}

fn result_error_text(message: &Value) -> String {
    let errors = message
        .get("errors")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>()
        .join("; ");
    if !errors.is_empty() {
        return errors;
    }
    message
        .get("result")
        .and_then(Value::as_str)
        .filter(|result| !result.is_empty())
        .unwrap_or_else(|| {
            message
                .get("subtype")
                .and_then(Value::as_str)
                .unwrap_or("Claude turn failed")
        })
        .to_string()
}

fn is_interrupted_result(message: &Value) -> bool {
    let normalized = result_error_text(message).to_lowercase();
    normalized.contains("interrupt")
        || normalized.contains("request was aborted")
        || normalized.contains("cancel")
}

pub fn normalize_message(
    message: &Value,
    fallback_session_id: Option<&str>,
) -> Vec<ClaudeTimelineUpdate> {
    let session_id = durable_session_id(message)
        .or(fallback_session_id)
        .unwrap_or("default")
        .to_string();
    let message_type = message.get("type").and_then(Value::as_str).unwrap_or("");
    let mut updates = Vec::new();
    if message_type == "stream_event" {
        let event = message.get("event").cloned().unwrap_or(Value::Null);
        let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
        let uuid = message
            .get("uuid")
            .and_then(Value::as_str)
            .unwrap_or("claude-stream");
        let index = event.get("index").and_then(Value::as_u64).unwrap_or(0);
        let item_id = format!("{uuid}:{index}");
        if event_type == "content_block_delta"
            && event.pointer("/delta/type").and_then(Value::as_str) == Some("thinking_delta")
        {
            if let Some(text) = event.pointer("/delta/thinking").and_then(Value::as_str) {
                updates.push(ClaudeTimelineUpdate {
                    item: TimelineItem {
                        kind: TimelineItemKind::Thought,
                        id: item_id,
                        session_id,
                        turn_id: None,
                        payload: json!({ "text": text }),
                    },
                    append_text: true,
                });
            }
        } else if event_type == "content_block_start"
            && event
                .pointer("/content_block/type")
                .and_then(Value::as_str)
                == Some("tool_use")
        {
            let block = event.get("content_block").cloned().unwrap_or(Value::Null);
            updates.push(ClaudeTimelineUpdate {
                item: TimelineItem {
                    kind: TimelineItemKind::ToolCall,
                    id: block
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or(&item_id)
                        .to_string(),
                    session_id,
                    turn_id: None,
                    payload: json!({
                        "name": block.get("name").and_then(Value::as_str).unwrap_or("Claude tool"),
                        "status": "in_progress",
                        "input": block.get("input").cloned().unwrap_or_else(|| json!({})),
                    }),
                },
                append_text: false,
            });
        }
    } else if message_type == "result" {
        if let Some(usage) = message.get("usage").cloned().filter(|value| !value.is_null()) {
            updates.push(ClaudeTimelineUpdate {
                item: TimelineItem {
                    kind: TimelineItemKind::Usage,
                    id: format!("claude-usage-{}", Uuid::new_v4()),
                    session_id,
                    turn_id: None,
                    payload: json!({
                        "usage": usage,
                        "modelUsage": message.get("modelUsage").cloned().unwrap_or(Value::Null),
                        "totalCostUsd": message.get("total_cost_usd").cloned().unwrap_or(Value::Null),
                    }),
                },
                append_text: false,
            });
        }
    } else if message_type == "rate_limit_event" {
        updates.push(ClaudeTimelineUpdate {
            item: TimelineItem {
                kind: TimelineItemKind::Status,
                id: format!("claude-rate-limit-{}", Uuid::new_v4()),
                session_id,
                turn_id: None,
                payload: json!({
                    "type": "rate_limit",
                    "rateLimitInfo": message.get("rate_limit_info").cloned().unwrap_or(Value::Null),
                }),
            },
            append_text: false,
        });
    }
    updates
}

fn claude_permission_payload(request_id: &str, request: &ClaudeControlRequest) -> Value {
    let tool_name = request
        .request
        .get("tool_name")
        .and_then(Value::as_str)
        .unwrap_or("Claude tool");
    let input = request
        .request
        .get("input")
        .cloned()
        .unwrap_or_else(|| json!({}));
    json!({
        "id": request_id,
        "requestId": request_id,
        "title": request.request.get("title").and_then(Value::as_str).unwrap_or("Permission required"),
        "description": request.request.get("description").cloned().unwrap_or_else(|| {
            request.request.get("decision_reason").cloned().unwrap_or(Value::Null)
        }),
        "toolName": tool_name,
        "toolCall": {
            "id": request.request.get("tool_use_id").cloned().unwrap_or(Value::Null),
            "name": tool_name,
            "input": input,
        },
        "options": [
            { "id": "accept", "kind": "allow_once", "label": "Allow once" },
            { "id": "acceptForSession", "kind": "allow_always", "label": "Allow for session" },
            { "id": "decline", "kind": "reject_once", "label": "Decline" },
            { "id": "cancel", "kind": "cancel", "label": "Cancel turn" }
        ],
        "raw": request.request,
    })
}

fn claude_user_input_payload(
    request_id: &str,
    request: &ClaudeControlRequest,
    questions: &Value,
) -> Value {
    json!({
        "id": request_id,
        "requestId": request_id,
        "kind": "ask_question",
        "title": request.request.get("title").and_then(Value::as_str).unwrap_or("Claude needs input"),
        "questions": questions,
        "raw": request.request,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_runtime_modes_and_fails_unknown_closed() {
        assert_eq!(
            ClaudePermissionMode::from_product_value(Some("approval-required")),
            ClaudePermissionMode::Default
        );
        assert_eq!(
            ClaudePermissionMode::from_product_value(Some("auto-accept-edits")),
            ClaudePermissionMode::AcceptEdits
        );
        assert_eq!(
            ClaudePermissionMode::from_product_value(Some("auto")),
            ClaudePermissionMode::Auto
        );
        assert_eq!(
            ClaudePermissionMode::from_product_value(Some("full-access")),
            ClaudePermissionMode::BypassPermissions
        );
        assert_eq!(
            ClaudePermissionMode::from_product_value(Some("future-mode")),
            ClaudePermissionMode::Default
        );
    }

    #[test]
    fn builds_sdk_compatible_command() {
        let args = ClaudeProcessOptions {
            executable: PathBuf::from("claude"),
            cwd: PathBuf::from("."),
            env: Vec::new(),
            model: Some("sonnet".to_string()),
            effort: Some("high".to_string()),
            permission_mode: ClaudePermissionMode::BypassPermissions,
            resume_session_id: Some("session-value".to_string()),
            new_session_id: None,
            extra_args: vec!["--strict-mcp-config".to_string()],
        }
        .command_args();
        assert!(args.windows(2).any(|pair| pair == ["--output-format", "stream-json"]));
        assert!(args.windows(2).any(|pair| pair == ["--input-format", "stream-json"]));
        assert!(args.contains(&"--include-partial-messages".to_string()));
        assert!(args.contains(&"--dangerously-skip-permissions".to_string()));
        assert!(args.contains(&"--resume=session-value".to_string()));
        assert!(args.contains(&"--strict-mcp-config".to_string()));
    }
}
