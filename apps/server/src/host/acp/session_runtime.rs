//! Per-ACP-session runtime state. Notifications route here by session_id.

use super::event_pipeline::EventPipeline;
use super::reducers::tool_call::{self, ToolCallState, ToolCallStatus, ToolCalls};
use super::types::{NormalizedEvent, TimelineItemKind};
use agent_client_protocol::schema::v1::{
    ContentBlock, ContentChunk, RequestPermissionOutcome, RequestPermissionRequest, SessionUpdate,
    ToolCall, ToolCallUpdate,
};
use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

pub type TextCb = Arc<dyn Fn(&str) + Send + Sync>;
pub type ActivityCb = Arc<dyn Fn(&str) + Send + Sync>;
pub type EventCb = Arc<dyn Fn(u64, NormalizedEvent) + Send + Sync>;
pub type PermissionCb = Arc<
    dyn Fn(RequestPermissionRequest) -> BoxFuture<'static, RequestPermissionOutcome> + Send + Sync,
>;
/// Generic user-input waiter (cursor ask_question / elicitation). Returns JSON answer payload.
pub type UserInputCb =
    Arc<dyn Fn(Value) -> BoxFuture<'static, Value> + Send + Sync>;

pub struct SessionRuntime {
    pub session_id: String,
    /// First entry is primary cwd; rest are additionalDirectories.
    pub roots: Mutex<Vec<PathBuf>>,
    /// Last emitted sequence for this session stream (persisted on the thread).
    pub sequence: Arc<AtomicU64>,
    pub turn_busy: AtomicBool,
    pub capture: AtomicBool,
    pub replaying: AtomicBool,
    pub generation: AtomicU64,
    pub output: Mutex<String>,
    pub on_text: Mutex<Option<TextCb>>,
    pub on_activity: Mutex<Option<ActivityCb>>,
    pub on_event: Mutex<Option<EventCb>>,
    pub on_permission: Mutex<Option<PermissionCb>>,
    pub on_user_input: Mutex<Option<UserInputCb>>,
    pub pipeline: Mutex<Option<EventPipeline>>,
    pub tools: Mutex<ToolCalls>,
    pub thought_stream_id: Mutex<Option<String>>,
    pub active_plan_id: Mutex<Option<String>>,
    /// Monotonic millis of last inbound update (for session-load replay idle gate).
    pub last_update_at_ms: AtomicU64,
}

impl SessionRuntime {
    pub fn new(
        session_id: String,
        cwd: PathBuf,
        sequence: Arc<AtomicU64>,
        generation: u64,
    ) -> Self {
        Self {
            session_id,
            roots: Mutex::new(vec![cwd]),
            sequence,
            turn_busy: AtomicBool::new(false),
            capture: AtomicBool::new(false),
            replaying: AtomicBool::new(false),
            generation: AtomicU64::new(generation),
            output: Mutex::new(String::new()),
            on_text: Mutex::new(None),
            on_activity: Mutex::new(None),
            on_event: Mutex::new(None),
            on_permission: Mutex::new(None),
            on_user_input: Mutex::new(None),
            pipeline: Mutex::new(None),
            tools: Mutex::new(ToolCalls::default()),
            thought_stream_id: Mutex::new(None),
            active_plan_id: Mutex::new(None),
            last_update_at_ms: AtomicU64::new(0),
        }
    }

    pub fn touch_update(&self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        self.last_update_at_ms.store(now, Ordering::Release);
    }

    pub fn set_cwd(&self, cwd: PathBuf) {
        if let Ok(mut roots) = self.roots.lock() {
            if roots.is_empty() {
                roots.push(cwd);
            } else {
                roots[0] = cwd;
            }
        }
    }

    pub fn cwd(&self) -> PathBuf {
        self.roots
            .lock()
            .ok()
            .and_then(|roots| roots.first().cloned())
            .unwrap_or_default()
    }

    pub fn install_turn_callbacks(
        &self,
        on_text: TextCb,
        on_activity: ActivityCb,
        on_event: EventCb,
        on_permission: PermissionCb,
        on_user_input: UserInputCb,
    ) {
        if let Ok(mut slot) = self.on_text.lock() {
            *slot = Some(on_text);
        }
        if let Ok(mut slot) = self.on_activity.lock() {
            *slot = Some(on_activity);
        }
        if let Ok(mut slot) = self.on_event.lock() {
            *slot = Some(on_event);
        }
        if let Ok(mut slot) = self.on_permission.lock() {
            *slot = Some(on_permission);
        }
        if let Ok(mut slot) = self.on_user_input.lock() {
            *slot = Some(on_user_input);
        }
    }

