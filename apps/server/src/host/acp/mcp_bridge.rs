//! Loopback HTTP MCP bridge injected into ACP `session/new` / `session/load` (t3code parity).

use agent_client_protocol::schema::v1::{HttpHeader, McpServer, McpServerHttp};
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::post;
use axum::Router;
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::oneshot;
use uuid::Uuid;

#[derive(Clone)]
struct BridgeState {
    token: String,
    workspace_root: Arc<Mutex<Option<String>>>,
}

struct BridgeHandle {
    endpoint: String,
    token: String,
    workspace_root: Arc<Mutex<Option<String>>>,
    _shutdown: oneshot::Sender<()>,
}

static BRIDGE: OnceLock<Mutex<Option<BridgeHandle>>> = OnceLock::new();

fn bridge_slot() -> &'static Mutex<Option<BridgeHandle>> {
    BRIDGE.get_or_init(|| Mutex::new(None))
}

/// Ensure the process-wide loopback MCP bridge is running; return ACP `mcpServers` list.
pub fn ensure_mcp_servers(workspace_root: Option<&str>) -> Vec<McpServer> {
    let slot = bridge_slot();
    let mut guard = match slot.lock() {
        Ok(guard) => guard,
        Err(_) => return Vec::new(),
    };
    if guard.is_none() {
        match spawn_bridge() {
            Ok(handle) => *guard = Some(handle),
            Err(error) => {
                tracing::warn!(%error, "failed to start ACP MCP bridge");
                return Vec::new();
            }
        }
    }
    let Some(handle) = guard.as_ref() else {
        return Vec::new();
    };
    if let Some(root) = workspace_root {
        if let Ok(mut cwd) = handle.workspace_root.lock() {
            *cwd = Some(root.to_string());
        }
    }
    let server = McpServer::Http(
        McpServerHttp::new("gharargah", handle.endpoint.clone()).headers(vec![HttpHeader::new(
            "Authorization",
            format!("Bearer {}", handle.token),
        )]),
    );
    vec![server]
}

fn spawn_bridge() -> Result<BridgeHandle, String> {
    let token = Uuid::new_v4().to_string();
    let workspace_root = Arc::new(Mutex::new(None));
    let state = BridgeState {
        token: token.clone(),
        workspace_root: workspace_root.clone(),
    };
    let app = Router::new()
        .route("/", post(handle_mcp))
        .route("/mcp", post(handle_mcp))
        .with_state(state);

    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    let endpoint = format!("http://127.0.0.1:{}/mcp", addr.port());
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    std::thread::Builder::new()
        .name("gharargah-mcp-bridge".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(error) => {
                    tracing::error!(%error, "MCP bridge runtime failed");
                    return;
                }
            };
            rt.block_on(async move {
                let listener = match tokio::net::TcpListener::from_std(listener) {
                    Ok(listener) => listener,
                    Err(error) => {
                        tracing::error!(%error, "MCP bridge listener failed");
                        return;
                    }
                };
                let server = axum::serve(
                    listener,
                    app.into_make_service_with_connect_info::<SocketAddr>(),
                );
                tokio::select! {
                    result = server => {
                        if let Err(error) = result {
                            tracing::warn!(%error, "MCP bridge stopped");
                        }
                    }
                    _ = shutdown_rx => {}
                }
            });
        })
        .map_err(|e| e.to_string())?;

    Ok(BridgeHandle {
        endpoint,
        token,
        workspace_root,
        _shutdown: shutdown_tx,
    })
}

async fn handle_mcp(
    State(state): State<BridgeState>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let expected = format!("Bearer {}", state.token);
    if auth != expected {
        return (
            StatusCode::UNAUTHORIZED,
            json!({"jsonrpc":"2.0","error":{"code":-32001,"message":"unauthorized"},"id":null})
                .to_string(),
        );
    }

    let request: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                json!({"jsonrpc":"2.0","error":{"code":-32700,"message":"parse error"},"id":null})
                    .to_string(),
            );
        }
    };

    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request.get("method").and_then(Value::as_str).unwrap_or("");
    let result = match method {
        "initialize" => json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "gharargah", "version": env!("CARGO_PKG_VERSION") }
        }),
        "notifications/initialized" | "initialized" => {
            // Notification — empty ack body is fine for streamable HTTP clients that still POST.
            return (StatusCode::ACCEPTED, String::new());
        }
        "ping" => json!({}),
        "tools/list" => json!({
            "tools": [{
                "name": "gharargah_ping",
                "description": "Health check for the Gharargah host MCP bridge",
                "inputSchema": { "type": "object", "properties": {} }
            }, {
                "name": "gharargah_workspace_root",
                "description": "Return the workspace root bound to the current ACP session",
                "inputSchema": { "type": "object", "properties": {} }
            }]
        }),
        "tools/call" => {
            let name = request
                .pointer("/params/name")
                .and_then(Value::as_str)
                .unwrap_or("");
            match name {
                "gharargah_ping" => json!({
                    "content": [{ "type": "text", "text": "pong" }]
                }),
                "gharargah_workspace_root" => {
                    let root = state
                        .workspace_root
                        .lock()
                        .ok()
                        .and_then(|g| g.clone())
                        .unwrap_or_default();
                    json!({
                        "content": [{ "type": "text", "text": root }]
                    })
                }
                _ => {
                    return (
                        StatusCode::OK,
                        json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": { "code": -32601, "message": format!("unknown tool: {name}") }
                        })
                        .to_string(),
                    );
                }
            }
        }
        _ => {
            return (
                StatusCode::OK,
                json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32601, "message": format!("method not found: {method}") }
                })
                .to_string(),
            );
        }
    };

    (
        StatusCode::OK,
        json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_mcp_servers_returns_http_entry() {
        let servers = ensure_mcp_servers(Some("/tmp/ws"));
        assert_eq!(servers.len(), 1);
        match &servers[0] {
            McpServer::Http(http) => {
                assert_eq!(http.name, "gharargah");
                assert!(http.url.contains("127.0.0.1"));
                assert!(!http.headers.is_empty());
            }
            _ => panic!("expected HTTP MCP server"),
        }
    }
}
