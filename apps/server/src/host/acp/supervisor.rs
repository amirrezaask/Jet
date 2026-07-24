use super::connection_pool::{
    map_stop_reason, ConnectionPool, InitializedInfo, TurnJob,
};
use super::profiles::ProviderProfile;
use super::redaction::redact_json;
use super::types::{
    ConnectionState, NormalizedEvent, ProviderConnectionSnapshot, StopReason as LocalStopReason,
};
use agent_client_protocol::schema::v1::{RequestPermissionOutcome, RequestPermissionRequest};
use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
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
    /// Optional image attachments as (base64_data, mime_type); capped at 8.
    pub images: Vec<(String, String)>,
    pub model: Option<String>,
    pub runtime_mode: Option<String>,
    pub interaction_mode: Option<String>,
    pub existing_session_id: Option<String>,
    pub prefer_resume: bool,
    pub initial_sequence: u64,
    pub on_session: Arc<dyn Fn(&str) + Send + Sync>,
    pub on_text: Arc<dyn Fn(&str) + Send + Sync>,
    pub on_activity: Arc<dyn Fn(&str) + Send + Sync>,
    pub on_event: SupervisorEventSink,
}

pub struct SupervisorTurnResult {
    pub session_id: String,
    pub text: String,
    pub cancelled: bool,
    pub stop_reason: LocalStopReason,
}

struct ActiveTurn {
    cancel: watch::Sender<bool>,
    connection_key: String,
}

struct ConnectionRecord {
    snapshot: ProviderConnectionSnapshot,
    trace: Vec<Value>,
    auth_required: bool,
    auth_method_ids: Vec<String>,
    supports_list_sessions: bool,
    supports_close_session: bool,
    supports_delete_session: bool,
    supports_resume_session: bool,
    supports_load_session: bool,
    supports_logout: bool,
}

