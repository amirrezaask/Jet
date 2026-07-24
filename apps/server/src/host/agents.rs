use super::acp::{
    acp_profile_id_for_agent, mock_strict, profile_for_agent, AcpSupervisor, SupervisorTurnRequest,
    TimelineItem, TimelineItemKind,
};
use super::claude_sdk::{
    ClaudeInteraction, ClaudeInteractionKind, ClaudePermissionMode, ClaudeSupervisor,
    ClaudeSupervisorTurnRequest, ClaudeTimelineUpdate,
};
use super::codex_app_server::{
    normalize_notification as normalize_codex_notification, CodexInteraction, CodexInteractionKind,
    CodexSupervisor, CodexSupervisorTurnRequest, CodexTimelineUpdate,
    RuntimeMode as CodexRuntimeMode,
};
use super::events::EventHub;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tokio::sync::watch;
use uuid::Uuid;

use super::events::emit_host;
use super::launch::uri_to_path;

struct ActiveTurn {
    id: Uuid,
    stop: Arc<Mutex<bool>>,
    provider_cancel: Option<watch::Sender<bool>>,
}

#[derive(Clone, Copy)]
struct AgentSpec {
    id: &'static str,
    display_name: &'static str,
    binaries: &'static [&'static str],
}

const AGENTS: &[AgentSpec] = &[
    AgentSpec {
        id: "codex",
        display_name: "Codex",
        binaries: &["codex"],
    },
    AgentSpec {
        id: "claude",
        display_name: "Claude",
        binaries: &["claude"],
    },
    AgentSpec {
        id: "opencode",
        display_name: "OpenCode",
        binaries: &["opencode"],
    },
    AgentSpec {
        id: "cursor",
        display_name: "Cursor",
        binaries: &["cursor-agent", "agent"],
    },
    AgentSpec {
        id: "cursor-acp",
        display_name: "Cursor (ACP)",
        binaries: &["cursor-agent", "agent"],
    },
    AgentSpec {
        id: "grok",
        display_name: "Grok",
        binaries: &["grok"],
    },
];

fn normalize_agent_id(id: &str) -> &str {
    match id {
        "claudeAgent" => "claude",
        "cursorAcp" => "cursor-acp",
        other => other,
    }
}

fn is_acp_driver(driver_id: &str) -> bool {
    driver_id.ends_with(":acp")
}

fn is_native_driver(driver_id: &str) -> bool {
    driver_id.ends_with(":app-server") || driver_id.ends_with(":sdk")
}

fn agent_spec(id: &str) -> Option<AgentSpec> {
    let id = normalize_agent_id(id);
    AGENTS.iter().copied().find(|agent| agent.id == id)
}

pub struct AgentsHost {
    active_turns: Arc<Mutex<HashMap<String, ActiveTurn>>>,
    supervisor: Arc<AcpSupervisor>,
    codex_supervisor: Arc<CodexSupervisor>,
    claude_supervisor: Arc<ClaudeSupervisor>,
}

impl AgentsHost {
    pub fn new() -> Self {
        Self {
            active_turns: Arc::new(Mutex::new(HashMap::new())),
            supervisor: Arc::new(AcpSupervisor::new()),
            codex_supervisor: Arc::new(CodexSupervisor::new()),
            claude_supervisor: Arc::new(ClaudeSupervisor::new()),
        }
    }

    fn default_driver_id(agent_id: &str) -> String {
        match normalize_agent_id(agent_id) {
            "codex" => "codex:app-server".to_string(),
            "claude" => "claude:sdk".to_string(),
            "opencode" => "opencode:acp".to_string(),
            // Cursor ACP is a separate agent; transport id stays `cursor:acp`.
            "cursor-acp" => "cursor:acp".to_string(),
            "grok" => "grok:acp".to_string(),
            id => format!("{id}:cli"),
        }
    }

    fn native_driver_id(agent_id: &str) -> Option<String> {
        match normalize_agent_id(agent_id) {
            "codex" => Some("codex:app-server".to_string()),
            "claude" => Some("claude:sdk".to_string()),
            _ => None,
        }
    }

    fn acp_driver_id(agent_id: &str) -> Option<String> {
        let id = normalize_agent_id(agent_id);
        match id {
            "cursor-acp" => Some("cursor:acp".to_string()),
            "grok" => Some("grok:acp".to_string()),
            "cursor" | "codex" | "claude" | "opencode" => Some(format!("{id}:acp")),
            _ => None,
        }
    }

    fn cli_driver_id(agent_id: &str) -> Option<String> {
        let id = normalize_agent_id(agent_id);
        match id {
            "cursor-acp" | "grok" => None,
            "cursor" | "codex" | "claude" | "opencode" => Some(format!("{id}:cli")),
            _ => None,
        }
    }

    fn driver_supported(agent_id: &str, driver_id: &str) -> bool {
        let id = normalize_agent_id(agent_id);
        if Some(driver_id) == Self::acp_driver_id(id).as_deref() {
            return true;
        }
        if Some(driver_id) == Self::cli_driver_id(id).as_deref() {
            return true;
        }
        if Some(driver_id) == Self::native_driver_id(id).as_deref() {
            return true;
        }
        driver_id == Self::default_driver_id(id)
    }

    fn ensure_driver_available(agent_id: &str, driver_id: &str) -> Result<(), String> {
        if std::env::var("GHARARGAH_AGENT_MOCK").ok().as_deref() == Some("1") {
            return Ok(());
        }
        let agent = agent_spec(agent_id).ok_or_else(|| format!("unknown agent: {agent_id}"))?;
        if !agent_available(&agent) {
            return Err(format!("{} CLI not found on PATH", agent.display_name));
        }
        if is_acp_driver(driver_id) {
            if let Some(reason) = unavailable_acp_reason(agent.id) {
                return Err(format!("provider_transport_unavailable: {reason}"));
            }
        }
        Ok(())
    }

    fn normalize_driver_id(agent_id: &str, driver_id: Option<&str>) -> String {
        match driver_id {
            Some(driver_id) => driver_id.to_string(),
            None => Self::default_driver_id(agent_id),
        }
    }

    fn store_dir(root_path: &str) -> PathBuf {
        PathBuf::from(root_path).join(".gharargah").join("agents")
    }

    fn legacy_store_path(root_path: &str) -> PathBuf {
        Self::store_dir(root_path).join("state.json")
    }

    fn index_path(root_path: &str) -> PathBuf {
        Self::store_dir(root_path).join("index.json")
    }

    fn thread_path(root_path: &str, thread_id: &str) -> Option<PathBuf> {
        if thread_id.is_empty()
            || !thread_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        {
            return None;
        }
        Some(
            Self::store_dir(root_path)
                .join("threads")
                .join(format!("{thread_id}.json")),
        )
    }

    fn write_json_atomic(path: &PathBuf, payload: &Value) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let tmp = path.with_extension("tmp");
        fs::write(
            &tmp,
            serde_json::to_vec(payload).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::rename(tmp, path).map_err(|e| e.to_string())
    }

    fn thread_summary(thread: &Value) -> Option<Value> {
        let id = thread.get("id")?.as_str()?;
        let messages = thread.get("messages").and_then(|m| m.as_array());
        let latest_user_message_at = messages.and_then(|items| {
            items.iter().rev().find_map(|message| {
                (message.get("role").and_then(|v| v.as_str()) == Some("user"))
                    .then(|| message.get("createdAt").cloned())
                    .flatten()
            })
        });
        Some(json!({
            "id": id,
            "title": thread.get("title").and_then(|v| v.as_str()).unwrap_or("Agent"),
            "updatedAt": thread.get("updatedAt"),
            "createdAt": thread.get("createdAt"),
            "archivedAt": thread.get("archivedAt"),
            "status": thread.get("status").and_then(|v| v.as_str()).unwrap_or("idle"),
            "lastError": thread.get("lastError"),
            "latestUserMessageAt": latest_user_message_at,
            "messageCount": messages.map(|a| a.len()).unwrap_or(0),
        }))
    }

    fn normalize_thread(mut thread: Value) -> Value {
        let legacy_agent = thread
            .get("provider")
            .and_then(Value::as_str)
            .map(normalize_agent_id)
            .unwrap_or("codex")
            .to_string();
        let agent_id = thread
            .get("agentId")
            .and_then(Value::as_str)
            .map(normalize_agent_id)
            .unwrap_or(&legacy_agent)
            .to_string();
        if thread.get("agentId").and_then(Value::as_str) != Some(agent_id.as_str()) {
            thread["agentId"] = json!(agent_id);
        }
        if thread.get("driverId").and_then(Value::as_str).is_none() {
            thread["driverId"] = json!(Self::default_driver_id(&agent_id));
        }
        // Legacy threads stored ACP under agentId=cursor + cursor:acp.
        if agent_id == "cursor"
            && thread.get("driverId").and_then(Value::as_str) == Some("cursor:acp")
        {
            thread["agentId"] = json!("cursor-acp");
        }
        thread
    }

    fn ensure_migrated(root_path: &str) -> Result<(), String> {
        let index_path = Self::index_path(root_path);
        if index_path.exists() {
            return Ok(());
        }
        let legacy = fs::read_to_string(Self::legacy_store_path(root_path))
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .unwrap_or_else(|| json!({ "threads": [] }));
        let threads = legacy
            .get("threads")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let mut summaries = Vec::with_capacity(threads.len());
        for thread in threads {
            let Some(id) = thread.get("id").and_then(|v| v.as_str()) else {
                continue;
            };
            let Some(path) = Self::thread_path(root_path, id) else {
                continue;
            };
            Self::write_json_atomic(&path, &thread)?;
            if let Some(summary) = Self::thread_summary(&thread) {
                summaries.push(summary);
            }
        }
        Self::write_json_atomic(&index_path, &json!({ "threads": summaries }))
    }

    fn read_index(root_path: &str) -> Value {
        let _ = Self::ensure_migrated(root_path);
        fs::read_to_string(Self::index_path(root_path))
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_else(|| json!({ "threads": [] }))
    }

    fn write_thread(root_path: &str, thread: &Value) -> Result<(), String> {
        Self::ensure_migrated(root_path)?;
        let id = thread
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or("missing thread id")?;
        let path = Self::thread_path(root_path, id).ok_or("invalid thread id")?;
        Self::write_json_atomic(&path, thread)?;

        let mut index = Self::read_index(root_path);
        let summaries = index
            .get_mut("threads")
            .and_then(|v| v.as_array_mut())
            .ok_or("invalid agent index")?;
        let summary = Self::thread_summary(thread).ok_or("invalid thread")?;
        if let Some(existing) = summaries
            .iter_mut()
            .find(|item| item.get("id").and_then(|v| v.as_str()) == Some(id))
        {
            *existing = summary;
        } else {
            summaries.push(summary);
        }
        summaries.sort_by(|a, b| {
            let au = a.get("updatedAt").and_then(|v| v.as_str()).unwrap_or("");
            let bu = b.get("updatedAt").and_then(|v| v.as_str()).unwrap_or("");
            bu.cmp(au)
        });
        Self::write_json_atomic(&Self::index_path(root_path), &index)
    }

    fn now_iso() -> String {
        chrono::Utc::now().to_rfc3339()
    }

    pub fn list_threads(&self, workspace_root_uri: &str, workspace_root_path: &str) -> Value {
        let root_path = if workspace_root_path.is_empty() {
            uri_to_path(workspace_root_uri)
        } else {
            workspace_root_path.to_string()
        };
        let index = Self::read_index(&root_path);
        let threads = index
            .get("threads")
            .and_then(|v| v.as_array())
            .map(|a| a.as_slice())
            .unwrap_or(&[]);
        json!({
            "workspaceRootUri": workspace_root_uri,
            "workspaceRootPath": root_path,
            "threads": threads,
        })
    }

    fn read_thread_value(root_path: &str, thread_id: &str) -> Option<Value> {
        let _ = Self::ensure_migrated(root_path);
        let path = Self::thread_path(root_path, thread_id)?;
        fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .map(Self::normalize_thread)
    }

    pub fn read_thread(&self, root_path: &str, thread_id: &str) -> Option<Value> {
        Self::read_thread_value(root_path, thread_id)
    }

