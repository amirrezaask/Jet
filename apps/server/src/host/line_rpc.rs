use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fmt,
    path::Path,
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{
    process::{ChildStdin, Command},
    sync::{broadcast, mpsc, oneshot, watch},
};
use tokio_util::codec::{FramedRead, FramedWrite, LinesCodec};

pub const MAX_LINE_RPC_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
const OUTBOUND_CAPACITY: usize = 256;
const PENDING_REQUEST_CAPACITY: usize = 1_024;
const SERVER_REQUEST_CAPACITY: usize = 128;
const NOTIFICATION_CAPACITY: usize = 1_024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LineRpcRemoteError {
    pub code: i64,
    pub message: String,
    pub data: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LineRpcError {
    Spawn(String),
    Closed,
    Timeout { method: String },
    Remote(LineRpcRemoteError),
    Protocol(String),
    Backpressure,
}

impl fmt::Display for LineRpcError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Spawn(message) => {
                write!(formatter, "failed to start line RPC process: {message}")
            }
            Self::Closed => formatter.write_str("line RPC process closed"),
            Self::Timeout { method } => write!(formatter, "line RPC request `{method}` timed out"),
            Self::Remote(error) => {
                write!(
                    formatter,
                    "line RPC request failed ({}): {}",
                    error.code, error.message
                )
            }
            Self::Protocol(message) => write!(formatter, "line RPC protocol error: {message}"),
            Self::Backpressure => formatter.write_str("line RPC outbound queue is full"),
        }
    }
}

impl std::error::Error for LineRpcError {}

#[derive(Clone, Debug, PartialEq)]
pub struct LineRpcNotification {
    pub method: String,
    pub params: Value,
}

#[derive(Clone)]
pub struct LineRpcServerRequest {
    pub id: Value,
    pub method: String,
    pub params: Value,
    outbound: mpsc::Sender<Value>,
}

impl fmt::Debug for LineRpcServerRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LineRpcServerRequest")
            .field("id", &self.id)
            .field("method", &self.method)
            .field("params", &self.params)
            .finish_non_exhaustive()
    }
}

impl LineRpcServerRequest {
    pub fn try_respond(self, result: Value) -> Result<(), LineRpcError> {
        self.outbound
            .try_send(json!({ "id": self.id, "result": result }))
            .map_err(map_try_send_error)
    }

    pub async fn respond(self, result: Value) -> Result<(), LineRpcError> {
        self.outbound
            .send(json!({ "id": self.id, "result": result }))
            .await
            .map_err(|_| LineRpcError::Closed)
    }

    pub async fn reject(
        self,
        code: i64,
        message: impl Into<String>,
        data: Option<Value>,
    ) -> Result<(), LineRpcError> {
        let mut error = json!({
            "code": code,
            "message": message.into(),
        });
        if let Some(data) = data {
            error["data"] = data;
        }
        self.outbound
            .send(json!({ "id": self.id, "error": error }))
            .await
            .map_err(|_| LineRpcError::Closed)
    }

    pub fn try_reject(
        self,
        code: i64,
        message: impl Into<String>,
        data: Option<Value>,
    ) -> Result<(), LineRpcError> {
        let mut error = json!({
            "code": code,
            "message": message.into(),
        });
        if let Some(data) = data {
            error["data"] = data;
        }
        self.outbound
            .try_send(json!({ "id": self.id, "error": error }))
            .map_err(map_try_send_error)
    }
}

type PendingResponse = oneshot::Sender<Result<Value, LineRpcError>>;

struct LineRpcInner {
    outbound: mpsc::Sender<Value>,
    pending: Arc<Mutex<HashMap<u64, PendingResponse>>>,
    notifications: broadcast::Sender<LineRpcNotification>,
    server_requests: Mutex<Option<mpsc::Receiver<LineRpcServerRequest>>>,
    shutdown: watch::Sender<bool>,
    closed: watch::Receiver<bool>,
    next_id: AtomicU64,
}

impl Drop for LineRpcInner {
    fn drop(&mut self) {
        let _ = self.shutdown.send(true);
    }
}

#[derive(Clone)]
pub struct LineRpcClient {
    inner: Arc<LineRpcInner>,
}

impl LineRpcClient {
    pub fn spawn(
        program: impl AsRef<Path>,
        args: &[String],
        cwd: impl AsRef<Path>,
        env: &[(String, String)],
    ) -> Result<Self, LineRpcError> {
        let mut command = Command::new(program.as_ref());
        command
            .args(args)
            .current_dir(cwd)
            .envs(env.iter().cloned())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut child = command
            .spawn()
            .map_err(|error| LineRpcError::Spawn(error.to_string()))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| LineRpcError::Spawn("child process did not expose stdin".to_string()))?;
        let stdout = child.stdout.take().ok_or_else(|| {
            LineRpcError::Spawn("child process did not expose stdout".to_string())
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            LineRpcError::Spawn("child process did not expose stderr".to_string())
        })?;

