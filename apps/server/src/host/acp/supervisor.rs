use super::connection_pool::{ConnectionPool, InitializedInfo, TurnJob};
use super::profiles::ProviderProfile;
use super::redaction::redact_json;
use super::types::{ConnectionState, NormalizedEvent, ProviderConnectionSnapshot};
use agent_client_protocol::schema::v1::{RequestPermissionOutcome, RequestPermissionRequest};
use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::{oneshot, watch};
use uuid::Uuid;

const MAX_TRACE_ENTRIES: usize = 200;

pub type SupervisorEventSink = Arc<dyn Fn(u64, NormalizedEvent) + Send + Sync>;

pub struct SupervisorTurnRequest {
    pub provider: ProviderProfile,
    pub workspace_root: PathBuf,
    pub thread_key: String,
    pub prompt: String,
    pub model: Option<String>,
    pub existing_session_id: Option<String>,
    pub on_session: Arc<dyn Fn(&str) + Send + Sync>,
    pub on_text: Arc<dyn Fn(&str) + Send + Sync>,
    pub on_activity: Arc<dyn Fn(&str) + Send + Sync>,
    pub on_event: SupervisorEventSink,
}

pub struct SupervisorTurnResult {
    pub session_id: String,
    pub text: String,
    pub cancelled: bool,
}

struct ActiveTurn {
    cancel: watch::Sender<bool>,
    connection_key: String,
}

struct ConnectionRecord {
    snapshot: ProviderConnectionSnapshot,
    trace: Vec<Value>,
    auth_required: bool,
    supports_list_sessions: bool,
    supports_close_session: bool,
}

#[derive(Clone, Default)]
pub struct AcpSupervisor {
    active: Arc<Mutex<HashMap<String, ActiveTurn>>>,
    permissions: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
    connections: Arc<Mutex<HashMap<String, ConnectionRecord>>>,
    pool: ConnectionPool,
}