    pub fn create_thread(&self, input: &Value) -> Result<Value, String> {
        let root_uri = input
            .get("workspaceRootUri")
            .and_then(|v| v.as_str())
            .ok_or("missing workspaceRootUri")?;
        let root_path = input
            .get("workspaceRootPath")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| uri_to_path(root_uri));
        let created = Self::now_iso();
        let requested_agent = input
            .get("agentId")
            .or_else(|| input.get("provider"))
            .and_then(Value::as_str)
            .map(normalize_agent_id)
            .unwrap_or("codex");
        let agent = agent_spec(requested_agent).ok_or("unknown agent")?;
        let driver_id =
            Self::normalize_driver_id(agent.id, input.get("driverId").and_then(Value::as_str));
        if !Self::driver_supported(agent.id, &driver_id) {
            return Err(format!("unsupported driver: {driver_id}"));
        }
        Self::ensure_driver_available(agent.id, &driver_id)?;
        let thread = json!({
            "id": Uuid::new_v4().to_string(),
            "title": input.get("title").and_then(|v| v.as_str()).unwrap_or("New agent"),
            "workspaceRootUri": root_uri,
            "workspaceRootPath": root_path,
            "agentId": agent.id,
            "driverId": driver_id,
            "model": input.get("model").and_then(|v| v.as_str()).unwrap_or("auto"),
            "runtimeMode": input
                .get("runtimeMode")
                .and_then(Value::as_str)
                .unwrap_or("approval-required"),
            "createdAt": created,
            "updatedAt": created,
            "archivedAt": Value::Null,
            "status": "idle",
            "lastError": Value::Null,
            "timeline": [],
            "pendingPermissions": [],
            "pendingUserInputs": [],
            "permissionRules": [],
            "configOptions": [],
            "discoveredModels": [],
            "usage": Value::Null,
            "plan": Value::Null,
            "acpSequence": 0,
            "acpProvider": Value::Null,
            "providerSessionId": Value::Null,
            "providerTransport": Value::Null,
            "messages": [],
        });
        Self::write_thread(&root_path, &thread)?;
        Ok(thread)
    }

    pub fn send_message(&self, app: &EventHub, input: &Value) -> Result<Value, String> {
        let root_uri = input
            .get("workspaceRootUri")
            .and_then(|v| v.as_str())
            .ok_or("missing workspaceRootUri")?;
        let root_path = input
            .get("workspaceRootPath")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| uri_to_path(root_uri));
        let thread_id = input
            .get("threadId")
            .and_then(|v| v.as_str())
            .ok_or("missing threadId")?
            .to_string();
        let text = input
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let key = format!("{root_path}::{thread_id}");
        // Reject before mutating transcript — second prompt while turn runs is a typed error.
        if self.active_turns.lock().unwrap().contains_key(&key) {
            return Err("turn_already_running".to_string());
        }

        let mut thread = self
            .read_thread(&root_path, &thread_id)
            .ok_or("unknown thread")?;
        let requested_agent_input = input
            .get("agentId")
            .or_else(|| input.get("provider"))
            .and_then(Value::as_str);
        let requested_agent = requested_agent_input
            .or_else(|| thread.get("agentId").and_then(Value::as_str))
            .unwrap_or("codex");
        let agent = agent_spec(requested_agent).ok_or("unknown agent")?;
        let requested_driver = input.get("driverId").and_then(Value::as_str).or_else(|| {
            requested_agent_input
                .is_none()
                .then(|| thread.get("driverId").and_then(Value::as_str))
                .flatten()
        });
        let driver_id = Self::normalize_driver_id(agent.id, requested_driver);
        if !Self::driver_supported(agent.id, &driver_id) {
            return Err(format!("unsupported driver: {driver_id}"));
        }
        Self::ensure_driver_available(agent.id, &driver_id)?;
        thread["agentId"] = json!(agent.id);
        thread["driverId"] = json!(driver_id);
        if let Some(model) = input.get("model") {
            thread["model"] = model.clone();
        }
        let assistant_id = Uuid::new_v4().to_string();
        let now = Self::now_iso();
        let user_message = json!({
            "id": Uuid::new_v4().to_string(),
            "role": "user",
            "text": text,
            "createdAt": now,
            "updatedAt": now,
            "streaming": false,
        });
        let assistant_message = json!({
            "id": assistant_id,
            "role": "assistant",
            "text": "",
            "createdAt": now,
            "updatedAt": now,
            "streaming": true,
        });
        if let Some(messages) = thread.get_mut("messages").and_then(|v| v.as_array_mut()) {
            messages.push(user_message);
            messages.push(assistant_message);
        }
        thread["status"] = json!("running");
        thread["updatedAt"] = json!(now);
        Self::write_thread(&root_path, &thread)?;
        emit_host(app, "agents:threadUpdated", vec![thread.clone()]);

        let app_bg = app.clone();
        let stop = Arc::new(Mutex::new(false));
        let (provider_cancel, provider_cancel_rx) = watch::channel(false);
        let turn_id = Uuid::new_v4();
        self.active_turns.lock().unwrap().insert(
            key.clone(),
            ActiveTurn {
                id: turn_id,
                stop: stop.clone(),
                provider_cancel: (is_acp_driver(&driver_id) || is_native_driver(&driver_id))
                    .then_some(provider_cancel),
            },
        );

        let agent_id = agent.id.to_string();
        let model = thread
            .get("model")
            .and_then(Value::as_str)
            .map(str::to_string);
        let images: Vec<(String, String)> = input
            .get("images")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        let data = item.get("data").and_then(Value::as_str)?;
                        let mime = item
                            .get("mimeType")
                            .or_else(|| item.get("mime_type"))
                            .and_then(Value::as_str)?;
                        Some((data.to_string(), mime.to_string()))
                    })
                    .take(8)
                    .collect()
            })
            .unwrap_or_default();
        let active_turns = self.active_turns.clone();
        let acp_session_id = thread
            .get("acpSessionId")
            .and_then(Value::as_str)
            .map(str::to_string);
        let supervisor = self.supervisor.clone();
        let codex_supervisor = self.codex_supervisor.clone();
        let claude_supervisor = self.claude_supervisor.clone();
        let runtime = tokio::runtime::Handle::try_current()
            .map_err(|_| "ACP requires the shared Tokio runtime".to_string())?;
        thread::spawn(move || {
            run_turn(
                app_bg,
                root_path,
                thread_id,
                assistant_id,
                text,
                agent_id,
                driver_id,
                model,
                images,
                acp_session_id,
                provider_cancel_rx,
                stop,
                supervisor,
                codex_supervisor,
                claude_supervisor,
                runtime,
            );
            let mut turns = active_turns.lock().unwrap();
            if turns.get(&key).map(|turn| turn.id) == Some(turn_id) {
                turns.remove(&key);
            }
        });

        Ok(thread)
    }

    pub fn interrupt_turn(&self, input: &Value) -> Result<Option<Value>, String> {
        let root_path = input
            .get("workspaceRootPath")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .ok_or("missing workspaceRootPath")?;
        let thread_id = input
            .get("threadId")
            .and_then(|v| v.as_str())
            .ok_or("missing threadId")?;
        let key = format!("{root_path}::{thread_id}");
        if let Some(active) = self.active_turns.lock().unwrap().remove(&key) {
            *active.stop.lock().unwrap() = true;
            if let Some(cancel) = active.provider_cancel {
                let _ = cancel.send(true);
            }
        }
        self.supervisor.cancel_turn(&key);
        Ok(self.read_thread(&root_path, thread_id))
    }

    pub fn set_archived(&self, app: &EventHub, input: &Value) -> Result<Option<Value>, String> {
        let archived = input
            .get("archived")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        self.patch_thread(app, input, move |thread| {
            thread["archivedAt"] = if archived {
                json!(Self::now_iso())
            } else {
                Value::Null
            };
        })
    }

    pub fn update_settings(&self, app: &EventHub, input: &Value) -> Result<Option<Value>, String> {
        let root_path = input
            .get("workspaceRootPath")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .ok_or("missing workspaceRootPath")?;
        let thread_id = input
            .get("threadId")
            .and_then(|v| v.as_str())
            .ok_or("missing threadId")?;
        let Some(mut thread) = self.read_thread(&root_path, thread_id) else {
            return Ok(None);
        };
        if let Some(agent_id) = input.get("agentId").or_else(|| input.get("provider")) {
            let requested = agent_id.as_str().ok_or("invalid agentId")?;
            let agent = agent_spec(requested).ok_or("unknown agent")?;
            thread["agentId"] = json!(agent.id);
            if input.get("driverId").is_none() {
                thread["driverId"] = json!(Self::default_driver_id(agent.id));
            }
            thread["acpSessionId"] = Value::Null;
        }
        if let Some(driver_id) = input.get("driverId") {
            let requested_driver_id = driver_id.as_str().ok_or("invalid driverId")?;
            let agent_id = thread
                .get("agentId")
                .and_then(Value::as_str)
                .ok_or("missing agentId")?;
            let driver_id = Self::normalize_driver_id(agent_id, Some(requested_driver_id));
            if !Self::driver_supported(agent_id, &driver_id) {
                return Err(format!("unsupported driver: {driver_id}"));
            }
            Self::ensure_driver_available(agent_id, &driver_id)?;
            thread["driverId"] = json!(driver_id);
        }
        if let Some(model) = input.get("model") {
            thread["model"] = model.clone();
        }
        if let Some(runtime_mode) = input.get("runtimeMode") {
            let mode = runtime_mode.as_str().ok_or("invalid runtimeMode")?;
            if !matches!(
                mode,
                "approval-required" | "auto-accept-edits" | "full-access"
            ) {
                return Err(format!("unsupported runtimeMode: {mode}"));
            }
            thread["runtimeMode"] = json!(mode);
        }
        if let Some(interaction_mode) = input.get("interactionMode") {
            let mode = interaction_mode.as_str().ok_or("invalid interactionMode")?;
            if !matches!(mode, "implement" | "plan" | "ask") {
                return Err(format!("unsupported interactionMode: {mode}"));
            }
            thread["interactionMode"] = json!(mode);
        }
        // Continuation: clearing session when agent/provider changes.
        if input.get("agentId").is_some() || input.get("driverId").is_some() {
            if let Some(existing) = thread.get("acpProvider").and_then(Value::as_str) {
                let next_agent = thread.get("agentId").and_then(Value::as_str).unwrap_or("");
                if let Some(next_provider) = acp_profile_id_for_agent(next_agent) {
                    if existing != next_provider {
                        thread["acpSessionId"] = Value::Null;
                        thread["acpProvider"] = Value::Null;
                        thread["providerSessionId"] = Value::Null;
                        thread["providerTransport"] = Value::Null;
                    }
                }
            }
        }
        thread["updatedAt"] = json!(Self::now_iso());
        Self::write_thread(&root_path, &thread)?;
        emit_host(app, "agents:threadUpdated", vec![thread.clone()]);
        Ok(Some(thread))
    }

    fn patch_thread(
        &self,
        app: &EventHub,
        input: &Value,
        mut patch: impl FnMut(&mut Value),
    ) -> Result<Option<Value>, String> {
        let root_path = input
            .get("workspaceRootPath")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .ok_or("missing workspaceRootPath")?;
        let thread_id = input
            .get("threadId")
            .and_then(|v| v.as_str())
            .ok_or("missing threadId")?;
        let Some(mut thread) = self.read_thread(&root_path, thread_id) else {
            return Ok(None);
        };
        patch(&mut thread);
        thread["updatedAt"] = json!(Self::now_iso());
        Self::write_thread(&root_path, &thread)?;
        emit_host(app, "agents:threadUpdated", vec![thread.clone()]);
        Ok(Some(thread))
    }

    pub fn list_agents(&self) -> Value {
        let agents = AGENTS.iter().map(agent_snapshot).collect::<Vec<_>>();
        json!({
            "agents": agents,
            "updatedAt": Self::now_iso(),
        })
    }

    pub fn list_providers(&self) -> Value {
        let providers = AGENTS
            .iter()
            .map(|agent| {
                let installed = agent_available(agent);
                json!({
                    "instanceId": agent.id,
                    "driverKind": agent.id,
                    "displayName": agent.display_name,
                    "enabled": installed,
                    "status": if installed { "ready" } else { "unavailable" },
                    "message": if installed { Value::Null } else { json!(format!("{} CLI not found on PATH", agent.display_name)) },
                    "models": if installed { agent_models(agent) } else { json!([]) },
                })
            })
            .collect::<Vec<_>>();
        json!({ "providers": providers, "updatedAt": Self::now_iso() })
    }

    pub fn stop_all(&self) {
        for (_, active) in self.active_turns.lock().unwrap().drain() {
            *active.stop.lock().unwrap() = true;
            if let Some(cancel) = active.provider_cancel {
                let _ = cancel.send(true);
            }
        }
        self.supervisor.shutdown();
        self.codex_supervisor.shutdown();
        self.claude_supervisor.shutdown();
    }
}

impl Default for AgentsHost {
    fn default() -> Self {
        Self::new()
    }
}

fn agent_snapshot(agent: &AgentSpec) -> Value {
    let installed = agent_available(agent);
    let active_driver_id = AgentsHost::default_driver_id(agent.id);
    let status = if installed { "ready" } else { "unavailable" };
    let unavailable_msg = if installed {
        Value::Null
    } else {
        json!(format!("{} CLI not found on PATH", agent.display_name))
    };
    let mut drivers = Vec::new();
    if let Some(cli_id) = AgentsHost::cli_driver_id(agent.id) {
        drivers.push(json!({
            "id": cli_id,
            "kind": "cli",
            "status": status,
            "message": unavailable_msg.clone(),
        }));
    }
    if let Some(native_id) = AgentsHost::native_driver_id(agent.id) {
        drivers.push(json!({
            "id": native_id,
            "kind": "native",
            "status": status,
            "message": unavailable_msg.clone(),
        }));
    }
    if let Some(acp_id) = AgentsHost::acp_driver_id(agent.id) {
        let acp_reason = (std::env::var("GHARARGAH_AGENT_MOCK").ok().as_deref() != Some("1"))
            .then(|| unavailable_acp_reason(agent.id))
            .flatten();
        let acp_ready = installed && acp_reason.is_none();
        drivers.push(json!({
            "id": acp_id,
            "kind": "acp",
            "status": if acp_ready { "ready" } else { "unavailable" },
            "message": if !installed {
                unavailable_msg.clone()
            } else if let Some(reason) = acp_reason {
                json!(reason)
            } else {
                Value::Null
            },
        }));
    }
    if drivers.is_empty() {
        let active_kind = if is_acp_driver(&active_driver_id) {
            "acp"
        } else if active_driver_id.ends_with(":app-server") || active_driver_id.ends_with(":sdk") {
            "native"
        } else {
            "cli"
        };
        drivers.push(json!({
            "id": active_driver_id,
            "kind": active_kind,
            "status": status,
            "message": unavailable_msg,
        }));
    }
    json!({
        "id": agent.id,
        "displayName": agent.display_name,
        "enabled": installed,
        "activeDriverId": active_driver_id,
        "drivers": drivers,
        "models": if installed {
            agent_models(agent)
        } else {
            json!([])
        },
    })
}

fn unavailable_acp_reason(agent_id: &str) -> Option<&'static str> {
    match normalize_agent_id(agent_id) {
        "codex" => {
            Some("Codex does not expose ACP; its production adapter must use `codex app-server`")
        }
        "claude" => Some(
            "Claude Code does not expose ACP; its production adapter must use the Claude Agent SDK",
        ),
        _ => None,
    }
}

