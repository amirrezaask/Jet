use crate::config::Config;
use crate::host::HostState;
use crate::persistence::Database;
use crate::static_files;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::compression::CompressionLayer;
use tower_http::trace::TraceLayer;

pub struct AppState {
    pub config: Config,
    pub database: Database,
    pub host: HostState,
    pub launch_config: Value,
}

impl AppState {
    pub fn new(config: Config, database: Database) -> anyhow::Result<Self> {
        let home = dirs::home_dir()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let cwd = std::env::current_dir()?;
        let args = vec![config.launch_path.to_string_lossy().into_owned()];
        let launch = crate::host::launch::resolve_launch_target(&args, &cwd);
        Ok(Self {
            config,
            database,
            host: HostState::new(home, std::time::Instant::now()),
            launch_config: serde_json::to_value(launch)?,
        })
    }
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/v1/system", get(system))
        .route("/api/v1/rpc", post(rpc))
        .route("/api/v1/projects", get(list_projects).post(add_project))
        .route("/api/v1/projects/{id}", delete(remove_project))
        .route(
            "/api/v1/projects/{id}/file",
            get(read_project_file).put(write_project_file),
        )
        .route("/api/v1/projects/{id}/files", get(list_project_files))
        .route("/ws", get(websocket))
        .route("/ws/lsp/{id}", get(lsp_websocket))
        .fallback(|uri: Uri| async move { static_files::serve(uri).await })
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn health() -> Json<Value> {
    Json(serde_json::json!({ "status": "ok", "version": env!("CARGO_PKG_VERSION") }))
}

async fn system(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(serde_json::json!({
        "name": "Jet", "version": env!("CARGO_PKG_VERSION"), "protocolVersion": 1,
        "launchConfig": state.launch_config, "homeDir": state.host.home_dir,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcRequest {
    channel: String,
    #[serde(default)]
    args: Vec<Value>,
    #[serde(default = "default_client_id")]
    client_id: String,
}

fn default_client_id() -> String {
    "browser".to_string()
}

#[derive(Serialize)]
struct RpcResponse {
    value: Value,
}

async fn rpc(State(state): State<Arc<AppState>>, Json(request): Json<RpcRequest>) -> Response {
    if let Err(error) = validate_rpc_paths(&state.config, &request.channel, &request.args) {
        return api_error(StatusCode::FORBIDDEN, "PATH_OUTSIDE_ALLOWED_ROOTS", error);
    }
    if request.channel == "gharargah:getLaunchConfig" {
        return Json(RpcResponse {
            value: state.launch_config.clone(),
        })
        .into_response();
    }
    if matches!(
        request.channel.as_str(),
        "fs:showOpenFolderDialog" | "fs:showSaveFileDialog"
    ) {
        return Json(RpcResponse { value: Value::Null }).into_response();
    }
    let channel = request.channel.clone();
    let session_id = request
        .args
        .first()
        .and_then(Value::as_str)
        .map(str::to_string);
    match state
        .host
        .invoke(&request.channel, request.args, &request.client_id)
    {
        Ok(value) => {
            if channel == "terminal:create" {
                if let Some(id) = value.get("id").and_then(Value::as_str) {
                    let _ = state
                        .database
                        .record_session(id, "terminal", "running", &value);
                }
            } else if channel == "terminal:dispose" {
                if let Some(id) = session_id {
                    let _ = state.database.update_session_status(&id, "stopped");
                }
            } else if channel == "agents:createThread" {
                if let Some(id) = value.get("id").and_then(Value::as_str) {
                    let _ = state
                        .database
                        .record_session(id, "agent", "waiting", &value);
                }
            }
            Json(RpcResponse { value }).into_response()
        }
        Err(error) if error.starts_with("unknown ") => {
            api_error(StatusCode::NOT_FOUND, "UNKNOWN_OPERATION", error)
        }
        Err(error) => api_error(StatusCode::BAD_REQUEST, "OPERATION_FAILED", error),
    }
}

fn validate_rpc_paths(config: &Config, channel: &str, args: &[Value]) -> Result<(), String> {
    if channel.starts_with("agents:") {
        let input = args.first().and_then(Value::as_object);
        let raw = input.and_then(|input| {
            input
                .get("workspaceRootPath")
                .and_then(Value::as_str)
                .or_else(|| input.get("workspaceRootUri").and_then(Value::as_str))
        });
        if let Some(raw) = raw {
            let path = if raw.starts_with("file:") {
                PathBuf::from(crate::host::launch::uri_to_path(raw))
            } else {
                PathBuf::from(raw)
            };
            if !config.path_allowed(&path) {
                return Err(format!(
                    "path is outside configured roots: {}",
                    path.display()
                ));
            }
        }
    }
    if channel == "tasks:spawn" {
        if let Some(raw) = args
            .first()
            .and_then(|value| value.get("cwd"))
            .and_then(Value::as_str)
        {
            if !config.path_allowed(std::path::Path::new(raw)) {
                return Err(format!("path is outside configured roots: {raw}"));
            }
        }
    }
    let path_value = match channel.split(':').next().unwrap_or_default() {
        "fs" | "git" | "search" | "workspace" | "lsp" | "terminal" => {
            args.first().and_then(Value::as_str)
        }
        _ => None,
    };
    let Some(raw) = path_value else {
        return Ok(());
    };
    if channel.starts_with("terminal:") && !raw.starts_with("file:") {
        return Ok(());
    }
    let path = if raw.starts_with("file:") {
        PathBuf::from(crate::host::launch::uri_to_path(raw))
    } else {
        PathBuf::from(raw)
    };
    if config.path_allowed(&path) {
        Ok(())
    } else {
        Err(format!(
            "path is outside configured roots: {}",
            path.display()
        ))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddProject {
    root_path: PathBuf,
    name: Option<String>,
}

async fn list_projects(State(state): State<Arc<AppState>>) -> Response {
    match state.database.projects() {
        Ok(projects) => Json(projects).into_response(),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATABASE_ERROR",
            error.to_string(),
        ),
    }
}

async fn add_project(
    State(state): State<Arc<AppState>>,
    Json(input): Json<AddProject>,
) -> Response {
    if !state.config.path_allowed(&input.root_path) {
        return api_error(
            StatusCode::FORBIDDEN,
            "PATH_OUTSIDE_ALLOWED_ROOTS",
            "project path is outside configured roots".into(),
        );
    }
    if !input.root_path.is_dir() {
        return api_error(
            StatusCode::BAD_REQUEST,
            "INVALID_PROJECT_PATH",
            "project path is not a directory".into(),
        );
    }
    match state
        .database
        .add_project(&input.root_path, input.name.as_deref())
    {
        Ok(project) => (StatusCode::CREATED, Json(project)).into_response(),
        Err(error) => api_error(
            StatusCode::BAD_REQUEST,
            "PROJECT_CREATE_FAILED",
            error.to_string(),
        ),
    }
}

async fn remove_project(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    match state.database.remove_project(&id) {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => api_error(
            StatusCode::NOT_FOUND,
            "PROJECT_NOT_FOUND",
            "project does not exist".into(),
        ),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATABASE_ERROR",
            error.to_string(),
        ),
    }
}

#[derive(Deserialize)]
struct FileQuery {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteFileRequest {
    path: String,
    content: String,
    expected_version: Option<String>,
}

async fn read_project_file(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<FileQuery>,
) -> Response {
    let path = match resolve_project_path(&state, &id, &query.path) {
        Ok(path) => path,
        Err(response) => return *response,
    };
    match std::fs::read_to_string(&path) {
        Ok(content) => Json(serde_json::json!({ "path": query.path, "content": content, "version": file_version(&path) })).into_response(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => api_error(StatusCode::NOT_FOUND, "FILE_NOT_FOUND", error.to_string()),
        Err(error) => api_error(StatusCode::BAD_REQUEST, "FILE_READ_FAILED", error.to_string()),
    }
}

async fn write_project_file(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(input): Json<WriteFileRequest>,
) -> Response {
    let path = match resolve_project_path(&state, &id, &input.path) {
        Ok(path) => path,
        Err(response) => return *response,
    };
    if let Some(expected) = input.expected_version.as_deref() {
        if path.exists() && file_version(&path) != expected {
            return api_error(
                StatusCode::CONFLICT,
                "FILE_CHANGED",
                "file changed on disk".into(),
            );
        }
    }
    let Some(parent) = path.parent() else {
        return api_error(
            StatusCode::BAD_REQUEST,
            "INVALID_PATH",
            "file has no parent".into(),
        );
    };
    if let Err(error) = std::fs::create_dir_all(parent) {
        return api_error(
            StatusCode::BAD_REQUEST,
            "FILE_WRITE_FAILED",
            error.to_string(),
        );
    }
    let temporary = parent.join(format!(".jet-write-{}", uuid::Uuid::new_v4()));
    let result = std::fs::write(&temporary, input.content.as_bytes())
        .and_then(|_| std::fs::rename(&temporary, &path));
    if let Err(error) = result {
        let _ = std::fs::remove_file(&temporary);
        return api_error(
            StatusCode::BAD_REQUEST,
            "FILE_WRITE_FAILED",
            error.to_string(),
        );
    }
    Json(serde_json::json!({ "path": input.path, "version": file_version(&path) })).into_response()
}

async fn list_project_files(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<FileQuery>,
) -> Response {
    let path = match resolve_project_path(&state, &id, &query.path) {
        Ok(path) => path,
        Err(response) => return *response,
    };
    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) => {
            return api_error(
                StatusCode::BAD_REQUEST,
                "DIRECTORY_READ_FAILED",
                error.to_string(),
            )
        }
    };
    let mut output = Vec::new();
    for entry in entries.flatten() {
        if let Ok(kind) = entry.file_type() {
            output.push(serde_json::json!({ "name": entry.file_name().to_string_lossy(), "isDirectory": kind.is_dir() }));
        }
    }
    output.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    Json(output).into_response()
}

fn resolve_project_path(
    state: &AppState,
    id: &str,
    relative: &str,
) -> Result<PathBuf, Box<Response>> {
    if relative.len() > 32_768 || std::path::Path::new(relative).is_absolute() {
        return Err(Box::new(api_error(
            StatusCode::BAD_REQUEST,
            "INVALID_PATH",
            "path must be project-relative".into(),
        )));
    }
    if std::path::Path::new(relative)
        .components()
        .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(Box::new(api_error(
            StatusCode::BAD_REQUEST,
            "PATH_TRAVERSAL",
            "parent traversal is not allowed".into(),
        )));
    }
    let project = state
        .database
        .project(id)
        .map_err(|error| {
            Box::new(api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "DATABASE_ERROR",
                error.to_string(),
            ))
        })?
        .ok_or_else(|| {
            Box::new(api_error(
                StatusCode::NOT_FOUND,
                "PROJECT_NOT_FOUND",
                "project does not exist".into(),
            ))
        })?;
    let root = PathBuf::from(project.root_path);
    let path = root.join(relative);
    if !state.config.path_allowed(&path) || !path_stays_within(&root, &path) {
        return Err(Box::new(api_error(
            StatusCode::FORBIDDEN,
            "PATH_OUTSIDE_ALLOWED_ROOTS",
            "path escapes the project boundary".into(),
        )));
    }
    Ok(path)
}

fn path_stays_within(root: &std::path::Path, path: &std::path::Path) -> bool {
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    let mut existing = path.to_path_buf();
    while !existing.exists() {
        let Some(parent) = existing.parent() else {
            return false;
        };
        existing = parent.to_path_buf();
    }
    existing
        .canonicalize()
        .is_ok_and(|resolved| resolved.starts_with(root))
}

fn file_version(path: &std::path::Path) -> String {
    let Ok(metadata) = path.metadata() else {
        return "missing".into();
    };
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|time| time.as_nanos())
        .unwrap_or(0);
    format!("{modified}:{}", metadata.len())
}

#[derive(Deserialize)]
struct RealtimeQuery {
    #[serde(default)]
    since: u64,
}

async fn websocket(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RealtimeQuery>,
    upgrade: WebSocketUpgrade,
) -> Response {
    upgrade.on_upgrade(move |socket| websocket_loop(state, socket, query.since))
}

async fn websocket_loop(state: Arc<AppState>, socket: WebSocket, since: u64) {
    let (mut sender, mut receiver) = socket.split();
    let mut events = state.host.events.subscribe();
    for event in state.host.events.replay_after(since) {
        let Ok(text) = serde_json::to_string(&event) else {
            continue;
        };
        if sender.send(Message::Text(text.into())).await.is_err() {
            return;
        }
    }
    loop {
        tokio::select! {
            event = events.recv() => match event {
                Ok(event) => {
                    let Ok(text) = serde_json::to_string(&event) else { continue };
                    if sender.send(Message::Text(text.into())).await.is_err() { break; }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    let text = serde_json::json!({"protocolVersion":1,"type":"protocol.error","error":{"code":"CLIENT_LAGGED","message":format!("client missed {skipped} events")}}).to_string();
                    if sender.send(Message::Text(text.into())).await.is_err() { break; }
                }
                Err(_) => break,
            },
            message = receiver.next() => match message {
                Some(Ok(Message::Ping(bytes))) => { if sender.send(Message::Pong(bytes)).await.is_err() { break; } }
                Some(Ok(Message::Text(text))) if text == "ping" => { if sender.send(Message::Text("pong".into())).await.is_err() { break; } }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            }
        }
    }
}

async fn lsp_websocket(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    upgrade: WebSocketUpgrade,
) -> Response {
    let Some(port) = state.host.lsp.transport_port(&id) else {
        return api_error(
            StatusCode::NOT_FOUND,
            "LSP_NOT_FOUND",
            "language server does not exist".into(),
        );
    };
    upgrade.on_upgrade(move |socket| proxy_lsp_socket(socket, port))
}

async fn proxy_lsp_socket(browser: WebSocket, port: u16) {
    let Ok((upstream, _)) =
        tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}")).await
    else {
        return;
    };
    let (mut browser_tx, mut browser_rx) = browser.split();
    let (mut upstream_tx, mut upstream_rx) = upstream.split();
    loop {
        tokio::select! {
            message = browser_rx.next() => match message {
                Some(Ok(Message::Text(text))) => if upstream_tx.send(tokio_tungstenite::tungstenite::Message::Text(text.to_string())).await.is_err() { break },
                Some(Ok(Message::Binary(bytes))) => if upstream_tx.send(tokio_tungstenite::tungstenite::Message::Binary(bytes.to_vec())).await.is_err() { break },
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            },
            message = upstream_rx.next() => match message {
                Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => if browser_tx.send(Message::Text(text.into())).await.is_err() { break },
                Some(Ok(tokio_tungstenite::tungstenite::Message::Binary(bytes))) => if browser_tx.send(Message::Binary(bytes.into())).await.is_err() { break },
                Some(Ok(tokio_tungstenite::tungstenite::Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            }
        }
    }
}

fn api_error(status: StatusCode, code: &str, message: String) -> Response {
    (
        status,
        Json(serde_json::json!({ "error": { "code": code, "message": message, "details": {} } })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    fn state(root: &std::path::Path) -> Arc<AppState> {
        let config = Config {
            host: "127.0.0.1".into(),
            port: 0,
            data_dir: root.into(),
            allowed_roots: vec![root.canonicalize().unwrap()],
            open_browser: false,
            log_filter: "info".into(),
            launch_path: root.into(),
        };
        Arc::new(AppState::new(config, Database::open(root.join("test.sqlite")).unwrap()).unwrap())
    }

    #[tokio::test]
    async fn health_and_unknown_api_have_correct_precedence() {
        let root = tempfile::tempdir().unwrap();
        let app = router(state(root.path()));
        let response = app
            .clone()
            .oneshot(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let response = app
            .oneshot(Request::get("/api/v1/missing").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn rpc_rejects_paths_outside_allowed_root() {
        let root = tempfile::tempdir().unwrap();
        let app = router(state(root.path()));
        let body =
            serde_json::json!({"channel":"fs:readFile","args":["file:///etc/passwd"]}).to_string();
        let response = app
            .oneshot(
                Request::post("/api/v1/rpc")
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
}