#[derive(Clone, Default)]
pub struct AcpSupervisor {
    active: Arc<Mutex<HashMap<String, ActiveTurn>>>,
    permissions: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
    user_inputs: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
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
                        auth_method_ids: Vec::new(),
                    },
                    trace: Vec::new(),
                    auth_required: false,
                    auth_method_ids: Vec::new(),
                    supports_list_sessions: false,
                    supports_close_session: false,
                    supports_delete_session: false,
                    supports_resume_session: false,
                    supports_load_session: false,
                    supports_logout: false,
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
        let pending_user_inputs = self.user_inputs.clone();
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
        let sequence = Arc::new(AtomicU64::new(request.initial_sequence));
        let sequence_for_perm = sequence.clone();
        let on_permission: Arc<
            dyn Fn(RequestPermissionRequest) -> BoxFuture<'static, RequestPermissionOutcome>
                + Send
                + Sync,
        > = Arc::new(move |permission| {
            let request_id = Uuid::new_v4().to_string();
            let (tx, rx) = oneshot::channel();
            if let Ok(mut guard) = pending.lock() {
                guard.insert(request_id.clone(), tx);
            } else {
                return Box::pin(async { RequestPermissionOutcome::Cancelled });
            }
            let options: Vec<Value> = permission
                .options
                .iter()
                .map(|option| {
                    let kind = match option.kind {
                        agent_client_protocol::schema::v1::PermissionOptionKind::AllowOnce => {
                            "allow_once"
                        }
                        agent_client_protocol::schema::v1::PermissionOptionKind::AllowAlways => {
                            "allow_always"
                        }
                        agent_client_protocol::schema::v1::PermissionOptionKind::RejectOnce => {
                            "reject_once"
                        }
                        agent_client_protocol::schema::v1::PermissionOptionKind::RejectAlways => {
                            "reject_always"
                        }
                        _ => "unknown",
                    };
                    json!({
                        "id": option.option_id.0.as_ref(),
                        "kind": kind,
                        "label": option.name,
                    })
                })
                .collect();
            let title = permission
                .tool_call
                .fields
                .title
                .clone()
                .unwrap_or_else(|| "Permission required".to_string());
            let permission_sequence = sequence_for_perm.fetch_add(1, Ordering::AcqRel) + 1;
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
                        "options": options,
                        "createdAt": chrono::Utc::now().to_rfc3339(),
                        "toolCall": permission.tool_call,
                        "sessionId": permission.session_id.0.as_ref(),
                    }),
                }),
            );
            Box::pin(async move {
                match rx.await {
                    Ok(option_id) if !option_id.is_empty() => RequestPermissionOutcome::Selected(
                        agent_client_protocol::schema::v1::SelectedPermissionOutcome::new(
                            option_id,
                        ),
                    ),
                    _ => RequestPermissionOutcome::Cancelled,
                }
            })
        });

        let event_for_input = on_event.clone();
        let sequence_for_input = sequence.clone();
        let thread_key_for_input = request.thread_key.clone();
        let on_user_input: Arc<dyn Fn(Value) -> BoxFuture<'static, Value> + Send + Sync> =
            Arc::new(move |mut payload: Value| {
                let request_id = payload
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let request_id = if request_id.is_empty() {
                    Uuid::new_v4().to_string()
                } else {
                    request_id
                };
                if let Some(object) = payload.as_object_mut() {
                    object.insert("id".to_string(), json!(request_id.clone()));
                }
                let (tx, rx) = oneshot::channel();
                if let Ok(mut guard) = pending_user_inputs.lock() {
                    guard.insert(request_id.clone(), tx);
                } else {
                    return Box::pin(async { json!({ "cancelled": true, "action": "cancel" }) });
                }
                let input_sequence = sequence_for_input.fetch_add(1, Ordering::AcqRel) + 1;
                event_for_input(
                    input_sequence,
                    NormalizedEvent::Timeline(super::types::TimelineItem {
                        kind: super::types::TimelineItemKind::UserInput,
                        id: request_id,
                        session_id: String::new(),
                        turn_id: Some(thread_key_for_input.clone()),
                        payload,
                    }),
                );
                Box::pin(async move {
                    match rx.await {
                        Ok(answer) => answer,
                        Err(_) => json!({ "cancelled": true, "action": "cancel" }),
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
                        record.auth_method_ids = info.auth_method_ids.clone();
                        record.snapshot.auth_method_ids = info.auth_method_ids.clone();
                        record.supports_list_sessions = info.supports_list_sessions;
                        record.supports_close_session = info.supports_close_session;
                        record.supports_delete_session = info.supports_delete_session;
                        record.supports_resume_session = info.supports_resume_session;
                        record.supports_load_session = info.supports_load_session;
                        record.supports_logout = info.supports_logout;
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
                    images: request.images,
                    model: request.model,
                    runtime_mode: request.runtime_mode,
                    interaction_mode: request.interaction_mode,
                    turn_id: request.thread_key.clone(),
                    existing_session_id: request.existing_session_id,
                    prefer_resume: request.prefer_resume,
                    initial_sequence: request.initial_sequence,
                    sequence,
                    cancel: cancel_rx,
                    on_session: request.on_session,
                    on_text: request.on_text,
                    on_activity: request.on_activity,
                    on_event,
                    on_permission,
                    on_user_input,
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
        record.snapshot.process_id = self.pool.process_id(&connection_key);
        match result {
            Ok(result) => {
                if !record.auth_required {
                    record.snapshot.state = ConnectionState::Ready;
                }
                record
                    .trace
                    .push(json!({"event":"turn_finish","sessionId":result.session_id}));
                let stop_reason = map_stop_reason(result.stop_reason);
                Ok(SupervisorTurnResult {
                    session_id: result.session_id,
                    text: result.text,
                    cancelled: matches!(stop_reason, LocalStopReason::Cancelled),
                    stop_reason,
                })
            }
            Err(error) => {
                if error == "provider_unresponsive_after_cancel" {
                    record.snapshot.state = ConnectionState::Degraded;
                    record.snapshot.last_error = Some(error.clone());
                    record.snapshot.restart_count =
                        record.snapshot.restart_count.saturating_add(1);
                    drop(connections);
                    let _ = self.force_stop_connection(&connection_key);
                    return Err(error);
                }
                if error == "authentication_required" || record.auth_required {
                    record.snapshot.state = ConnectionState::AuthenticationRequired;
                    record.snapshot.detail = Some("authentication_required".to_string());
                    record.snapshot.last_error = Some(error.clone());
                    record
                        .trace
                        .push(json!({"event":"turn_error","error":error}));
                    return Err(error);
                }
                record.snapshot.state = ConnectionState::Degraded;
                record.snapshot.last_error = Some(error.clone());
                record
                    .trace
                    .push(json!({"event":"turn_error","error":error}));
                Err(error)
            }
        }
    }

    /// Drop the long-lived worker and kill the provider process (via SDK ChildGuard).
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
        // Settle outstanding permission waiters as cancelled.
        if let Ok(mut permissions) = self.permissions.lock() {
            for (_, sender) in permissions.drain() {
                let _ = sender.send(String::new());
            }
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
                record.snapshot.process_id = None;
                record.snapshot.last_transition_at_ms = now_ms();
                record
                    .trace
                    .push(json!({"event":"force_stop","connectionKey":connection_key}));
            }
        }
        Ok(())
    }

    pub async fn list_sessions(
        &self,
        connection_key: &str,
        cwd: Option<PathBuf>,
        cursor: Option<String>,
    ) -> Result<Value, String> {
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
        self.pool
            .list_sessions(connection_key, cwd, cursor)
            .await
    }

    pub async fn close_session(
        &self,
        connection_key: &str,
        session_id: &str,
    ) -> Result<(), String> {
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
        self.pool
            .close_session(connection_key, session_id.to_string())
            .await
    }

    pub async fn delete_session(
        &self,
        connection_key: &str,
        session_id: &str,
    ) -> Result<(), String> {
        let supports = self
            .connections
            .lock()
            .map_err(|_| "ACP connection lock poisoned")?
            .get(connection_key)
            .map(|record| record.supports_delete_session)
            .unwrap_or(false);
        if !supports {
            return Err("unsupported_capability".to_string());
        }
        self.pool
            .delete_session(connection_key, session_id.to_string())
            .await
    }

    pub async fn authenticate(
        &self,
        connection_key: &str,
        method_id: Option<&str>,
    ) -> Result<(), String> {
        let (auth_required, methods) = {
            let connections = self
                .connections
                .lock()
                .map_err(|_| "ACP connection lock poisoned")?;
            let record = connections.get(connection_key);
            let meta = self.pool.connection_meta(connection_key);
            (
                record
                    .map(|record| record.auth_required)
                    .unwrap_or(meta.auth_required),
                record
                    .map(|record| record.auth_method_ids.clone())
                    .unwrap_or(meta.auth_method_ids),
            )
        };
        if !auth_required && methods.is_empty() {
            return Ok(());
        }
        let method_id = method_id
            .map(str::to_string)
            .or_else(|| methods.first().cloned())
            .ok_or_else(|| "authenticate_method_required".to_string())?;
        if !methods.is_empty() && !methods.iter().any(|id| id == &method_id) {
            return Err("authenticate_unknown_method".to_string());
        }
        if let Ok(mut connections) = self.connections.lock() {
            if let Some(record) = connections.get_mut(connection_key) {
                record.snapshot.state = ConnectionState::Authenticating;
                record.snapshot.last_transition_at_ms = now_ms();
            }
        }
        let result = self.pool.authenticate(connection_key, method_id).await;
        if let Ok(mut connections) = self.connections.lock() {
            if let Some(record) = connections.get_mut(connection_key) {
                record.snapshot.last_transition_at_ms = now_ms();
                match &result {
                    Ok(()) => {
                        record.auth_required = false;
                        record.snapshot.state = ConnectionState::Ready;
                        record.snapshot.detail = None;
                    }
                    Err(error) => {
                        record.snapshot.state = ConnectionState::AuthenticationRequired;
                        record.snapshot.last_error = Some(error.clone());
                    }
                }
            }
        }
        result
    }

    pub async fn logout(&self, connection_key: &str) -> Result<(), String> {
        let supports = self
            .connections
            .lock()
            .map_err(|_| "ACP connection lock poisoned")?
            .get(connection_key)
            .map(|record| record.supports_logout)
            .unwrap_or(false);
        if !supports {
            return Err("unsupported_capability".to_string());
        }
        let result = self.pool.logout(connection_key).await;
        if result.is_ok() {
            if let Ok(mut connections) = self.connections.lock() {
                if let Some(record) = connections.get_mut(connection_key) {
                    record.auth_required = true;
                    record.snapshot.state = ConnectionState::AuthenticationRequired;
                    record.snapshot.last_transition_at_ms = now_ms();
                }
            }
        }
        result
    }

    pub fn resolve_permission(&self, request_id: &str, option_id: &str) -> Result<(), String> {
        if option_id.is_empty() {
            return Err("invalid_permission_option".to_string());
        }
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

    pub fn resolve_user_input(&self, request_id: &str, answer: Value) -> Result<(), String> {
        let sender = self
            .user_inputs
            .lock()
            .map_err(|_| "ACP user input lock poisoned")?
            .remove(request_id)
            .ok_or("unknown_user_input_request")?;
        sender
            .send(answer)
            .map_err(|_| "user_input_request_closed".to_string())
    }

    pub async fn set_session_config_option(
        &self,
        connection_key: &str,
        session_id: &str,
        config_id: &str,
        value: &str,
    ) -> Result<(), String> {
        self.pool
            .set_session_config_option(connection_key, session_id, config_id, value)
            .await
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
        // Drop unresolved permissions for this turn by cancelling all — host
        // clears pendingPermissions on interrupt; settle waiters so provider unblocks.
        if let Ok(mut permissions) = self.permissions.lock() {
            let drained: Vec<_> = permissions.drain().collect();
            for (_, sender) in drained {
                let _ = sender.send(String::new());
            }
        }
        if let Ok(mut inputs) = self.user_inputs.lock() {
            let drained: Vec<_> = inputs.drain().collect();
            for (_, sender) in drained {
                let _ = sender.send(json!({ "cancelled": true, "action": "cancel" }));
            }
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
                    .map(|record| {
                        let mut snapshot = record.snapshot.clone();
                        if snapshot.auth_method_ids.is_empty() {
                            snapshot.auth_method_ids = record.auth_method_ids.clone();
                        }
                        snapshot
                    });
                if exact.is_some() {
                    return exact;
                }
                connections
                    .values()
                    .find(|record| matches!(record.snapshot.state, ConnectionState::Ready))
                    .or_else(|| connections.values().next())
                    .map(|record| {
                        let mut snapshot = record.snapshot.clone();
                        if snapshot.auth_method_ids.is_empty() {
                            snapshot.auth_method_ids = record.auth_method_ids.clone();
                        }
                        snapshot
                    })
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
                auth_method_ids: Vec::new(),
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