        let (outbound_tx, outbound_rx) = mpsc::channel(OUTBOUND_CAPACITY);
        let (server_request_tx, server_request_rx) = mpsc::channel(SERVER_REQUEST_CAPACITY);
        let (notification_tx, _) = broadcast::channel(NOTIFICATION_CAPACITY);
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let (closed_tx, closed_rx) = watch::channel(false);
        let pending = Arc::new(Mutex::new(HashMap::new()));

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
            server_request_tx,
            notification_tx.clone(),
            shutdown_rx.clone(),
            shutdown_tx.clone(),
            pending.clone(),
        );
        spawn_stderr(stderr, shutdown_rx.clone());
        spawn_process_monitor(
            child,
            shutdown_rx,
            shutdown_tx.clone(),
            closed_tx,
            pending.clone(),
        );

        Ok(Self {
            inner: Arc::new(LineRpcInner {
                outbound: outbound_tx,
                pending,
                notifications: notification_tx,
                server_requests: Mutex::new(Some(server_request_rx)),
                shutdown: shutdown_tx,
                closed: closed_rx,
                next_id: AtomicU64::new(1),
            }),
        })
    }

    pub async fn request(
        &self,
        method: impl Into<String>,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, LineRpcError> {
        if *self.inner.closed.borrow() || *self.inner.shutdown.borrow() {
            return Err(LineRpcError::Closed);
        }

        let method = method.into();
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let (response_tx, response_rx) = oneshot::channel();
        {
            let mut pending = self
                .inner
                .pending
                .lock()
                .expect("line RPC pending lock poisoned");
            if pending.len() >= PENDING_REQUEST_CAPACITY {
                return Err(LineRpcError::Backpressure);
            }
            pending.insert(id, response_tx);
        }

        let outbound = self.inner.outbound.clone();
        let envelope = json!({ "id": id, "method": method, "params": params });
        let result = tokio::time::timeout(timeout, async move {
            outbound
                .send(envelope)
                .await
                .map_err(|_| LineRpcError::Closed)?;
            response_rx.await.map_err(|_| LineRpcError::Closed)?
        })
        .await;

        match result {
            Ok(result) => result,
            Err(_) => {
                self.inner
                    .pending
                    .lock()
                    .expect("line RPC pending lock poisoned")
                    .remove(&id);
                Err(LineRpcError::Timeout { method })
            }
        }
    }

    pub async fn notify(
        &self,
        method: impl Into<String>,
        params: Value,
    ) -> Result<(), LineRpcError> {
        if *self.inner.closed.borrow() || *self.inner.shutdown.borrow() {
            return Err(LineRpcError::Closed);
        }
        self.inner
            .outbound
            .send(json!({ "method": method.into(), "params": params }))
            .await
            .map_err(|_| LineRpcError::Closed)
    }

    pub async fn notify_without_params(
        &self,
        method: impl Into<String>,
    ) -> Result<(), LineRpcError> {
        if *self.inner.closed.borrow() || *self.inner.shutdown.borrow() {
            return Err(LineRpcError::Closed);
        }
        self.inner
            .outbound
            .send(json!({ "method": method.into() }))
            .await
            .map_err(|_| LineRpcError::Closed)
    }

    pub fn subscribe_notifications(&self) -> broadcast::Receiver<LineRpcNotification> {
        self.inner.notifications.subscribe()
    }

    pub fn take_server_requests(
        &self,
    ) -> Result<mpsc::Receiver<LineRpcServerRequest>, LineRpcError> {
        self.inner
            .server_requests
            .lock()
            .expect("line RPC server request lock poisoned")
            .take()
            .ok_or_else(|| {
                LineRpcError::Protocol("server request receiver has already been taken".to_string())
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
    pending: Arc<Mutex<HashMap<u64, PendingResponse>>>,
) {
    tokio::spawn(async move {
        let mut writer = FramedWrite::new(
            stdin,
            LinesCodec::new_with_max_length(MAX_LINE_RPC_MESSAGE_BYTES),
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
                        Ok(serialized) if serialized.len() <= MAX_LINE_RPC_MESSAGE_BYTES => serialized,
                        Ok(_) => {
                            fail_pending(&pending, LineRpcError::Protocol(
                                "outbound message exceeded the size limit".to_string(),
                            ));
                            let _ = shutdown_tx.send(true);
                            break;
                        }
                        Err(error) => {
                            fail_pending(&pending, LineRpcError::Protocol(error.to_string()));
                            let _ = shutdown_tx.send(true);
                            break;
                        }
                    };
                    if let Err(error) = writer.send(serialized).await {
                        fail_pending(&pending, LineRpcError::Protocol(error.to_string()));
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
    server_requests: mpsc::Sender<LineRpcServerRequest>,
    notifications: broadcast::Sender<LineRpcNotification>,
    mut shutdown: watch::Receiver<bool>,
    shutdown_tx: watch::Sender<bool>,
    pending: Arc<Mutex<HashMap<u64, PendingResponse>>>,
) {
    tokio::spawn(async move {
        let mut reader = FramedRead::new(
            stdout,
            LinesCodec::new_with_max_length(MAX_LINE_RPC_MESSAGE_BYTES),
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
                    fail_pending(&pending, LineRpcError::Protocol(error.to_string()));
                    break;
                }
            };
            let message: Value = match serde_json::from_str(&line) {
                Ok(message) => message,
                Err(error) => {
                    fail_pending(
                        &pending,
                        LineRpcError::Protocol(format!("invalid JSON: {error}")),
                    );
                    break;
                }
            };
            route_message(
                message,
                &outbound,
                &server_requests,
                &notifications,
                &pending,
            );
        }
        let _ = shutdown_tx.send(true);
    });
}

fn route_message(
    message: Value,
    outbound: &mpsc::Sender<Value>,
    server_requests: &mpsc::Sender<LineRpcServerRequest>,
    notifications: &broadcast::Sender<LineRpcNotification>,
    pending: &Arc<Mutex<HashMap<u64, PendingResponse>>>,
) {
    let method = message.get("method").and_then(Value::as_str);
    let id = message.get("id").cloned();

    if method.is_none() {
        let Some(id) = id.and_then(|id| id.as_u64()) else {
            return;
        };
        let Some(response) = pending
            .lock()
            .expect("line RPC pending lock poisoned")
            .remove(&id)
        else {
            return;
        };
        let result = if let Some(error) = message.get("error") {
            Err(LineRpcError::Remote(parse_remote_error(error)))
        } else if let Some(result) = message.get("result") {
            Ok(result.clone())
        } else {
            Err(LineRpcError::Protocol(
                "response omitted both result and error".to_string(),
            ))
        };
        let _ = response.send(result);
        return;
    }

    let method = method.expect("checked above").to_string();
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    if let Some(id) = id {
        let request = LineRpcServerRequest {
            id: id.clone(),
            method,
            params,
            outbound: outbound.clone(),
        };
        if server_requests.try_send(request).is_err() {
            let _ = outbound.try_send(json!({
                "id": id,
                "error": {
                    "code": -32001,
                    "message": "client server-request queue is full"
                }
            }));
        }
        return;
    }

    let _ = notifications.send(LineRpcNotification { method, params });
}

fn parse_remote_error(error: &Value) -> LineRpcRemoteError {
    LineRpcRemoteError {
        code: error.get("code").and_then(Value::as_i64).unwrap_or(-32_000),
        message: error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown remote error")
            .to_string(),
        data: error.get("data").cloned(),
    }
}

fn spawn_stderr(stderr: tokio::process::ChildStderr, mut shutdown: watch::Receiver<bool>) {
    tokio::spawn(async move {
        let mut reader = FramedRead::new(
            stderr,
            LinesCodec::new_with_max_length(MAX_LINE_RPC_MESSAGE_BYTES),
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
                        Ok(line) => tracing::debug!(target: "line_rpc_stderr", "{line}"),
                        Err(error) => {
                            tracing::warn!(target: "line_rpc_stderr", %error, "stderr stream failed");
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
    pending: Arc<Mutex<HashMap<u64, PendingResponse>>>,
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
        fail_pending(&pending, LineRpcError::Closed);
        let _ = shutdown_tx.send(true);
        let _ = closed_tx.send(true);
    });
}

fn fail_pending(pending: &Arc<Mutex<HashMap<u64, PendingResponse>>>, error: LineRpcError) {
    let pending = std::mem::take(&mut *pending.lock().expect("line RPC pending lock poisoned"));
    for (_, response) in pending {
        let _ = response.send(Err(error.clone()));
    }
}

fn map_try_send_error<T>(error: mpsc::error::TrySendError<T>) -> LineRpcError {
    match error {
        mpsc::error::TrySendError::Full(_) => LineRpcError::Backpressure,
        mpsc::error::TrySendError::Closed(_) => LineRpcError::Closed,
    }
}