fn agent_models(agent: &AgentSpec) -> Value {
    if std::env::var("GHARARGAH_AGENT_MOCK").ok().as_deref() == Some("1") {
        return json!([{ "slug": "auto", "name": "Auto", "shortName": "Auto" }]);
    }
    if agent.id == "cursor" || agent.id == "cursor-acp" {
        return json!(list_cursor_models());
    }
    json!([{ "slug": "auto", "name": "Auto", "shortName": "Auto" }])
}

fn list_cursor_models() -> Vec<Value> {
    static CACHE: Mutex<Option<(std::time::Instant, Vec<Value>)>> = Mutex::new(None);
    const TTL: std::time::Duration = std::time::Duration::from_secs(60);

    if let Ok(guard) = CACHE.lock() {
        if let Some((fetched_at, models)) = guard.as_ref() {
            if fetched_at.elapsed() < TTL && !models.is_empty() {
                return models.clone();
            }
        }
    }

    let models = fetch_cursor_models_from_cli()
        .unwrap_or_else(|| vec![json!({ "slug": "auto", "name": "Auto", "shortName": "Auto" })]);
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some((std::time::Instant::now(), models.clone()));
    }
    models
}

fn fetch_cursor_models_from_cli() -> Option<Vec<Value>> {
    let binary = cursor_binary()?;
    let output = Command::new(binary)
        .arg("models")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let models = parse_cursor_models_output(&stdout);
    if models.is_empty() {
        None
    } else {
        Some(models)
    }
}

fn parse_cursor_models_output(stdout: &str) -> Vec<Value> {
    let mut models = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() || line.eq_ignore_ascii_case("Available models") {
            continue;
        }
        let Some((slug, rest)) = line.split_once(" - ") else {
            continue;
        };
        let slug = slug.trim();
        if slug.is_empty() || slug.contains(' ') {
            continue;
        }
        let name = rest.trim().trim_end_matches("(default)").trim().to_string();
        if name.is_empty() {
            continue;
        }
        let short_name = name
            .split_whitespace()
            .take(3)
            .collect::<Vec<_>>()
            .join(" ");
        models.push(json!({
            "slug": slug,
            "name": name,
            "shortName": short_name,
        }));
    }
    models
}

fn agent_available(agent: &AgentSpec) -> bool {
    std::env::var("GHARARGAH_AGENT_MOCK").ok().as_deref() == Some("1")
        || agent.binaries.iter().any(|binary| which_binary(binary))
}