    pub fn clear_turn_callbacks(&self) {
        if let Ok(mut slot) = self.on_permission.lock() {
            *slot = None;
        }
        if let Ok(mut slot) = self.on_user_input.lock() {
            *slot = None;
        }
        if let Ok(mut slot) = self.on_text.lock() {
            *slot = None;
        }
        if let Ok(mut slot) = self.on_activity.lock() {
            *slot = None;
        }
        if let Ok(mut slot) = self.on_event.lock() {
            *slot = None;
        }
    }

    /// Emit a plan from an extension (e.g. cursor/create_plan) into the timeline pipeline.
    pub fn emit_extension_plan(&self, plan_id: String, payload: Value) {
        if let Ok(mut guard) = self.active_plan_id.lock() {
            *guard = Some(plan_id.clone());
        }
        if let Ok(mut pipeline) = self.pipeline.lock() {
            if let Some(pipeline) = pipeline.as_mut() {
                pipeline.timeline_with_id(TimelineItemKind::Plan, plan_id, payload);
            }
        }
    }

    pub fn clear_output(&self) {
        if let Ok(mut output) = self.output.lock() {
            output.clear();
        }
    }

    pub fn output_snapshot(&self) -> String {
        self.output
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    pub fn begin_pipeline(self: &Arc<Self>, turn_id: String) {
        let on_event = self
            .on_event
            .lock()
            .ok()
            .and_then(|guard| guard.clone())
            .unwrap_or_else(|| Arc::new(|_, _| {}));
        let session_id = self.session_id.clone();
        let sequence = Arc::clone(&self.sequence);
        if let Ok(mut pipeline) = self.pipeline.lock() {
            *pipeline = Some(EventPipeline::with_allocator(
                session_id,
                turn_id,
                sequence,
                move |sequence, event| {
                    on_event(sequence, event);
                },
            ));
        }
    }

    pub fn flush_and_clear_pipeline(&self) {
        if let Ok(mut pipeline) = self.pipeline.lock() {
            if let Some(pipeline) = pipeline.as_mut() {
                pipeline.flush_text();
            }
            *pipeline = None;
        }
    }

    pub fn handle_update(&self, update: SessionUpdate) {
        self.touch_update();
        if !self.capture.load(Ordering::Acquire) {
            return;
        }
        match update {
            SessionUpdate::AgentMessageChunk(ContentChunk {
                content: ContentBlock::Text(text),
                ..
            }) => {
                if let Ok(mut output) = self.output.lock() {
                    output.push_str(&text.text);
                    let snapshot = output.clone();
                    drop(output);
                    if let Some(on_text) = self.on_text.lock().ok().and_then(|g| g.clone()) {
                        on_text(&snapshot);
                    }
                }
                if let Ok(mut pipeline) = self.pipeline.lock() {
                    if let Some(pipeline) = pipeline.as_mut() {
                        pipeline.text_delta(&text.text);
                    }
                }
            }
            SessionUpdate::AgentThoughtChunk(chunk) => {
                if let Some(on_activity) = self.on_activity.lock().ok().and_then(|g| g.clone()) {
                    on_activity("Thinking…");
                }
                let thought_text = match &chunk.content {
                    ContentBlock::Text(text) => text.text.clone(),
                    _ => String::new(),
                };
                let stream_id = {
                    let mut guard = match self.thought_stream_id.lock() {
                        Ok(guard) => guard,
                        Err(_) => return,
                    };
                    if guard.is_none() {
                        *guard = Some(format!("{}:thought", self.session_id));
                    }
                    guard.clone().unwrap_or_else(|| "thought".to_string())
                };
                if let Ok(mut pipeline) = self.pipeline.lock() {
                    if let Some(pipeline) = pipeline.as_mut() {
                        pipeline.timeline_with_id(
                            TimelineItemKind::Thought,
                            stream_id,
                            json!({ "text": thought_text }),
                        );
                    }
                }
            }
            SessionUpdate::ToolCall(tool) => {
                self.apply_tool_call(&tool);
            }
            SessionUpdate::ToolCallUpdate(update) => {
                self.apply_tool_update(&update);
            }
            SessionUpdate::Plan(plan) => {
                let plan_id = {
                    let mut guard = match self.active_plan_id.lock() {
                        Ok(guard) => guard,
                        Err(_) => return,
                    };
                    if guard.is_none() {
                        *guard = Some(format!("{}:plan", self.session_id));
                    }
                    guard.clone().unwrap_or_else(|| "plan".to_string())
                };
                let payload = serde_json::to_value(&plan).unwrap_or(Value::Null);
                if let Ok(mut pipeline) = self.pipeline.lock() {
                    if let Some(pipeline) = pipeline.as_mut() {
                        pipeline.timeline_with_id(TimelineItemKind::Plan, plan_id, payload);
                    }
                }
            }
            SessionUpdate::UsageUpdate(usage) => {
                let payload = serde_json::to_value(&usage).unwrap_or(Value::Null);
                if let Ok(mut pipeline) = self.pipeline.lock() {
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
                    payload = json!({ "type": "commands", "update": payload });
                }
                if let Ok(mut pipeline) = self.pipeline.lock() {
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
                    payload = json!({ "type": "config", "update": payload });
                }
                if let Ok(mut pipeline) = self.pipeline.lock() {
                    if let Some(pipeline) = pipeline.as_mut() {
                        pipeline.timeline(TimelineItemKind::Status, payload);
                    }
                }
            }
            _ => {}
        }
    }

    fn apply_tool_call(&self, tool: &ToolCall) {
        let tool_id = tool.tool_call_id.0.to_string();
        let title = tool.title.clone();
        if let Some(on_activity) = self.on_activity.lock().ok().and_then(|g| g.clone()) {
            on_activity(&format!("Tool: {title}"));
        }
        let status = map_tool_status(&tool.status);
        let detail = serde_json::to_value(tool).unwrap_or(Value::Null);
        if let Ok(mut tools) = self.tools.lock() {
            tool_call::reduce(
                &mut tools,
                ToolCallState {
                    id: tool_id.clone(),
                    title: Some(title),
                    status,
                    detail: Some(detail.clone()),
                },
            );
            let merged = tools.calls.get(&tool_id).cloned().unwrap_or(ToolCallState {
                id: tool_id.clone(),
                title: None,
                status,
                detail: Some(detail),
            });
            self.emit_tool(&merged);
        }
    }

    fn apply_tool_update(&self, update: &ToolCallUpdate) {
        let tool_id = update.tool_call_id.0.to_string();
        let title = update.fields.title.clone();
        if let Some(title) = title.as_deref() {
            if let Some(on_activity) = self.on_activity.lock().ok().and_then(|g| g.clone()) {
                on_activity(&format!("Tool: {title}"));
            }
        }
        let status = update
            .fields
            .status
            .as_ref()
            .map(map_tool_status)
            .unwrap_or(ToolCallStatus::Pending);
        let detail = serde_json::to_value(update).unwrap_or(Value::Null);
        if let Ok(mut tools) = self.tools.lock() {
            tool_call::reduce(
                &mut tools,
                ToolCallState {
                    id: tool_id.clone(),
                    title,
                    status,
                    detail: Some(detail),
                },
            );
            if let Some(merged) = tools.calls.get(&tool_id).cloned() {
                self.emit_tool(&merged);
            }
        }
    }

    fn emit_tool(&self, state: &ToolCallState) {
        let payload = json!({
            "toolCallId": state.id,
            "id": state.id,
            "title": state.title,
            "status": match state.status {
                ToolCallStatus::Pending => "pending",
                ToolCallStatus::InProgress => "in_progress",
                ToolCallStatus::Completed => "completed",
                ToolCallStatus::Failed => "failed",
            },
            "detail": state.detail,
        });
        if let Ok(mut pipeline) = self.pipeline.lock() {
            if let Some(pipeline) = pipeline.as_mut() {
                pipeline.timeline_with_id(
                    TimelineItemKind::ToolCall,
                    state.id.clone(),
                    payload,
                );
            }
        }
    }
}

fn map_tool_status(status: &agent_client_protocol::schema::v1::ToolCallStatus) -> ToolCallStatus {
    use agent_client_protocol::schema::v1::ToolCallStatus as Acp;
    match status {
        Acp::Pending => ToolCallStatus::Pending,
        Acp::InProgress => ToolCallStatus::InProgress,
        Acp::Completed => ToolCallStatus::Completed,
        Acp::Failed => ToolCallStatus::Failed,
        _ => ToolCallStatus::Pending,
    }
}