impl AcpSupervisor {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn run_turn(
        &self,
        request: SupervisorTurnRequest,
    ) -> Result<SupervisorTurnResult, String> {
        let connection_key = format!(
            "{}:{}",
            request.provider.id,
            request.workspace_root.display()
        );
        let started_at_ms = now_ms();
        {
            let mut connections = self
                .connections
                .lock()
                .map_err(|_| "ACP connection lock poisoned")?;
            let record = connections
                .entry(connection_key.clone())
                .or_insert_with(|| ConnectionRecord {
                    snapshot: ProviderConnectionSnapshot {
                        provider_id: request.provider.id.to_string(),
                        state: ConnectionState::NotStarted,
                        detail: None,
                        process_id: None,
                        restart_count: 0,
                        started_at_ms: Some(started_at_ms),
                        last_transition_at_ms: started_at_ms,
                        last_error: None,
                    },
                    trace: Vec::new(),
                    auth_required: false,
                    supports_list_sessions: false,
                    supports_close_session: false,
                });
            record.snapshot.state = ConnectionState::Starting;
            record.snapshot.last_transition_at_ms = now_ms();
            record
                .trace
                .push(json!({"event":"turn_start","threadKey":request.thread_key}));
        }
        let (cancel_tx, cancel_rx) = watch::channel(false);
        {
            let mut active = self.active.lock().map_err(|_| "ACP turn lock poisoned")?;
            if active.contains_key(&request.thread_key) {
                return Err("turn_already_running".to_string());
            }
            active.insert(
                request.thread_key.clone(),
                ActiveTurn {
                    cancel: cancel_tx,
                    connection_key: connection_key.clone(),
                },
            );
        }

        let executable = match request.provider.resolve_executable() {
            Ok(path) => path,
            Err(error) => {
                let _ = self.active.lock().ok().and_then(|mut active| {
                    active.remove(&request.thread_key);
                    Some(())
                });
                return Err(error.to_string());
            }
        };

        let pending = self.permissions.clone();
        let thread_key = request.thread_key.clone();
        let connections_for_trace = self.connections.clone();
        let connection_key_for_trace = connection_key.clone();
        let user_on_event = request.on_event.clone();
        let on_event: SupervisorEventSink = Arc::new(move |sequence, event| {
            if let Ok(mut connections) = connections_for_trace.lock() {
                if let Some(record) = connections.get_mut(&connection_key_for_trace) {
                    let payload = serde_json::to_value(&event).unwrap_or(Value::Null);
                    record.trace.push(json!({
                        "event": "structured",
                        "sequence": sequence,
                        "payload": redact_json(&payload),
                    }));
                    if record.trace.len() > MAX_TRACE_ENTRIES {
                        let overflow = record.trace.len() - MAX_TRACE_ENTRIES;
                        record.trace.drain(0..overflow);
                    }
                }
            }
            user_on_event(sequence, event);
        });
        let event = on_event.clone();
        let on_permission: Arc<
            dyn Fn(RequestPermissionRequest) -> BoxFuture<'static, RequestPermissionOutcome>
                + Send
                + Sync,
        > = Arc::new(move |permission| {
            let request_id = Uuid::new_v4().to_string();
            let (tx, rx) = oneshot::channel();
            pending
                .lock()
                .expect("ACP permission lock poisoned")
                .insert(request_id.clone(), tx);
            let ui_options: Vec<String> = permission
                .options
                .iter()
                .map(|option| match option.kind {
                    agent_client_protocol::schema::v1::PermissionOptionKind::AllowOnce => {
                        "allow_once".to_string()
                    }
                    agent_client_protocol::schema::v1::PermissionOptionKind::AllowAlways => {
                        "allow_always".to_string()
                    }
                    agent_client_protocol::schema::v1::PermissionOptionKind::RejectOnce
                    | agent_client_protocol::schema::v1::PermissionOptionKind::RejectAlways => {
                        "reject".to_string()
                    }
                    _ => option.option_id.0.to_string(),
                })
                .collect();
            let title = permission
                .tool_call
                .fields
                .title
                .clone()
                .unwrap_or_else(|| "Permission required".to_string());
            let option_ids: Vec<Value> = permission
                .options
                .iter()
                .map(|option| {
                    json!({
                        "id": option.option_id.0.as_ref(),
                        "kind": format!("{:?}", option.kind),
                        "name": option.name,
                    })
                })
                .collect();
            // Use a high sequence so App.tsx's acpSequence gate does not drop
            // this update after earlier pipeline events (tool_call, etc.).
            let permission_sequence = now_ms().max(1);
            event(
                permission_sequence,
                NormalizedEvent::Timeline(super::types::TimelineItem {
                    kind: super::types::TimelineItemKind::Permission,
                    id: request_id.clone(),
                    session_id: permission.session_id.0.to_string(),
                    turn_id: Some(thread_key.clone()),
                    payload: json!({
                        "id": request_id,
                        "requestId": request_id,
                        "title": title,
                        "description": null,
                        "scope": null,
                        "options": ui_options,
                        "optionIds": option_ids,
                        "createdAt": chrono::Utc::now().to_rfc3339(),
                        "toolCall": permission.tool_call,
                    }),
                }),
            );
            Box::pin(async move {
                match rx.await {
                    Ok(option_id) => RequestPermissionOutcome::Selected(
                        agent_client_protocol::schema::v1::SelectedPermissionOutcome::new(
                            option_id,
                        ),
                    ),
                    Err(_) => RequestPermissionOutcome::Cancelled,
                }
            })
        });

        let connections_for_init = self.connections.clone();
        let connection_key_for_init = connection_key.clone();
        let on_initialized: Arc<dyn Fn(InitializedInfo) + Send + Sync> =
            Arc::new(move |info: InitializedInfo| {
                if let Ok(mut connections) = connections_for_init.lock() {
                    if let Some(record) = connections.get_mut(&connection_key_for_init) {
                        record.auth_required = info.auth_required;
                        record.supports_list_sessions = info.supports_list_sessions;
                        record.supports_close_session = info.supports_close_session;
                        record.snapshot.last_transition_at_ms = now_ms();
                        if info.auth_required {
                            record.snapshot.state = ConnectionState::AuthenticationRequired;
                            record.snapshot.detail =
                                Some("authentication_required".to_string());
                        } else {
                            record.snapshot.state = ConnectionState::Ready;
                        }
                    }
                }
            });

        let (respond_placeholder, _) = oneshot::channel();
        let result = self
            .pool
            .run_turn(
                connection_key.clone(),
                executable.to_string_lossy().into_owned(),
                request.provider.spawn_args.clone(),
                TurnJob {
                    cwd: request.workspace_root,
                    prompt: request.prompt,
                    model: request.model,
                    turn_id: request.thread_key.clone(),
                    existing_session_id: request.existing_session_id,
                    cancel: cancel_rx,
                    on_session: request.on_session,
                    on_text: request.on_text,
                    on_activity: request.on_activity,
                    on_event,
                    on_permission,
                    on_initialized,
                    respond: respond_placeholder,
                },
            )
            .await;

        self.active
            .lock()
            .ok()
            .and_then(|mut active| active.remove(&request.thread_key));
        let mut connections = self
            .connections
            .lock()
            .map_err(|_| "ACP connection lock poisoned")?;
        let record = connections
            .get_mut(&connection_key)
            .expect("connection inserted");
        record.snapshot.last_transition_at_ms = now_ms();
        match result {
            Ok(result) => {
                if !record.auth_required {
                    record.snapshot.state = ConnectionState::Ready;
                }
                record
                    .trace
                    .push(json!({"event":"turn_finish","sessionId":result.session_id}));
                Ok(SupervisorTurnResult {
                    session_id: result.session_id,
                    text: result.text,
                    cancelled: matches!(
                        result.stop_reason,
                        agent_client_protocol::schema::v1::StopReason::Cancelled
                    ),
                })
            }
            Err(error) => {
                record.snapshot.state = ConnectionState::Degraded;
                record.snapshot.last_error = Some(error.clone());
                record
                    .trace
                    .push(json!({"event":"turn_error","error":error}));
                Err(error)
            }
        }
    }