fn which_binary(name: &str) -> bool {
    let checker = if cfg!(windows) { "where" } else { "which" };
    Command::new(checker)
        .arg(name)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn run_turn(
    app: EventHub,
    root_path: String,
    thread_id: String,
    assistant_id: String,
    prompt: String,
    agent_id: String,
    driver_id: String,
    model: Option<String>,
    images: Vec<(String, String)>,
    acp_session_id: Option<String>,
    provider_cancel: watch::Receiver<bool>,
    stop: Arc<Mutex<bool>>,
    supervisor: Arc<AcpSupervisor>,
    codex_supervisor: Arc<CodexSupervisor>,
    claude_supervisor: Arc<ClaudeSupervisor>,
    runtime: tokio::runtime::Handle,
) {
    let use_mock = std::env::var("GHARARGAH_AGENT_MOCK").ok().as_deref() == Some("1");
    let legacy_mock = std::env::var("GHARARGAH_AGENT_MOCK_LEGACY").ok().as_deref() == Some("1");
    if use_mock && legacy_mock {
        run_mock_turn(&app, &root_path, &thread_id, &assistant_id, &prompt, &stop);
        return;
    }
    if !use_mock && driver_id == "codex:app-server" {
        if let Err(error) = run_codex_turn(
            &app,
            &root_path,
            &thread_id,
            &assistant_id,
            &prompt,
            model,
            images,
            provider_cancel,
            codex_supervisor,
            runtime,
        ) {
            update_assistant(
                &app,
                &root_path,
                &thread_id,
                &assistant_id,
                None,
                "error",
                Some(&error),
            );
        }
        return;
    }
    let claude_mock_bin = std::env::var_os("GHARARGAH_MOCK_CLAUDE_SDK_BIN");
    if driver_id == "claude:sdk" && (!use_mock || claude_mock_bin.is_some()) {
        if let Err(error) = run_claude_turn(
            &app,
            &root_path,
            &thread_id,
            &assistant_id,
            &prompt,
            model,
            images,
            provider_cancel,
            claude_supervisor,
            runtime,
        ) {
            update_assistant(
                &app,
                &root_path,
                &thread_id,
                &assistant_id,
                None,
                "error",
                Some(&error),
            );
        }
        return;
    }
    if use_mock || is_acp_driver(&driver_id) {
        if let Err(error) = run_acp_turn(
            &app,
            &root_path,
            &thread_id,
            &assistant_id,
            &prompt,
            &agent_id,
            model,
            images,
            acp_session_id,
            provider_cancel,
            supervisor,
            runtime,
            use_mock,
        ) {
            update_assistant(
                &app,
                &root_path,
                &thread_id,
                &assistant_id,
                None,
                "error",
                Some(&error),
            );
        }
        return;
    }
    if driver_id == format!("{}:cli", agent_id) {
        if let Err(error) = run_cli_turn(
            &app,
            &root_path,
            &thread_id,
            &assistant_id,
            &prompt,
            &agent_id,
            &stop,
        ) {
            update_assistant(
                &app,
                &root_path,
                &thread_id,
                &assistant_id,
                None,
                "error",
                Some(&error),
            );
        }
        return;
    }
    update_assistant(
        &app,
        &root_path,
        &thread_id,
        &assistant_id,
        None,
        "error",
        Some(&format!("Unsupported agent driver: {driver_id}")),
    );
}

fn run_mock_turn(
    app: &EventHub,
    root_path: &str,
    thread_id: &str,
    assistant_id: &str,
    prompt: &str,
    stop: &Arc<Mutex<bool>>,
) {
    let full = format!("Mock agent reply: {}", prompt.trim());
    let chunk = (full.len() / 6).max(4);
    let mut offset = 0usize;
    while offset < full.len() {
        if *stop.lock().unwrap() {
            update_assistant(
                app,
                root_path,
                thread_id,
                assistant_id,
                Some(&full[..offset]),
                "error",
                Some("Turn interrupted"),
            );
            return;
        }
        offset = (offset + chunk).min(full.len());
        let slice = &full[..offset];
        update_assistant(
            app,
            root_path,
            thread_id,
            assistant_id,
            Some(slice),
            "streaming",
            None,
        );
        thread::sleep(std::time::Duration::from_millis(80));
    }
    if *stop.lock().unwrap() {
        update_assistant(
            app,
            root_path,
            thread_id,
            assistant_id,
            Some(&full),
            "error",
            Some("Turn interrupted"),
        );
        return;
    }
    update_assistant(
        app,
        root_path,
        thread_id,
        assistant_id,
        Some(&full),
        "idle",
        None,
    );
}

fn cli_args(agent_id: &str, prompt: &str) -> Option<Vec<String>> {
    let agent = agent_spec(agent_id)?;
    let args = match agent.id {
        "codex" => vec!["exec", "--color", "never", prompt],
        "claude" => vec!["-p", prompt, "--output-format", "text"],
        "opencode" => vec!["run", prompt],
        "cursor" => vec!["-p", "--output-format", "text", "-f", prompt],
        _ => return None,
    };
    Some(args.into_iter().map(str::to_string).collect())
}

fn cursor_binary() -> Option<String> {
    agent_spec("cursor")?
        .binaries
        .iter()
        .find(|binary| which_binary(binary))
        .map(|binary| (*binary).to_string())
}

fn payload_text(payload: &Value) -> String {
    payload
        .get("text")
        .or_else(|| payload.get("message"))
        .or_else(|| payload.get("error"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn value_as_string(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(s) => Some(s.clone()),
        Value::Null => None,
        other => Some(other.to_string()),
    }
}

fn map_tool_status(raw: &str) -> &'static str {
    match raw.to_ascii_lowercase().replace('-', "_").as_str() {
        "pending" => "pending",
        "in_progress" | "inprogress" | "running" => "running",
        "completed" | "complete" | "success" => "completed",
        "failed" | "error" | "failure" => "failed",
        "cancelled" | "canceled" => "cancelled",
        _ => "pending",
    }
}

fn map_plan_entry_status(raw: &str) -> &'static str {
    match raw.to_ascii_lowercase().replace('-', "_").as_str() {
        "in_progress" | "inprogress" | "running" => "in_progress",
        "completed" | "complete" | "done" => "completed",
        "failed" | "error" | "failure" => "failed",
        _ => "pending",
    }
}

fn ui_tool_call(payload: &Value, fallback_id: &str) -> Value {
    let id = payload
        .get("toolCallId")
        .or_else(|| payload.get("id"))
        .and_then(Value::as_str)
        .unwrap_or(fallback_id);
    let name = payload
        .get("title")
        .or_else(|| payload.pointer("/fields/title"))
        .or_else(|| payload.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("tool");
    let status_raw = payload
        .get("status")
        .or_else(|| payload.pointer("/fields/status"))
        .and_then(|v| {
            v.as_str()
                .map(str::to_string)
                .or_else(|| Some(v.to_string()))
        })
        .unwrap_or_else(|| "pending".to_string());
    let kind = payload
        .get("kind")
        .or_else(|| payload.pointer("/fields/kind"))
        .and_then(|v| {
            v.as_str()
                .map(str::to_string)
                .or_else(|| Some(v.to_string()))
        });
    let input = value_as_string(
        payload
            .get("rawInput")
            .or_else(|| payload.pointer("/fields/rawInput"))
            .or_else(|| payload.get("input")),
    );
    let output = value_as_string(
        payload
            .get("rawOutput")
            .or_else(|| payload.pointer("/fields/rawOutput"))
            .or_else(|| payload.get("output")),
    );
    let mut tool = json!({
        "id": id,
        "name": name,
        "status": map_tool_status(&status_raw),
    });
    if let Some(kind) = kind {
        tool["kind"] = json!(kind);
    }
    if let Some(input) = input {
        tool["input"] = json!(input);
    }
    if let Some(output) = output {
        tool["output"] = json!(output);
    }
    tool
}

fn ui_permission(payload: &Value) -> Value {
    let created_at = payload
        .get("createdAt")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(AgentsHost::now_iso);
    let id = payload
        .get("id")
        .or_else(|| payload.get("requestId"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let options = payload.get("options").cloned().unwrap_or_else(|| json!([]));
    json!({
        "id": id,
        "title": payload.get("title").and_then(Value::as_str).unwrap_or("Permission required"),
        "description": payload.get("description").cloned().unwrap_or(Value::Null),
        "scope": payload.get("scope").cloned().unwrap_or(Value::Null),
        "options": options,
        "createdAt": created_at,
        "sessionId": payload.get("sessionId").cloned().unwrap_or(Value::Null),
        "toolCall": payload.get("toolCall").cloned().unwrap_or(Value::Null),
        "status": "pending",
    })
}

fn ui_plan(payload: &Value, fallback_id: &str) -> Value {
    let updated_at = AgentsHost::now_iso();
    let plan_id = payload
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or(fallback_id);
    let entries = payload
        .get("entries")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .enumerate()
                .map(|(index, entry)| {
                    let status_raw = entry
                        .get("status")
                        .and_then(|v| {
                            v.as_str()
                                .map(str::to_string)
                                .or_else(|| Some(v.to_string()))
                        })
                        .unwrap_or_else(|| "pending".to_string());
                    let entry_id = entry
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("{plan_id}-{index}"));
                    let label = entry
                        .get("label")
                        .or_else(|| entry.get("content"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    json!({
                        "id": entry_id,
                        "label": label,
                        "status": map_plan_entry_status(&status_raw),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "id": plan_id,
        "entries": entries,
        "updatedAt": updated_at,
    })
}

fn ui_usage(payload: &Value) -> Value {
    let as_u64 = |v: &Value| v.as_u64().or_else(|| v.as_f64().map(|n| n as u64));
    let used = payload
        .get("used")
        .and_then(as_u64)
        .or_else(|| payload.get("size").and_then(as_u64))
        .unwrap_or(0);
    let limit = if payload.get("used").is_some() {
        payload
            .get("limit")
            .or_else(|| payload.get("size"))
            .or_else(|| payload.get("total"))
            .and_then(as_u64)
    } else {
        payload
            .get("limit")
            .or_else(|| payload.get("total"))
            .and_then(as_u64)
    };
    let unit = payload
        .get("unit")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            if payload.get("used").is_some() || payload.get("size").is_some() {
                Some("tokens".to_string())
            } else {
                None
            }
        });
    let mut usage = json!({ "used": used });
    if let Some(limit) = limit {
        usage["limit"] = json!(limit);
    }
    if let Some(unit) = unit {
        usage["unit"] = json!(unit);
    }
    usage
}

fn ui_timeline_item(item: &TimelineItem) -> Value {
    let created_at = AgentsHost::now_iso();
    match item.kind {
        TimelineItemKind::Thought => json!({
            "id": item.id,
            "kind": "thought",
            "text": payload_text(&item.payload),
            "createdAt": created_at,
        }),
        TimelineItemKind::ToolCall => {
            let tool = ui_tool_call(&item.payload, &item.id);
            let kind = tool
                .get("kind")
                .or_else(|| tool.get("toolKind"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_ascii_lowercase();
            if kind.contains("terminal") {
                let text = tool
                    .get("content")
                    .and_then(Value::as_str)
                    .or_else(|| tool.get("output").and_then(Value::as_str))
                    .or_else(|| tool.get("name").and_then(Value::as_str))
                    .unwrap_or("terminal");
                json!({
                    "id": item.id,
                    "kind": "terminal",
                    "text": text,
                    "createdAt": created_at,
                })
            } else {
                json!({
                    "id": item.id,
                    "kind": "tool_call",
                    "toolCall": tool,
                    "createdAt": created_at,
                })
            }
        }
        TimelineItemKind::Permission => {
            let permission = ui_permission(&item.payload);
            json!({
                "id": item.id,
                "kind": "permission",
                "permission": permission,
                "createdAt": created_at,
            })
        }
        TimelineItemKind::UserInput => {
            let user_input = ui_user_input(&item.payload);
            json!({
                "id": item.id,
                "kind": "user_input",
                "userInput": user_input,
                "createdAt": created_at,
            })
        }
        TimelineItemKind::Plan => json!({
            "id": item.id,
            "kind": "plan",
            "plan": ui_plan(&item.payload, &item.id),
            "createdAt": created_at,
        }),
        TimelineItemKind::Usage => json!({
            "id": item.id,
            "kind": "usage",
            "usage": ui_usage(&item.payload),
            "createdAt": created_at,
        }),
        TimelineItemKind::Text => json!({
            "id": item.id,
            "kind": "assistant",
            "text": payload_text(&item.payload),
            "createdAt": created_at,
        }),
        TimelineItemKind::Error => json!({
            "id": item.id,
            "kind": "error",
            "text": payload_text(&item.payload),
            "createdAt": created_at,
        }),
        TimelineItemKind::Status => {
            let status_type = item
                .payload
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("");
            let text = match status_type {
                "commands" => "Commands updated".to_string(),
                "config" | "config_options" => "Config updated".to_string(),
                "discovered_models" => "Models updated".to_string(),
                _ => {
                    let from_payload = payload_text(&item.payload);
                    if from_payload.is_empty() {
                        "Status updated".to_string()
                    } else {
                        from_payload
                    }
                }
            };
            json!({
                "id": item.id,
                "kind": "connection",
                "text": text,
                "createdAt": created_at,
            })
        }
    }
}

fn ui_user_input(payload: &Value) -> Value {
    let mut input = payload.clone();
    if input.get("id").is_none() {
        input["id"] = json!(uuid::Uuid::new_v4().to_string());
    }
    if input.get("kind").is_none() {
        input["kind"] = json!("ask_question");
    }
    if input.get("title").is_none() {
        input["title"] = json!("Input required");
    }
    if input.get("createdAt").is_none() {
        input["createdAt"] = json!(AgentsHost::now_iso());
    }
    if input.get("status").is_none() {
        input["status"] = json!("pending");
    }
    input
}

#[allow(clippy::too_many_arguments)]
fn run_codex_turn(
    app: &EventHub,
    root_path: &str,
    thread_id: &str,
    assistant_id: &str,
    prompt: &str,
    model: Option<String>,
    images: Vec<(String, String)>,
    cancel: watch::Receiver<bool>,
    supervisor: Arc<CodexSupervisor>,
    runtime: tokio::runtime::Handle,
) -> Result<(), String> {
    let thread = AgentsHost::read_thread_value(root_path, thread_id)
        .ok_or_else(|| "thread_not_found".to_string())?;
    let runtime_mode =
        CodexRuntimeMode::from_product_value(thread.get("runtimeMode").and_then(Value::as_str));
    let existing_provider_thread_id = thread
        .get("providerSessionId")
        .or_else(|| thread.get("codexThreadId"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let model = model.filter(|model| !model.is_empty() && model != "auto");
    let thread_key = format!("{root_path}::{thread_id}");
    let streamed_text = Arc::new(Mutex::new(String::new()));

    let result = runtime.block_on(supervisor.run_turn(CodexSupervisorTurnRequest {
        executable: PathBuf::from("codex"),
        extra_args: Vec::new(),
        env: Vec::new(),
        workspace_root: PathBuf::from(root_path),
        thread_key,
        existing_provider_thread_id,
        prompt: prompt.to_string(),
        images,
        runtime_mode,
        model,
        service_tier: None,
        effort: None,
        cancel,
        on_session: {
            let app = app.clone();
            let root_path = root_path.to_string();
            let thread_id = thread_id.to_string();
            Arc::new(move |provider_thread_id| {
                persist_native_session(
                    &app,
                    &root_path,
                    &thread_id,
                    "codex-app-server",
                    provider_thread_id,
                );
            })
        },
        on_text_delta: {
            let app = app.clone();
            let root_path = root_path.to_string();
            let thread_id = thread_id.to_string();
            let assistant_id = assistant_id.to_string();
            let streamed_text = streamed_text.clone();
            Arc::new(move |delta| {
                let snapshot = {
                    let mut text = streamed_text.lock().expect("Codex text lock poisoned");
                    text.push_str(delta);
                    text.clone()
                };
                emit_assistant_delta(&app, &root_path, &thread_id, &assistant_id, &snapshot);
            })
        },
        on_notification: {
            let app = app.clone();
            let root_path = root_path.to_string();
            let thread_id = thread_id.to_string();
            Arc::new(move |notification| {
                let provider_session_id = AgentsHost::read_thread_value(&root_path, &thread_id)
                    .and_then(|thread| {
                        thread
                            .get("providerSessionId")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                    .unwrap_or_else(|| thread_id.clone());
                if let Some(update) =
                    normalize_codex_notification(notification, &provider_session_id)
                {
                    persist_codex_timeline_update(&app, &root_path, &thread_id, update);
                }
            })
        },
        on_interaction: {
            let app = app.clone();
            let root_path = root_path.to_string();
            let thread_id = thread_id.to_string();
            Arc::new(move |interaction| {
                persist_codex_interaction(&app, &root_path, &thread_id, interaction);
            })
        },
    }));

    clear_native_pending_interactions(app, root_path, thread_id);
    let result = result.map_err(|error| error.to_string())?;
    persist_thread_activity(app, root_path, thread_id, None);
    if result.cancelled || result.status == "interrupted" {
        update_assistant(
            app,
            root_path,
            thread_id,
            assistant_id,
            Some(&result.text),
            "cancelled",
            None,
        );
    } else if result.status == "completed" {
        update_assistant(
            app,
            root_path,
            thread_id,
            assistant_id,
            Some(&result.text),
            "idle",
            None,
        );
    } else {
        let error = result
            .error
            .as_ref()
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("Codex turn ended with status {}", result.status));
        update_assistant(
            app,
            root_path,
            thread_id,
            assistant_id,
            Some(&result.text),
            "error",
            Some(&error),
        );
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn run_claude_turn(
    app: &EventHub,
    root_path: &str,
    thread_id: &str,
    assistant_id: &str,
    prompt: &str,
    model: Option<String>,
    images: Vec<(String, String)>,
    cancel: watch::Receiver<bool>,
    supervisor: Arc<ClaudeSupervisor>,
    runtime: tokio::runtime::Handle,
) -> Result<(), String> {
    let thread = AgentsHost::read_thread_value(root_path, thread_id)
        .ok_or_else(|| "thread_not_found".to_string())?;
    let permission_mode =
        ClaudePermissionMode::from_product_value(thread.get("runtimeMode").and_then(Value::as_str));
    let existing_provider_session_id = thread
        .get("providerSessionId")
        .or_else(|| thread.get("claudeSessionId"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let model = model.filter(|model| !model.is_empty() && model != "auto");
    let thread_key = format!("{root_path}::{thread_id}");
    let streamed_text = Arc::new(Mutex::new(String::new()));
    let executable = std::env::var("GHARARGAH_MOCK_CLAUDE_SDK_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("claude"));

    let result = runtime.block_on(supervisor.run_turn(ClaudeSupervisorTurnRequest {
        executable,
        extra_args: Vec::new(),
        env: Vec::new(),
        workspace_root: PathBuf::from(root_path),
        thread_key,
        existing_provider_session_id,
        prompt: prompt.to_string(),
        images,
        permission_mode,
        model,
        effort: None,
        cancel,
        on_session: {
            let app = app.clone();
            let root_path = root_path.to_string();
            let thread_id = thread_id.to_string();
            Arc::new(move |provider_session_id| {
                persist_native_session(
                    &app,
                    &root_path,
                    &thread_id,
                    "claude-sdk",
                    provider_session_id,
                );
            })
        },
        on_text_delta: {
            let app = app.clone();
            let root_path = root_path.to_string();
            let thread_id = thread_id.to_string();
            let assistant_id = assistant_id.to_string();
            let streamed_text = streamed_text.clone();
            Arc::new(move |delta| {
                let snapshot = {
                    let mut text = streamed_text.lock().expect("Claude text lock poisoned");
                    text.push_str(delta);
                    text.clone()
                };
                emit_assistant_delta(&app, &root_path, &thread_id, &assistant_id, &snapshot);
            })
        },
        on_message: Arc::new(|_| {}),
        on_timeline: {
            let app = app.clone();
            let root_path = root_path.to_string();
            let thread_id = thread_id.to_string();
            Arc::new(move |update| {
                persist_claude_timeline_update(&app, &root_path, &thread_id, update);
            })
        },
        on_interaction: {
            let app = app.clone();
            let root_path = root_path.to_string();
            let thread_id = thread_id.to_string();
            Arc::new(move |interaction| {
                persist_claude_interaction(&app, &root_path, &thread_id, interaction);
            })
        },
    }));

    clear_native_pending_interactions(app, root_path, thread_id);
    let result = result.map_err(|error| error.to_string())?;
    persist_thread_activity(app, root_path, thread_id, None);
    if result.cancelled || result.status == "interrupted" {
        update_assistant(
            app,
            root_path,
            thread_id,
            assistant_id,
            Some(&result.text),
            "cancelled",
            None,
        );
    } else if result.status == "completed" {
        update_assistant(
            app,
            root_path,
            thread_id,
            assistant_id,
            Some(&result.text),
            "idle",
            None,
        );
    } else {
        let error = result
            .error
            .clone()
            .unwrap_or_else(|| format!("Claude turn ended with status {}", result.status));
        update_assistant(
            app,
            root_path,
            thread_id,
            assistant_id,
            Some(&result.text),
            "error",
            Some(&error),
        );
    }
    Ok(())
}

fn persist_native_session(
    app: &EventHub,
    root_path: &str,
    thread_id: &str,
    transport: &str,
    provider_thread_id: &str,
) {
    let Some(mut thread) = AgentsHost::read_thread_value(root_path, thread_id) else {
        return;
    };
    thread["providerTransport"] = json!(transport);
    thread["providerSessionId"] = json!(provider_thread_id);
    thread["connection"] = json!({
        "status": "connected",
        "message": Value::Null,
        "updatedAt": AgentsHost::now_iso(),
        "providerId": Value::Null,
        "authMethods": [],
    });
    let _ = AgentsHost::write_thread(root_path, &thread);
    emit_host(app, "agents:threadUpdated", vec![thread]);
}

fn persist_codex_interaction(
    app: &EventHub,
    root_path: &str,
    thread_id: &str,
    interaction: CodexInteraction,
) {
    let Some(mut thread) = AgentsHost::read_thread_value(root_path, thread_id) else {
        return;
    };
    let now = AgentsHost::now_iso();
    match interaction.kind {
        CodexInteractionKind::Permission => {
            let permission = ui_permission(&interaction.payload);
            upsert_by_id(
                &mut thread["pendingPermissions"],
                permission.clone(),
                &interaction.request_id,
            );
            upsert_by_id(
                &mut thread["timeline"],
                json!({
                    "id": interaction.request_id,
                    "kind": "permission",
                    "permission": permission,
                    "createdAt": now,
                }),
                &interaction.request_id,
            );
            thread["status"] = json!("waiting_for_permission");
            emit_host(
                app,
                "agents:permissionRequest",
                vec![json!({
                    "workspaceRootPath": root_path,
                    "workspaceRootUri": thread.get("workspaceRootUri").and_then(Value::as_str).unwrap_or(""),
                    "threadId": thread_id,
                    "request": interaction.payload,
                })],
            );
        }
        CodexInteractionKind::UserInput => {
            let user_input = ui_user_input(&interaction.payload);
            upsert_by_id(
                &mut thread["pendingUserInputs"],
                user_input.clone(),
                &interaction.request_id,
            );
            upsert_by_id(
                &mut thread["timeline"],
                json!({
                    "id": interaction.request_id,
                    "kind": "user_input",
                    "userInput": user_input,
                    "createdAt": now,
                }),
                &interaction.request_id,
            );
            thread["status"] = json!("waiting_for_permission");
            thread["activity"] = json!("Waiting for input…");
        }
    }
    let _ = AgentsHost::write_thread(root_path, &thread);
    emit_host(app, "agents:threadUpdated", vec![thread]);
}

fn persist_codex_timeline_update(
    app: &EventHub,
    root_path: &str,
    thread_id: &str,
    update: CodexTimelineUpdate,
) {
    let Some(mut thread) = AgentsHost::read_thread_value(root_path, thread_id) else {
        return;
    };
    if update.append_text {
        if let Some(timeline) = thread.get_mut("timeline").and_then(Value::as_array_mut) {
            if let Some(existing) = timeline.iter_mut().find(|candidate| {
                candidate.get("id").and_then(Value::as_str) == Some(update.item.id.as_str())
            }) {
                let delta = payload_text(&update.item.payload);
                let current = existing.get("text").and_then(Value::as_str).unwrap_or("");
                existing["text"] = json!(format!("{current}{delta}"));
                let _ = AgentsHost::write_thread(root_path, &thread);
                emit_host(app, "agents:threadUpdated", vec![thread]);
                return;
            }
        }
    }
    let id = update.item.id.clone();
    match update.item.kind {
        TimelineItemKind::Plan => {
            thread["plan"] = ui_plan(&update.item.payload, &id);
        }
        TimelineItemKind::Usage => {
            thread["usage"] = ui_usage(&update.item.payload);
        }
        TimelineItemKind::ToolCall => {
            thread["activity"] = json!(format!(
                "Tool: {}",
                update
                    .item
                    .payload
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("Codex tool")
            ));
        }
        TimelineItemKind::Thought => {
            thread["activity"] = json!("Thinking…");
        }
        _ => {}
    }
    upsert_by_id(&mut thread["timeline"], ui_timeline_item(&update.item), &id);
    let _ = AgentsHost::write_thread(root_path, &thread);
    emit_host(app, "agents:threadUpdated", vec![thread]);
}

fn persist_claude_interaction(
    app: &EventHub,
    root_path: &str,
    thread_id: &str,
    interaction: ClaudeInteraction,
) {
    let Some(mut thread) = AgentsHost::read_thread_value(root_path, thread_id) else {
        return;
    };
    let now = AgentsHost::now_iso();
    match interaction.kind {
        ClaudeInteractionKind::Permission => {
            let permission = ui_permission(&interaction.payload);
            upsert_by_id(
                &mut thread["pendingPermissions"],
                permission.clone(),
                &interaction.request_id,
            );
            upsert_by_id(
                &mut thread["timeline"],
                json!({
                    "id": interaction.request_id,
                    "kind": "permission",
                    "permission": permission,
                    "createdAt": now,
                }),
                &interaction.request_id,
            );
            thread["status"] = json!("waiting_for_permission");
            emit_host(
                app,
                "agents:permissionRequest",
                vec![json!({
                    "workspaceRootPath": root_path,
                    "workspaceRootUri": thread.get("workspaceRootUri").and_then(Value::as_str).unwrap_or(""),
                    "threadId": thread_id,
                    "request": interaction.payload,
                })],
            );
        }
        ClaudeInteractionKind::UserInput => {
            let user_input = ui_user_input(&interaction.payload);
            upsert_by_id(
                &mut thread["pendingUserInputs"],
                user_input.clone(),
                &interaction.request_id,
            );
            upsert_by_id(
                &mut thread["timeline"],
                json!({
                    "id": interaction.request_id,
                    "kind": "user_input",
                    "userInput": user_input,
                    "createdAt": now,
                }),
                &interaction.request_id,
            );
            thread["status"] = json!("waiting_for_permission");
            thread["activity"] = json!("Waiting for input…");
        }
    }
    let _ = AgentsHost::write_thread(root_path, &thread);
    emit_host(app, "agents:threadUpdated", vec![thread]);
}

fn persist_claude_timeline_update(
    app: &EventHub,
    root_path: &str,
    thread_id: &str,
    update: ClaudeTimelineUpdate,
) {
    let Some(mut thread) = AgentsHost::read_thread_value(root_path, thread_id) else {
        return;
    };
    if update.append_text {
        if let Some(timeline) = thread.get_mut("timeline").and_then(Value::as_array_mut) {
            if let Some(existing) = timeline.iter_mut().find(|candidate| {
                candidate.get("id").and_then(Value::as_str) == Some(update.item.id.as_str())
            }) {
                let delta = payload_text(&update.item.payload);
                let current = existing.get("text").and_then(Value::as_str).unwrap_or("");
                existing["text"] = json!(format!("{current}{delta}"));
                let _ = AgentsHost::write_thread(root_path, &thread);
                emit_host(app, "agents:threadUpdated", vec![thread]);
                return;
            }
        }
    }
    let id = update.item.id.clone();
    match update.item.kind {
        TimelineItemKind::Plan => {
            thread["plan"] = ui_plan(&update.item.payload, &id);
        }
        TimelineItemKind::Usage => {
            thread["usage"] = ui_usage(&update.item.payload);
        }
        TimelineItemKind::ToolCall => {
            thread["activity"] = json!(format!(
                "Tool: {}",
                update
                    .item
                    .payload
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("Claude tool")
            ));
        }
        TimelineItemKind::Thought => {
            thread["activity"] = json!("Thinking…");
        }
        _ => {}
    }
    upsert_by_id(&mut thread["timeline"], ui_timeline_item(&update.item), &id);
    let _ = AgentsHost::write_thread(root_path, &thread);
    emit_host(app, "agents:threadUpdated", vec![thread]);
}

fn upsert_by_id(target: &mut Value, value: Value, id: &str) {
    if !target.is_array() {
        *target = json!([]);
    }
    let items = target.as_array_mut().expect("initialized as array");
    if let Some(existing) = items
        .iter_mut()
        .find(|item| item.get("id").and_then(Value::as_str) == Some(id))
    {
        *existing = value;
    } else {
        items.push(value);
    }
}

fn clear_native_pending_interactions(app: &EventHub, root_path: &str, thread_id: &str) {
    let Some(mut thread) = AgentsHost::read_thread_value(root_path, thread_id) else {
        return;
    };
    thread["pendingPermissions"] = json!([]);
    thread["pendingUserInputs"] = json!([]);
    let _ = AgentsHost::write_thread(root_path, &thread);
    emit_host(app, "agents:threadUpdated", vec![thread]);
}

fn run_acp_turn(
    app: &EventHub,
    root_path: &str,
    thread_id: &str,
    assistant_id: &str,
    prompt: &str,
    agent_id: &str,
    model: Option<String>,
    images: Vec<(String, String)>,
    existing_session_id: Option<String>,
    _cancel: watch::Receiver<bool>,
    supervisor: Arc<AcpSupervisor>,
    runtime: tokio::runtime::Handle,
    use_mock: bool,
) -> Result<(), String> {
    let profile = if use_mock {
        let mut profile = mock_strict();
        let scenario =
            std::env::var("GHARARGAH_AGENT_MOCK_SCENARIO").unwrap_or_else(|_| "echo".to_string());
        profile.spawn_args = vec!["--scenario".to_string(), scenario, "--strict".to_string()];
        // Keep mock profile id aligned with the product provider so connection
        // snapshots / force-stop keys match the thread's acpProvider.
        if let Some(id) = acp_profile_id_for_agent(agent_id) {
            profile.id = id;
        }
        profile
    } else {
        let mut profile = profile_for_agent(agent_id)
            .ok_or_else(|| format!("No ACP profile for agent {agent_id}"))?;
        let resolved = profile
            .resolve_executable()
            .map_err(|error| error.to_string())?;
        profile.executable = Box::leak(resolved.to_string_lossy().into_owned().into_boxed_str());
        profile
    };
    let provider_id = profile.id.to_string();
    let thread_key = format!("{root_path}::{thread_id}");
    let initial_sequence = AgentsHost::read_thread_value(root_path, thread_id)
        .and_then(|thread| thread.get("acpSequence").and_then(Value::as_u64))
        .unwrap_or(0);
    let prefer_resume = AgentsHost::read_thread_value(root_path, thread_id)
        .map(|thread| {
            thread
                .get("timeline")
                .and_then(Value::as_array)
                .map(|items| !items.is_empty())
                .unwrap_or(false)
        })
        .unwrap_or(false);
    // Continuation key: refuse mid-thread provider switch.
    let (runtime_mode, interaction_mode) =
        if let Some(thread) = AgentsHost::read_thread_value(root_path, thread_id) {
            if let Some(existing) = thread.get("acpProvider").and_then(Value::as_str) {
                if !existing.is_empty() && existing != provider_id {
                    return Err(format!(
                        "continuation_key_mismatch: thread bound to {existing}, got {provider_id}"
                    ));
                }
            }
            (
                thread
                    .get("runtimeMode")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                thread
                    .get("interactionMode")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            )
        } else {
            (None, None)
        };
    let turn_result = runtime.block_on(supervisor.run_turn(SupervisorTurnRequest {
        provider: profile,
        workspace_root: PathBuf::from(root_path),
        thread_key,
        prompt: prompt.to_string(),
        images,
        model,
        existing_session_id,
        runtime_mode,
        interaction_mode,
        prefer_resume,
        initial_sequence,
        on_session: {
            let app = app.clone();
            let root_path = root_path.to_string();
            let thread_id = thread_id.to_string();
            let provider_id = provider_id.clone();
            Arc::new(move |session_id| {
                persist_acp_session_id(&app, &root_path, &thread_id, session_id);
                persist_acp_provider(&app, &root_path, &thread_id, &provider_id);
            })
        },
        on_text: {
            let app = app.clone();
            let root_path = root_path.to_string();
            let thread_id = thread_id.to_string();
            let assistant_id = assistant_id.to_string();
            Arc::new(move |text| {
                emit_assistant_delta(&app, &root_path, &thread_id, &assistant_id, text);
            })
        },
        on_activity: {
            let app = app.clone();
            let root_path = root_path.to_string();
            let thread_id = thread_id.to_string();
            Arc::new(move |activity| {
                persist_thread_activity(&app, &root_path, &thread_id, Some(activity));
            })
        },
        on_event: {
            let app = app.clone();
            let root_path = root_path.to_string();
            let thread_id = thread_id.to_string();
            let provider_id = provider_id.clone();
            let supervisor = supervisor.clone();
            Arc::new(move |sequence, event| {
                let super::acp::NormalizedEvent::Timeline(item) = event else {
                    return;
                };
                let Some(mut thread) = AgentsHost::read_thread_value(&root_path, &thread_id) else {
                    return;
                };
                thread["acpSequence"] = json!(sequence);
                thread["acpProvider"] = json!(provider_id);
                // Live connection snapshot during turn.
                let snapshot = supervisor.connection_snapshot(&provider_id);
                thread["connection"] = connection_ui_from_snapshot(&snapshot);

                let status_type = item
                    .payload
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if item.kind == TimelineItemKind::Status
                    && matches!(
                        status_type,
                        "commands"
                            | "config_options"
                            | "discovered_models"
                            | "config"
                            | "session_modes"
                    )
                {
                    match status_type {
                        "commands" => {
                            if let Some(commands) = item
                                .payload
                                .get("availableCommands")
                                .cloned()
                                .or_else(|| item.payload.get("available_commands").cloned())
                            {
                                thread["availableCommands"] = commands;
                            }
                        }
                        "session_modes" => {
                            if let Some(modes) = item.payload.get("modes").cloned() {
                                thread["sessionModes"] = modes;
                            }
                        }
                        "config_options" => {
                            if let Some(options) = item.payload.get("options").cloned() {
                                thread["configOptions"] = options;
                            }
                        }
                        "config" => {
                            if let Some(options) = item
                                .payload
                                .get("configOptions")
                                .cloned()
                                .or_else(|| item.payload.get("options").cloned())
                            {
                                thread["configOptions"] = options;
                            }
                        }
                        "discovered_models" => {
                            if let Some(models) = item.payload.get("models").cloned() {
                                thread["discoveredModels"] = models;
                            }
                        }
                        _ => {}
                    }
                    let workspace_root_uri = thread
                        .get("workspaceRootUri")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let updated_at = AgentsHost::now_iso();
                    let _ = AgentsHost::write_thread(&root_path, &thread);
                    emit_host(
                        &app,
                        "agents:structuredDelta",
                        vec![json!({
                            "workspaceRootUri": workspace_root_uri,
                            "threadId": thread_id,
                            "sequence": sequence,
                            "updatedAt": updated_at,
                            "created": [],
                            "usage": thread.get("usage").cloned().unwrap_or(Value::Null),
                            "plan": thread.get("plan").cloned().unwrap_or(Value::Null),
                            "pendingPermissions": thread.get("pendingPermissions").cloned().unwrap_or(json!([])),
                            "pendingUserInputs": thread.get("pendingUserInputs").cloned().unwrap_or(json!([])),
                            "configOptions": thread.get("configOptions").cloned().unwrap_or(json!([])),
                            "discoveredModels": thread.get("discoveredModels").cloned().unwrap_or(json!([])),
                            "status": thread.get("status").cloned().unwrap_or(json!("running")),
                            "connection": thread.get("connection").cloned().unwrap_or(Value::Null),
                        })],
                    );
                    emit_host(&app, "agents:threadUpdated", vec![thread]);
                    return;
                }

                let item_value = ui_timeline_item(&item);
                let mut updated_items = Vec::new();
                let mut created_items = Vec::new();
                if let Some(timeline) = thread.get_mut("timeline").and_then(Value::as_array_mut) {
                    if let Some(existing) = timeline.iter_mut().find(|candidate| {
                        candidate.get("id").and_then(Value::as_str) == Some(item.id.as_str())
                    }) {
                        *existing = item_value.clone();
                        updated_items.push(item_value.clone());
                    } else {
                        timeline.push(item_value.clone());
                        created_items.push(item_value.clone());
                    }
                } else {
                    thread["timeline"] = json!([item_value.clone()]);
                    created_items.push(item_value.clone());
                }
                match item.kind {
                    TimelineItemKind::Permission => {
                        let permission = item_value
                            .get("permission")
                            .cloned()
                            .unwrap_or_else(|| ui_permission(&item.payload));
                        // Runtime mode full-access: auto-approve allow_* options.
                        let runtime_mode = thread
                            .get("runtimeMode")
                            .and_then(Value::as_str)
                            .unwrap_or("approval-required");
                        if runtime_mode == "full-access" {
                            if let Some(option_id) = auto_approve_permission_option(&permission) {
                                let _ = supervisor.resolve_permission(
                                    permission
                                        .get("id")
                                        .and_then(Value::as_str)
                                        .unwrap_or(""),
                                    &option_id,
                                );
                                return;
                            }
                        }
                        // Allow-always memory: auto-resolve matching remembered rules.
                        if let Some(option_id) =
                            remembered_permission_option(&thread, &permission)
                        {
                            let _ = supervisor.resolve_permission(
                                permission
                                    .get("id")
                                    .and_then(Value::as_str)
                                    .unwrap_or(""),
                                &option_id,
                            );
                            return;
                        }
                        if let Some(pending) = thread
                            .get_mut("pendingPermissions")
                            .and_then(Value::as_array_mut)
                        {
                            if let Some(existing) = pending.iter_mut().find(|candidate| {
                                candidate.get("id").and_then(Value::as_str)
                                    == permission.get("id").and_then(Value::as_str)
                            }) {
                                *existing = permission.clone();
                            } else {
                                pending.push(permission.clone());
                            }
                        } else {
                            thread["pendingPermissions"] = json!([permission.clone()]);
                        }
                        thread["status"] = json!("waiting_for_permission");
                        emit_host(
                            &app,
                            "agents:permissionRequest",
                            vec![json!({
                                "workspaceRootPath": root_path,
                                "workspaceRootUri": thread.get("workspaceRootUri").and_then(Value::as_str).unwrap_or(""),
                                "threadId": thread_id,
                                "request": permission,
                            })],
                        );
                    }
                    TimelineItemKind::UserInput => {
                        let user_input = item_value
                            .get("userInput")
                            .cloned()
                            .unwrap_or_else(|| ui_user_input(&item.payload));
                        if let Some(pending) = thread
                            .get_mut("pendingUserInputs")
                            .and_then(Value::as_array_mut)
                        {
                            if let Some(existing) = pending.iter_mut().find(|candidate| {
                                candidate.get("id").and_then(Value::as_str)
                                    == user_input.get("id").and_then(Value::as_str)
                            }) {
                                *existing = user_input.clone();
                            } else {
                                pending.push(user_input.clone());
                            }
                        } else {
                            thread["pendingUserInputs"] = json!([user_input.clone()]);
                        }
                        thread["status"] = json!("waiting_for_permission");
                        thread["activity"] = json!("Waiting for input…");
                    }
                    TimelineItemKind::Plan => {
                        thread["plan"] = item_value
                            .get("plan")
                            .cloned()
                            .unwrap_or_else(|| ui_plan(&item.payload, &item.id));
                    }
                    TimelineItemKind::Usage => {
                        thread["usage"] = item_value
                            .get("usage")
                            .cloned()
                            .unwrap_or_else(|| ui_usage(&item.payload));
                    }
                    TimelineItemKind::ToolCall => {
                        let title = item_value
                            .pointer("/toolCall/name")
                            .and_then(Value::as_str)
                            .unwrap_or("tool");
                        thread["activity"] = json!(format!("Tool: {title}"));
                    }
                    TimelineItemKind::Thought => {
                        thread["activity"] = json!("Thinking…");
                    }
                    TimelineItemKind::Text
                    | TimelineItemKind::Status
                    | TimelineItemKind::Error => {}
                }
                let workspace_root_uri = thread
                    .get("workspaceRootUri")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let updated_at = AgentsHost::now_iso();
                let _ = AgentsHost::write_thread(&root_path, &thread);
                emit_host(
                    &app,
                    "agents:structuredDelta",
                    vec![json!({
                        "workspaceRootUri": workspace_root_uri,
                        "threadId": thread_id,
                        "sequence": sequence,
                        "updatedAt": updated_at,
                        "created": created_items,
                        "updated": updated_items,
                        "usage": thread.get("usage").cloned().unwrap_or(Value::Null),
                        "plan": thread.get("plan").cloned().unwrap_or(Value::Null),
                        "pendingPermissions": thread.get("pendingPermissions").cloned().unwrap_or(json!([])),
                        "pendingUserInputs": thread.get("pendingUserInputs").cloned().unwrap_or(json!([])),
                        "configOptions": thread.get("configOptions").cloned().unwrap_or(json!([])),
                        "discoveredModels": thread.get("discoveredModels").cloned().unwrap_or(json!([])),
                        "status": thread.get("status").cloned().unwrap_or(json!("running")),
                        "connection": thread.get("connection").cloned().unwrap_or(Value::Null),
                    })],
                );
            })
        },
    }));
    // Persist connection snapshot onto the thread at turn boundaries (including auth failures).
    if let Some(mut thread) = AgentsHost::read_thread_value(root_path, thread_id) {
        let snapshot = supervisor.connection_snapshot(&provider_id);
        thread["connection"] = connection_ui_from_snapshot(&snapshot);
        thread["acpProvider"] = json!(provider_id);
        let _ = AgentsHost::write_thread(root_path, &thread);
        emit_host(app, "agents:threadUpdated", vec![thread]);
    }
    let result = turn_result?;
    persist_thread_activity(app, root_path, thread_id, None);
    if result.cancelled {
        update_assistant(
            app,
            root_path,
            thread_id,
            assistant_id,
            Some(&result.text),
            "cancelled",
            None,
        );
    } else {
        update_assistant(
            app,
            root_path,
            thread_id,
            assistant_id,
            Some(&result.text),
            "idle",
            None,
        );
    }
    Ok(())
}

fn auto_approve_permission_option(permission: &Value) -> Option<String> {
    let options = permission
        .get("options")
        .or_else(|| permission.get("optionIds"))
        .and_then(Value::as_array)?;
    for preferred in ["allow_always", "allow_once", "allow"] {
        for option in options {
            let kind = option
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_ascii_lowercase();
            if kind == preferred || kind.replace('-', "_") == preferred {
                return option.get("id").and_then(Value::as_str).map(str::to_string);
            }
        }
    }
    None
}

fn remembered_permission_option(thread: &Value, permission: &Value) -> Option<String> {
    let rules = thread.get("permissionRules").and_then(Value::as_array)?;
    let tool_name = permission
        .get("toolName")
        .or_else(|| permission.pointer("/toolCall/name"))
        .or_else(|| permission.get("title"))
        .and_then(Value::as_str)
        .unwrap_or("");
    for rule in rules {
        let scope = rule.get("scope").and_then(Value::as_str).unwrap_or("");
        let option_id = rule.get("optionId").and_then(Value::as_str)?;
        if scope == "*" || (!tool_name.is_empty() && scope == tool_name) {
            // Only apply if option still advertised.
            let options = permission
                .get("options")
                .or_else(|| permission.get("optionIds"))
                .and_then(Value::as_array)?;
            if options
                .iter()
                .any(|option| option.get("id").and_then(Value::as_str) == Some(option_id))
            {
                return Some(option_id.to_string());
            }
        }
    }
    None
}

fn map_permission_decision_to_option_id(pending: Option<&Value>, decision: &str) -> Option<String> {
    let target_kinds: &[&str] = match decision {
        "allow_once" => &["allow_once"],
        "allow_always" => &["allow_always"],
        "reject_once" => &["reject_once"],
        "reject_always" => &["reject_always"],
        "reject" => &["reject_once", "reject_always", "reject"],
        _ => {
            // Exact option id passthrough.
            return Some(decision.to_string());
        }
    };
    let options = pending.and_then(|value| {
        value
            .get("options")
            .or_else(|| value.get("optionIds"))
            .and_then(Value::as_array)
    })?;
    for option in options {
        let kind = option.get("kind").and_then(Value::as_str).unwrap_or("");
        let matches_kind = target_kinds
            .iter()
            .any(|candidate| kind.eq_ignore_ascii_case(candidate));
        if matches_kind {
            if let Some(id) = option.get("id").and_then(Value::as_str) {
                return Some(id.to_string());
            }
        }
        // Decision may already be the option id.
        if option.get("id").and_then(Value::as_str) == Some(decision) {
            return Some(decision.to_string());
        }
    }
    None
}

fn connection_ui_from_snapshot(snapshot: &super::acp::ProviderConnectionSnapshot) -> Value {
    let status = match snapshot.state {
        super::acp::ConnectionState::Ready => "connected",
        super::acp::ConnectionState::Starting
        | super::acp::ConnectionState::Initializing
        | super::acp::ConnectionState::NotStarted => "connecting",
        super::acp::ConnectionState::AuthenticationRequired
        | super::acp::ConnectionState::Authenticating => "authenticating",
        super::acp::ConnectionState::Restarting => "reconnecting",
        super::acp::ConnectionState::Degraded | super::acp::ConnectionState::Failed => "error",
        super::acp::ConnectionState::Stopping | super::acp::ConnectionState::Stopped => {
            "disconnected"
        }
    };
    json!({
        "status": status,
        "message": snapshot.detail.clone().or_else(|| snapshot.last_error.clone()),
        "updatedAt": chrono::DateTime::from_timestamp_millis(snapshot.last_transition_at_ms as i64)
            .unwrap_or_else(chrono::Utc::now)
            .to_rfc3339(),
        "providerId": snapshot.provider_id,
        "authMethods": snapshot.auth_method_ids,
    })
}

fn persist_thread_activity(
    app: &EventHub,
    root_path: &str,
    thread_id: &str,
    activity: Option<&str>,
) {
    let Some(mut thread) = AgentsHost::read_thread_value(root_path, thread_id) else {
        return;
    };
    let next = activity.map(str::to_string);
    let current = thread
        .get("activity")
        .and_then(Value::as_str)
        .map(str::to_string);
    if current == next {
        return;
    }
    thread["activity"] = match next {
        Some(value) => json!(value),
        None => Value::Null,
    };
    let _ = AgentsHost::write_thread(root_path, &thread);
    emit_host(app, "agents:threadUpdated", vec![thread]);
}

fn persist_acp_session_id(app: &EventHub, root_path: &str, thread_id: &str, session_id: &str) {
    let Some(mut thread) = AgentsHost::read_thread_value(root_path, thread_id) else {
        return;
    };
    if thread.get("acpSessionId").and_then(Value::as_str) == Some(session_id) {
        return;
    }
    thread["acpSessionId"] = json!(session_id);
    let _ = AgentsHost::write_thread(root_path, &thread);
    emit_host(app, "agents:threadUpdated", vec![thread]);
}

fn persist_acp_provider(app: &EventHub, root_path: &str, thread_id: &str, provider_id: &str) {
    let Some(mut thread) = AgentsHost::read_thread_value(root_path, thread_id) else {
        return;
    };
    if thread.get("acpProvider").and_then(Value::as_str) == Some(provider_id) {
        return;
    }
    thread["acpProvider"] = json!(provider_id);
    let _ = AgentsHost::write_thread(root_path, &thread);
    emit_host(app, "agents:threadUpdated", vec![thread]);
}

fn emit_assistant_delta(
    app: &EventHub,
    root_path: &str,
    thread_id: &str,
    assistant_id: &str,
    text: &str,
) {
    let Some(thread) = AgentsHost::read_thread_value(root_path, thread_id) else {
        return;
    };
    let is_latest_assistant = thread
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| {
            messages
                .iter()
                .rev()
                .find(|message| message.get("role").and_then(Value::as_str) == Some("assistant"))
        })
        .and_then(|message| message.get("id"))
        .and_then(Value::as_str)
        == Some(assistant_id);
    if !is_latest_assistant {
        return;
    }
    emit_host(
        app,
        "agents:threadDelta",
        vec![json!({
            "workspaceRootUri": thread.get("workspaceRootUri").and_then(Value::as_str).unwrap_or(""),
            "threadId": thread_id,
            "updatedAt": AgentsHost::now_iso(),
            // Keep canonical thread status (`running`); `streaming` is message-local.
            "status": "running",
            "lastError": Value::Null,
            "messageId": assistant_id,
            "text": text,
            "streaming": true,
        })],
    );
}

fn cli_command(agent_id: &str, prompt: &str) -> Option<(String, Vec<String>)> {
    let agent = agent_spec(agent_id)?;
    let binary = agent
        .binaries
        .iter()
        .find(|binary| which_binary(binary))?
        .to_string();
    Some((binary, cli_args(agent.id, prompt)?))
}

fn run_cli_turn(
    app: &EventHub,
    root_path: &str,
    thread_id: &str,
    assistant_id: &str,
    prompt: &str,
    agent_id: &str,
    stop: &Arc<Mutex<bool>>,
) -> Result<(), String> {
    let (binary, args) = cli_command(agent_id, prompt)
        .ok_or_else(|| format!("{} CLI not found on PATH", agent_id))?;
    let output = Command::new(binary)
        .args(args)
        .current_dir(root_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;
    if *stop.lock().unwrap() {
        update_assistant(
            app,
            root_path,
            thread_id,
            assistant_id,
            None,
            "error",
            Some("Turn interrupted"),
        );
        return Ok(());
    }
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        update_assistant(
            app,
            root_path,
            thread_id,
            assistant_id,
            None,
            "error",
            Some(&if err.is_empty() {
                "Agent failed".to_string()
            } else {
                err
            }),
        );
        return Ok(());
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    update_assistant(
        app,
        root_path,
        thread_id,
        assistant_id,
        Some(&text),
        "idle",
        None,
    );
    Ok(())
}

fn update_assistant(
    app: &EventHub,
    root_path: &str,
    thread_id: &str,
    assistant_id: &str,
    text: Option<&str>,
    status: &str,
    error: Option<&str>,
) {
    let Some(mut thread) = AgentsHost::read_thread_value(root_path, thread_id) else {
        return;
    };
    let updated_at = AgentsHost::now_iso();
    let mut is_latest_assistant = false;
    if let Some(messages) = thread.get_mut("messages").and_then(|v| v.as_array_mut()) {
        is_latest_assistant = messages
            .iter()
            .rev()
            .find(|message| message.get("role").and_then(Value::as_str) == Some("assistant"))
            .and_then(|message| message.get("id"))
            .and_then(Value::as_str)
            == Some(assistant_id);
        if let Some(msg) = messages
            .iter_mut()
            .find(|m| m.get("id").and_then(|v| v.as_str()) == Some(assistant_id))
        {
            if let Some(text) = text {
                msg["text"] = json!(text);
            }
            msg["updatedAt"] = json!(updated_at);
            msg["streaming"] = json!(status == "streaming");
        }
    }
    if !is_latest_assistant {
        let _ = AgentsHost::write_thread(root_path, &thread);
        emit_host(app, "agents:threadUpdated", vec![thread]);
        return;
    }
    thread["status"] = json!(status);
    thread["updatedAt"] = json!(updated_at);
    if status != "streaming" && status != "running" {
        thread["activity"] = Value::Null;
    }
    if let Some(error) = error {
        thread["lastError"] = json!(error);
    } else if status == "idle" {
        thread["lastError"] = Value::Null;
    }
    if status == "streaming" {
        let root_uri = thread
            .get("workspaceRootUri")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        emit_host(
            app,
            "agents:threadDelta",
            vec![json!({
                "workspaceRootUri": root_uri,
                "threadId": thread_id,
                "updatedAt": updated_at,
                "status": status,
                "lastError": thread.get("lastError").cloned().unwrap_or(Value::Null),
                "messageId": assistant_id,
                "text": text.unwrap_or(""),
                "streaming": true,
            })],
        );
    } else {
        let _ = AgentsHost::write_thread(root_path, &thread);
        emit_host(app, "agents:threadUpdated", vec![thread]);
    }
}

pub fn handle(
    host: &AgentsHost,
    app: &EventHub,
    channel: &str,
    args: &[Value],
) -> Result<Value, String> {
    match channel {
        "agents:listAgents" | "agents:refreshAgents" => Ok(host.list_agents()),
        "agents:listProviders" | "agents:refreshProviders" => Ok(host.list_providers()),
        "agents:listThreads" => Ok(host.list_threads(
            args.first().and_then(|v| v.as_str()).unwrap_or(""),
            args.get(1).and_then(|v| v.as_str()).unwrap_or(""),
        )),
        "agents:readThread" => {
            let root_path = args
                .get(1)
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| {
                    uri_to_path(args.first().and_then(|v| v.as_str()).unwrap_or(""))
                });
            let thread_id = args
                .get(2)
                .and_then(|v| v.as_str())
                .ok_or("missing threadId")?;
            Ok(host
                .read_thread(&root_path, thread_id)
                .unwrap_or(Value::Null))
        }
        "agents:createThread" => host.create_thread(args.first().ok_or("missing input")?),
        "agents:sendMessage" => host.send_message(app, args.first().ok_or("missing input")?),
        "agents:interruptTurn" => Ok(host
            .interrupt_turn(args.first().ok_or("missing input")?)?
            .unwrap_or(Value::Null)),
        "agents:setArchived" => Ok(host
            .set_archived(app, args.first().ok_or("missing input")?)?
            .unwrap_or(Value::Null)),
        "agents:updateThreadSettings" => Ok(host
            .update_settings(app, args.first().ok_or("missing input")?)?
            .unwrap_or(Value::Null)),
        "agents:resolvePermission" => {
            let input = args.first().ok_or("missing input")?;
            let request_id = input
                .get("requestId")
                .or_else(|| input.get("permissionId"))
                .and_then(Value::as_str)
                .ok_or("missing requestId")?;
            let root_path = input.get("workspaceRootPath").and_then(Value::as_str);
            let thread_id = input.get("threadId").and_then(Value::as_str);
            let pending_permission = match (root_path, thread_id) {
                (Some(root_path), Some(thread_id)) => {
                    host.read_thread(root_path, thread_id).and_then(|thread| {
                        thread
                            .get("pendingPermissions")
                            .and_then(Value::as_array)
                            .and_then(|pending| {
                                pending
                                    .iter()
                                    .find(|item| {
                                        item.get("id").and_then(Value::as_str) == Some(request_id)
                                            || item.get("requestId").and_then(Value::as_str)
                                                == Some(request_id)
                                            || item.get("permissionId").and_then(Value::as_str)
                                                == Some(request_id)
                                    })
                                    .cloned()
                            })
                    })
                }
                _ => None,
            };
            let option_id = input
                .get("optionId")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| {
                    let decision = input.get("decision").and_then(Value::as_str)?;
                    map_permission_decision_to_option_id(pending_permission.as_ref(), decision)
                })
                .ok_or("missing optionId")?;
            // Validate option was advertised when pending metadata exists.
            if let Some(pending) = pending_permission.as_ref() {
                if let Some(options) = pending
                    .get("options")
                    .or_else(|| pending.get("optionIds"))
                    .and_then(Value::as_array)
                {
                    let advertised = options.iter().any(|option| {
                        option.get("id").and_then(Value::as_str) == Some(option_id.as_str())
                    });
                    if !options.is_empty() && !advertised {
                        return Err("invalid_permission_option".to_string());
                    }
                }
            }
            let provider_transport = root_path
                .zip(thread_id)
                .and_then(|(root_path, thread_id)| host.read_thread(root_path, thread_id))
                .and_then(|thread| {
                    thread
                        .get("providerTransport")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                });
            match provider_transport.as_deref() {
                Some("codex-app-server") => {
                    host.codex_supervisor
                        .resolve_permission(request_id, &option_id)?;
                }
                Some("claude-sdk") => {
                    host.claude_supervisor
                        .resolve_permission(request_id, &option_id)?;
                }
                _ => {
                    host.supervisor.resolve_permission(request_id, &option_id)?;
                }
            }
            // Clear pending permission from thread when resolved; remember allow_always.
            if let (Some(root_path), Some(thread_id)) = (root_path, thread_id) {
                if let Some(mut thread) = host.read_thread(root_path, thread_id) {
                    let decision_kind = pending_permission
                        .as_ref()
                        .and_then(|pending| {
                            pending
                                .get("options")
                                .or_else(|| pending.get("optionIds"))
                                .and_then(Value::as_array)
                                .and_then(|options| {
                                    options.iter().find_map(|option| {
                                        (option.get("id").and_then(Value::as_str)
                                            == Some(option_id.as_str()))
                                        .then(|| {
                                            option
                                                .get("kind")
                                                .and_then(Value::as_str)
                                                .unwrap_or("")
                                                .to_ascii_lowercase()
                                        })
                                    })
                                })
                        })
                        .unwrap_or_default();
                    if decision_kind.contains("allow_always")
                        || input.get("decision").and_then(Value::as_str) == Some("allow_always")
                    {
                        let scope = pending_permission
                            .as_ref()
                            .and_then(|pending| {
                                pending
                                    .get("toolName")
                                    .or_else(|| pending.pointer("/toolCall/name"))
                                    .or_else(|| pending.get("title"))
                                    .and_then(Value::as_str)
                            })
                            .unwrap_or("*")
                            .to_string();
                        let rule = json!({ "scope": scope, "optionId": option_id });
                        if let Some(rules) = thread
                            .get_mut("permissionRules")
                            .and_then(Value::as_array_mut)
                        {
                            if !rules.iter().any(|existing| {
                                existing.get("scope").and_then(Value::as_str)
                                    == Some(scope.as_str())
                                    && existing.get("optionId").and_then(Value::as_str)
                                        == Some(option_id.as_str())
                            }) {
                                rules.push(rule);
                            }
                        } else {
                            thread["permissionRules"] = json!([rule]);
                        }
                    }
                    if let Some(pending) = thread
                        .get_mut("pendingPermissions")
                        .and_then(Value::as_array_mut)
                    {
                        pending.retain(|item| {
                            item.get("id").and_then(Value::as_str) != Some(request_id)
                                && item.get("requestId").and_then(Value::as_str) != Some(request_id)
                                && item.get("permissionId").and_then(Value::as_str)
                                    != Some(request_id)
                        });
                    }
                    let _ = AgentsHost::write_thread(root_path, &thread);
                    emit_host(app, "agents:threadUpdated", vec![thread]);
                }
            }
            Ok(Value::Null)
        }
        "agents:resolveUserInput" => {
            let input = args.first().ok_or("missing input")?;
            let request_id = input
                .get("requestId")
                .and_then(Value::as_str)
                .ok_or("missing requestId")?;
            let root_path = input.get("workspaceRootPath").and_then(Value::as_str);
            let thread_id = input.get("threadId").and_then(Value::as_str);
            let mut answer = json!({});
            if let Some(answers) = input.get("answers") {
                answer["answers"] = answers.clone();
            }
            if let Some(action) = input.get("action").and_then(Value::as_str) {
                answer["action"] = json!(action);
            }
            if let Some(content) = input.get("content") {
                answer["content"] = content.clone();
            }
            if let Some(text) = input.get("text").and_then(Value::as_str) {
                answer["text"] = json!(text);
            }
            if answer.as_object().map(|o| o.is_empty()).unwrap_or(true) {
                answer = json!({ "action": "cancel", "cancelled": true });
            }
            let provider_transport = root_path
                .zip(thread_id)
                .and_then(|(root_path, thread_id)| host.read_thread(root_path, thread_id))
                .and_then(|thread| {
                    thread
                        .get("providerTransport")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                });
            match provider_transport.as_deref() {
                Some("codex-app-server") => {
                    host.codex_supervisor
                        .resolve_user_input(request_id, answer)?;
                }
                Some("claude-sdk") => {
                    host.claude_supervisor
                        .resolve_user_input(request_id, answer)?;
                }
                _ => {
                    host.supervisor.resolve_user_input(request_id, answer)?;
                }
            }
            if let (Some(root_path), Some(thread_id)) = (root_path, thread_id) {
                if let Some(mut thread) = host.read_thread(root_path, thread_id) {
                    if let Some(pending) = thread
                        .get_mut("pendingUserInputs")
                        .and_then(Value::as_array_mut)
                    {
                        pending.retain(|item| {
                            item.get("id").and_then(Value::as_str) != Some(request_id)
                        });
                    }
                    let _ = AgentsHost::write_thread(root_path, &thread);
                    emit_host(app, "agents:threadUpdated", vec![thread]);
                }
            }
            Ok(Value::Null)
        }
        "agents:setSessionConfigOption" => {
            let input = args.first().ok_or("missing input")?;
            let root_path = input
                .get("workspaceRootPath")
                .and_then(Value::as_str)
                .ok_or("missing workspaceRootPath")?;
            let thread_id = input
                .get("threadId")
                .and_then(Value::as_str)
                .ok_or("missing threadId")?;
            let config_id = input
                .get("configId")
                .and_then(Value::as_str)
                .ok_or("missing configId")?;
            let value = input
                .get("value")
                .and_then(Value::as_str)
                .ok_or("missing value")?;
            let thread = host
                .read_thread(root_path, thread_id)
                .ok_or("thread_not_found")?;
            let provider_id = thread
                .get("acpProvider")
                .and_then(Value::as_str)
                .unwrap_or("cursor-acp");
            let session_id = thread
                .get("acpSessionId")
                .and_then(Value::as_str)
                .ok_or("missing_acp_session")?;
            let connection_key = format!("{provider_id}:{root_path}");
            let runtime = tokio::runtime::Handle::try_current()
                .map_err(|_| "no tokio runtime".to_string())?;
            runtime.block_on(host.supervisor.set_session_config_option(
                &connection_key,
                session_id,
                config_id,
                value,
            ))?;
            if let Some(mut thread) = host.read_thread(root_path, thread_id) {
                if let Some(options) = thread
                    .get_mut("configOptions")
                    .and_then(Value::as_array_mut)
                {
                    for option in options.iter_mut() {
                        if option.get("id").and_then(Value::as_str) == Some(config_id) {
                            option["currentValue"] = json!(value);
                        }
                    }
                }
                if config_id.eq_ignore_ascii_case("model") {
                    thread["model"] = json!(value);
                }
                let _ = AgentsHost::write_thread(root_path, &thread);
                emit_host(app, "agents:threadUpdated", vec![thread]);
            }
            Ok(Value::Null)
        }
        "agents:getAcpTrace" => {
            let provider_id = args
                .first()
                .and_then(|value| {
                    value.as_str().map(str::to_string).or_else(|| {
                        value
                            .get("providerId")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                })
                .unwrap_or_else(|| "cursor-acp".to_string());
            Ok(host.supervisor.export_trace(&provider_id))
        }
        "agents:getConnectionState" => {
            let provider_id = args
                .first()
                .and_then(|value| {
                    value.as_str().map(str::to_string).or_else(|| {
                        value
                            .get("providerId")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                })
                .unwrap_or_else(|| "cursor-acp".to_string());
            Ok(connection_ui_from_snapshot(
                &host.supervisor.connection_snapshot(&provider_id),
            ))
        }
        "agents:forceStopProvider" => {
            let input = args.first().cloned().unwrap_or(Value::Null);
            if let (Some(root_path), Some(thread_id)) = (
                input.get("workspaceRootPath").and_then(Value::as_str),
                input.get("threadId").and_then(Value::as_str),
            ) {
                let thread_key = format!("{root_path}::{thread_id}");
                let transport = host
                    .read_thread(root_path, thread_id)
                    .and_then(|thread| {
                        thread
                            .get("providerTransport")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    });
                match transport.as_deref() {
                    Some("codex-app-server") => {
                        host.codex_supervisor.force_stop(&thread_key);
                        return Ok(Value::Null);
                    }
                    Some("claude-sdk") => {
                        host.claude_supervisor.force_stop(&thread_key);
                        return Ok(Value::Null);
                    }
                    _ => {}
                }
            }
            let connection_key = input
                .as_str()
                .map(str::to_string)
                .or_else(|| {
                    input
                        .get("connectionKey")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .or_else(|| {
                    let provider = input
                        .get("providerId")
                        .and_then(Value::as_str)
                        .unwrap_or("cursor-acp");
                    let workspace = input
                        .get("workspaceRootPath")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    if workspace.is_empty() {
                        None
                    } else {
                        Some(format!("{provider}:{workspace}"))
                    }
                })
                .ok_or("missing connectionKey")?;
            host.supervisor.force_stop_connection(&connection_key)?;
            Ok(Value::Null)
        }
        "agents:listAcpSessions" => {
            let input = args.first().cloned().unwrap_or(Value::Null);
            let connection_key = input
                .as_str()
                .map(str::to_string)
                .or_else(|| {
                    input
                        .get("connectionKey")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .or_else(|| {
                    let provider = input
                        .get("providerId")
                        .and_then(Value::as_str)
                        .unwrap_or("cursor-acp");
                    let workspace = input
                        .get("workspaceRootPath")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    if workspace.is_empty() {
                        None
                    } else {
                        Some(format!("{provider}:{workspace}"))
                    }
                })
                .ok_or("missing connectionKey")?;
            let cwd = input.get("cwd").and_then(Value::as_str).map(PathBuf::from);
            let cursor = input
                .get("cursor")
                .and_then(Value::as_str)
                .map(str::to_string);
            let runtime = tokio::runtime::Handle::try_current()
                .map_err(|_| "ACP requires the shared Tokio runtime".to_string())?;
            runtime.block_on(host.supervisor.list_sessions(&connection_key, cwd, cursor))
        }
        "agents:authenticate" => {
            let input = args.first().cloned().unwrap_or(Value::Null);
            let connection_key = input
                .get("connectionKey")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| {
                    let provider = input
                        .get("providerId")
                        .and_then(Value::as_str)
                        .unwrap_or("cursor-acp");
                    let workspace = input
                        .get("workspaceRootPath")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    if workspace.is_empty() {
                        None
                    } else {
                        Some(format!("{provider}:{workspace}"))
                    }
                })
                .ok_or("missing connectionKey")?;
            let method_id = input
                .get("methodId")
                .and_then(Value::as_str)
                .map(str::to_string);
            let runtime = tokio::runtime::Handle::try_current()
                .map_err(|_| "ACP requires the shared Tokio runtime".to_string())?;
            let supervisor = host.supervisor.clone();
            // RPC runs on the Tokio runtime; block_on must leave the async context first.
            tokio::task::block_in_place(|| {
                runtime.block_on(supervisor.authenticate(&connection_key, method_id.as_deref()))
            })?;
            Ok(Value::Null)
        }
        "agents:closeAcpSession" => {
            let input = args.first().cloned().unwrap_or(Value::Null);
            let connection_key = connection_key_from_input(&input)?;
            let session_id = input
                .get("sessionId")
                .and_then(Value::as_str)
                .ok_or("missing sessionId")?;
            let runtime = tokio::runtime::Handle::try_current()
                .map_err(|_| "ACP requires the shared Tokio runtime".to_string())?;
            runtime.block_on(host.supervisor.close_session(&connection_key, session_id))?;
            Ok(Value::Null)
        }
        "agents:deleteAcpSession" => {
            let input = args.first().cloned().unwrap_or(Value::Null);
            let connection_key = connection_key_from_input(&input)?;
            let session_id = input
                .get("sessionId")
                .and_then(Value::as_str)
                .ok_or("missing sessionId")?;
            let runtime = tokio::runtime::Handle::try_current()
                .map_err(|_| "ACP requires the shared Tokio runtime".to_string())?;
            runtime.block_on(host.supervisor.delete_session(&connection_key, session_id))?;
            Ok(Value::Null)
        }
        "agents:logoutProvider" => {
            let input = args.first().cloned().unwrap_or(Value::Null);
            let connection_key = connection_key_from_input(&input)?;
            let runtime = tokio::runtime::Handle::try_current()
                .map_err(|_| "ACP requires the shared Tokio runtime".to_string())?;
            runtime.block_on(host.supervisor.logout(&connection_key))?;
            Ok(Value::Null)
        }
        _ => Err(format!("unknown agents channel: {channel}")),
    }
}

fn connection_key_from_input(input: &Value) -> Result<String, String> {
    input
        .as_str()
        .map(str::to_string)
        .or_else(|| {
            input
                .get("connectionKey")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .or_else(|| {
            let provider = input
                .get("providerId")
                .and_then(Value::as_str)
                .unwrap_or("cursor-acp");
            let workspace = input
                .get("workspaceRootPath")
                .and_then(Value::as_str)
                .unwrap_or("");
            if workspace.is_empty() {
                None
            } else {
                Some(format!("{provider}:{workspace}"))
            }
        })
        .ok_or_else(|| "missing connectionKey".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        cli_args, parse_cursor_models_output, ui_timeline_item, unavailable_acp_reason, AgentsHost,
    };
    use crate::host::acp::{TimelineItem, TimelineItemKind};
    use serde_json::{json, Value};
    use std::fs;

    #[test]
    fn ui_timeline_item_maps_tool_call_plan_usage() {
        let tool = ui_timeline_item(&TimelineItem {
            kind: TimelineItemKind::ToolCall,
            id: "evt-1".into(),
            session_id: "sess".into(),
            turn_id: None,
            payload: json!({
                "toolCallId": "tool-1",
                "title": "Read file",
                "status": "in_progress",
                "kind": "read",
                "rawOutput": {"ok": true},
            }),
        });
        assert_eq!(tool["kind"], "tool_call");
        assert_eq!(tool["toolCall"]["id"], "tool-1");
        assert_eq!(tool["toolCall"]["name"], "Read file");
        assert_eq!(tool["toolCall"]["status"], "running");
        assert!(tool.get("createdAt").and_then(Value::as_str).is_some());

        let plan = ui_timeline_item(&TimelineItem {
            kind: TimelineItemKind::Plan,
            id: "plan-evt".into(),
            session_id: "sess".into(),
            turn_id: None,
            payload: json!({
                "entries": [
                    { "content": "Step A", "status": "completed", "priority": "high" },
                    { "content": "Step B", "status": "in_progress", "priority": "medium" }
                ]
            }),
        });
        assert_eq!(plan["kind"], "plan");
        assert_eq!(plan["plan"]["entries"][0]["label"], "Step A");
        assert_eq!(plan["plan"]["entries"][0]["status"], "completed");
        assert_eq!(plan["plan"]["entries"][1]["status"], "in_progress");

        let usage = ui_timeline_item(&TimelineItem {
            kind: TimelineItemKind::Usage,
            id: "usage-evt".into(),
            session_id: "sess".into(),
            turn_id: None,
            payload: json!({ "used": 120, "size": 200000 }),
        });
        assert_eq!(usage["kind"], "usage");
        assert_eq!(usage["usage"]["used"], 120);
        assert_eq!(usage["usage"]["limit"], 200000);
        assert_eq!(usage["usage"]["unit"], "tokens");

        let permission = ui_timeline_item(&TimelineItem {
            kind: TimelineItemKind::Permission,
            id: "perm-1".into(),
            session_id: "sess".into(),
            turn_id: None,
            payload: json!({
                "id": "perm-1",
                "title": "Allow shell",
                "options": ["allow_once", "reject"],
                "createdAt": "2026-01-01T00:00:00Z",
            }),
        });
        assert_eq!(permission["kind"], "permission");
        assert_eq!(permission["permission"]["id"], "perm-1");
        assert_eq!(permission["permission"]["title"], "Allow shell");
    }

    #[test]
    fn migrates_legacy_store_to_index_and_thread_files() {
        let root = std::env::temp_dir().join(format!(
            "gharargah-agent-store-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let agents_dir = root.join(".gharargah").join("agents");
        fs::create_dir_all(&agents_dir).unwrap();
        fs::write(
            agents_dir.join("state.json"),
            serde_json::to_vec(&json!({
                "threads": [{
                    "id": "thread-1",
                    "title": "Migrated",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-02T00:00:00Z",
                    "status": "idle",
                    "messages": [{
                        "id": "message-1",
                        "role": "user",
                        "text": "hello",
                        "createdAt": "2026-01-01T00:00:00Z"
                    }]
                }]
            }))
            .unwrap(),
        )
        .unwrap();

        let root_path = root.to_string_lossy();
        let index = AgentsHost::read_index(&root_path);
        let summaries = index["threads"].as_array().unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0]["messageCount"], 1);
        assert_eq!(summaries[0]["latestUserMessageAt"], "2026-01-01T00:00:00Z");
        let migrated = AgentsHost::read_thread_value(&root_path, "thread-1").unwrap();
        assert_eq!(migrated["title"], "Migrated");
        assert_eq!(migrated["agentId"], "codex");
        assert_eq!(migrated["driverId"], "codex:app-server");
        assert!(agents_dir.join("index.json").exists());
        assert!(agents_dir.join("threads").join("thread-1.json").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn agent_catalog_exposes_cli_acp_and_native_drivers() {
        let catalog = AgentsHost::new().list_agents();
        let agents = catalog["agents"].as_array().unwrap();
        let ids = agents
            .iter()
            .map(|agent| agent["id"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            ids,
            vec![
                "codex",
                "claude",
                "opencode",
                "cursor",
                "cursor-acp",
                "grok"
            ]
        );
        for agent in agents {
            let id = agent["id"].as_str().unwrap();
            let drivers = agent["drivers"].as_array().unwrap();
            if id == "cursor-acp" {
                assert_eq!(agent["activeDriverId"], "cursor:acp");
                assert_eq!(drivers.len(), 1);
                assert_eq!(drivers[0]["id"], "cursor:acp");
                assert_eq!(drivers[0]["kind"], "acp");
            } else if id == "grok" {
                assert_eq!(agent["activeDriverId"], "grok:acp");
                assert_eq!(drivers.len(), 1);
                assert_eq!(drivers[0]["id"], "grok:acp");
                assert_eq!(drivers[0]["kind"], "acp");
            } else {
                if id == "codex" {
                    assert_eq!(agent["activeDriverId"], "codex:app-server");
                    assert!(
                        drivers.iter().any(|driver| {
                            driver["id"] == "codex:app-server" && driver["kind"] == "native"
                        }),
                        "missing native app-server driver for Codex"
                    );
                } else if id == "claude" {
                    assert_eq!(agent["activeDriverId"], "claude:sdk");
                    assert!(
                        drivers.iter().any(|driver| {
                            driver["id"] == "claude:sdk" && driver["kind"] == "native"
                        }),
                        "missing native Claude SDK driver"
                    );
                } else if id == "opencode" {
                    assert_eq!(agent["activeDriverId"], "opencode:acp");
                } else {
                    assert_eq!(agent["activeDriverId"], format!("{id}:cli"));
                }
                assert!(
                    drivers.iter().any(
                        |driver| driver["id"] == format!("{id}:cli") && driver["kind"] == "cli"
                    ),
                    "missing cli driver for {id}"
                );
                assert!(
                    drivers.iter().any(
                        |driver| driver["id"] == format!("{id}:acp") && driver["kind"] == "acp"
                    ),
                    "missing acp driver for {id}"
                );
            }
        }
    }

    #[test]
    fn native_provider_adapters_are_not_misreported_as_acp() {
        assert!(unavailable_acp_reason("codex")
            .is_some_and(|reason| reason.contains("codex app-server")));
        assert!(unavailable_acp_reason("claude")
            .is_some_and(|reason| reason.contains("Claude Agent SDK")));
        assert_eq!(unavailable_acp_reason("cursor"), None);
        assert_eq!(unavailable_acp_reason("opencode"), None);
    }

    #[test]
    fn cli_arguments_are_agent_specific() {
        assert_eq!(
            cli_args("codex", "hello").unwrap(),
            vec!["exec", "--color", "never", "hello"]
        );
        assert_eq!(
            cli_args("claude", "hello").unwrap(),
            vec!["-p", "hello", "--output-format", "text"]
        );
        assert_eq!(cli_args("opencode", "hello").unwrap(), vec!["run", "hello"]);
        assert_eq!(
            cli_args("cursor", "hello").unwrap(),
            vec!["-p", "--output-format", "text", "-f", "hello"]
        );
    }

    #[test]
    fn new_cursor_thread_defaults_to_cli_and_starts_idle() {
        let root = std::env::temp_dir().join(format!(
            "gharargah-agent-thread-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let root_path = root.to_string_lossy().to_string();
        let thread = AgentsHost::new()
            .create_thread(&json!({
                "workspaceRootUri": format!("file://{root_path}"),
                "workspaceRootPath": root_path,
                "agentId": "cursor",
            }))
            .unwrap();
        assert_eq!(thread["agentId"], "cursor");
        assert_eq!(thread["driverId"], "cursor:cli");
        assert_eq!(thread["status"], "idle");
        assert!(thread.get("provider").is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn legacy_cursor_acp_threads_move_to_cursor_acp_agent() {
        let thread = AgentsHost::normalize_thread(json!({
            "agentId": "cursor",
            "driverId": "cursor:acp",
            "acpSessionId": "sess-1",
        }));
        assert_eq!(thread["agentId"], "cursor-acp");
        assert_eq!(thread["driverId"], "cursor:acp");
        assert_eq!(thread["acpSessionId"], "sess-1");
    }

    #[test]
    fn new_cursor_acp_thread_defaults_to_acp_driver() {
        let root = std::env::temp_dir().join(format!(
            "gharargah-agent-thread-acp-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let root_path = root.to_string_lossy().to_string();
        let thread = AgentsHost::new()
            .create_thread(&json!({
                "workspaceRootUri": format!("file://{root_path}"),
                "workspaceRootPath": root_path,
                "agentId": "cursor-acp",
            }))
            .unwrap();
        assert_eq!(thread["agentId"], "cursor-acp");
        assert_eq!(thread["driverId"], "cursor:acp");
        assert_eq!(thread["status"], "idle");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn parses_cursor_models_cli_output() {
        let models = parse_cursor_models_output(
            "Available models\n\nauto - Auto (default)\ncomposer-2.5 - Composer 2.5\n",
        );
        assert_eq!(models.len(), 2);
        assert_eq!(models[0]["slug"], "auto");
        assert_eq!(models[0]["name"], "Auto");
        assert_eq!(models[1]["slug"], "composer-2.5");
        assert_eq!(models[1]["name"], "Composer 2.5");
    }
}