    /// Drop the long-lived worker for `connection_key` so the provider process exits.
    pub fn force_stop_connection(&self, connection_key: &str) -> Result<(), String> {
        let thread_keys: Vec<String> = self
            .active
            .lock()
            .map_err(|_| "ACP turn lock poisoned")?
            .iter()
            .filter(|(_, turn)| turn.connection_key == connection_key)
            .map(|(key, _)| key.clone())
            .collect();
        for key in &thread_keys {
            self.cancel_turn(key);
        }
        if let Ok(mut active) = self.active.lock() {
            for key in thread_keys {
                active.remove(&key);
            }
        }
        self.pool.force_stop(connection_key);
        if let Ok(mut connections) = self.connections.lock() {
            if let Some(record) = connections.get_mut(connection_key) {
                record.snapshot.state = ConnectionState::Stopped;
                record.snapshot.last_transition_at_ms = now_ms();
                record
                    .trace
                    .push(json!({"event":"force_stop","connectionKey":connection_key}));
            }
        }
        Ok(())
    }

    /// Capability-gated stub: returns `unsupported_capability` unless the agent
    /// advertised `sessionCapabilities.list`.
    pub fn list_sessions(&self, connection_key: &str) -> Result<Value, String> {
        let supports = self
            .connections
            .lock()
            .map_err(|_| "ACP connection lock poisoned")?
            .get(connection_key)
            .map(|record| record.supports_list_sessions)
            .or_else(|| {
                Some(
                    self.pool
                        .connection_meta(connection_key)
                        .supports_list_sessions,
                )
            })
            .unwrap_or(false);
        if !supports {
            return Err("unsupported_capability".to_string());
        }
        Err("session_list_not_implemented".to_string())
    }

    /// Capability-gated stub: returns `unsupported_capability` unless the agent
    /// advertised `sessionCapabilities.close`.
    pub fn close_session(&self, connection_key: &str, _session_id: &str) -> Result<(), String> {
        let supports = self
            .connections
            .lock()
            .map_err(|_| "ACP connection lock poisoned")?
            .get(connection_key)
            .map(|record| record.supports_close_session)
            .or_else(|| {
                Some(
                    self.pool
                        .connection_meta(connection_key)
                        .supports_close_session,
                )
            })
            .unwrap_or(false);
        if !supports {
            return Err("unsupported_capability".to_string());
        }
        Err("session_close_not_implemented".to_string())
    }

    /// Auth stub: no-op success when auth is not required; otherwise clear error.
    pub fn authenticate(
        &self,
        connection_key: &str,
        _method_id: Option<&str>,
    ) -> Result<(), String> {
        let auth_required = self
            .connections
            .lock()
            .map_err(|_| "ACP connection lock poisoned")?
            .get(connection_key)
            .map(|record| record.auth_required)
            .or_else(|| Some(self.pool.connection_meta(connection_key).auth_required))
            .unwrap_or(false);
        if !auth_required {
            return Ok(());
        }
        Err("authenticate_not_implemented".to_string())
    }

    pub fn resolve_permission(&self, request_id: &str, option_id: &str) -> Result<(), String> {
        let sender = self
            .permissions
            .lock()
            .map_err(|_| "ACP permission lock poisoned")?
            .remove(request_id)
            .ok_or("unknown_permission_request")?;
        sender
            .send(option_id.to_string())
            .map_err(|_| "permission_request_closed".to_string())
    }

    pub fn cancel_turn(&self, thread_key: &str) {
        if let Some(turn) = self
            .active
            .lock()
            .ok()
            .and_then(|active| active.get(thread_key).map(|turn| turn.cancel.clone()))
        {
            let _ = turn.send(true);
        }
    }

    pub fn connection_snapshot(&self, provider_id: &str) -> ProviderConnectionSnapshot {
        self.connections
            .lock()
            .ok()
            .and_then(|connections| {
                let exact = connections
                    .values()
                    .find(|record| record.snapshot.provider_id == provider_id)
                    .map(|record| record.snapshot.clone());
                if exact.is_some() {
                    return exact;
                }
                // Mock runs use profile id `mock-strict` while the UI still
                // addresses the catalog agent as `cursor-acp`. Fall back to any
                // Ready connection, then any live connection.
                connections
                    .values()
                    .find(|record| matches!(record.snapshot.state, ConnectionState::Ready))
                    .or_else(|| connections.values().next())
                    .map(|record| record.snapshot.clone())
            })
            .unwrap_or(ProviderConnectionSnapshot {
                provider_id: provider_id.to_string(),
                state: ConnectionState::NotStarted,
                detail: None,
                process_id: None,
                restart_count: 0,
                started_at_ms: None,
                last_transition_at_ms: now_ms(),
                last_error: None,
            })
    }

    pub fn export_trace(&self, provider_id: &str) -> Value {
        self.connections
            .lock()
            .ok()
            .and_then(|connections| {
                if let Some(record) = connections
                    .values()
                    .find(|record| record.snapshot.provider_id == provider_id)
                {
                    return Some(json!({
                        "providerId": provider_id,
                        "entries": record.trace,
                    }));
                }
                // Merge all connection traces when the requested provider id
                // does not match (e.g. UI asks for cursor-acp, mock is mock-strict).
                let mut entries = Vec::new();
                let mut resolved_provider = provider_id.to_string();
                for record in connections.values() {
                    resolved_provider = record.snapshot.provider_id.clone();
                    entries.extend(record.trace.iter().cloned());
                }
                if connections.is_empty() {
                    None
                } else {
                    Some(json!({
                        "providerId": resolved_provider,
                        "entries": entries,
                    }))
                }
            })
            .unwrap_or_else(|| json!({"providerId":provider_id,"entries":[]}))
    }

    pub fn shutdown(&self) {
        let keys = self
            .active
            .lock()
            .map(|active| active.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        for key in keys {
            self.cancel_turn(&key);
        }
        self.pool.shutdown();
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
