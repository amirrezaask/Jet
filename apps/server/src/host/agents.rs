use super::acp_client::{cursor_acp_agent, run_acp_turn, AcpTurnInput};
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
    acp_cancel: Option<watch::Sender<bool>>,
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
];

fn normalize_agent_id(id: &str) -> &str {
    match id {
        "claudeAgent" => "claude",
        other => other,
    }
}

fn agent_spec(id: &str) -> Option<AgentSpec> {
    let id = normalize_agent_id(id);
    AGENTS.iter().copied().find(|agent| agent.id == id)
}

pub struct AgentsHost {
    active_turns: Arc<Mutex<HashMap<String, ActiveTurn>>>,
}

impl AgentsHost {
    pub fn new() -> Self {
        Self {
            active_turns: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn default_driver_id(agent_id: &str) -> String {
        if normalize_agent_id(agent_id) == "cursor" {
            "cursor:acp".to_string()
        } else {
            format!("{}:cli", normalize_agent_id(agent_id))
        }
    }

    fn driver_supported(agent_id: &str, driver_id: &str) -> bool {
        driver_id == Self::default_driver_id(agent_id)
    }

    fn normalize_driver_id(agent_id: &str, driver_id: Option<&str>) -> String {
        match (normalize_agent_id(agent_id), driver_id) {
            ("cursor", None | Some("cursor:cli")) => "cursor:acp".to_string(),
            (_, Some(driver_id)) => driver_id.to_string(),
            (agent_id, None) => Self::default_driver_id(agent_id),
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
        let driver_id = thread.get("driverId").and_then(Value::as_str);
        if driver_id.is_none() || (agent_id == "cursor" && driver_id == Some("cursor:cli")) {
            thread["driverId"] = json!(Self::default_driver_id(&agent_id));
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
        let thread = json!({
            "id": Uuid::new_v4().to_string(),
            "title": input.get("title").and_then(|v| v.as_str()).unwrap_or("New agent"),
            "workspaceRootUri": root_uri,
            "workspaceRootPath": root_path,
            "agentId": agent.id,
            "driverId": driver_id,
            "model": input.get("model").and_then(|v| v.as_str()).unwrap_or("auto"),
            "createdAt": created,
            "updatedAt": created,
            "archivedAt": Value::Null,
            "status": "idle",
            "lastError": Value::Null,
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
        let (acp_cancel, acp_cancel_rx) = watch::channel(false);
        let turn_id = Uuid::new_v4();
        let key = format!("{root_path}::{thread_id}");
        if let Some(prev) = self.active_turns.lock().unwrap().remove(&key) {
            *prev.stop.lock().unwrap() = true;
            if let Some(cancel) = prev.acp_cancel {
                let _ = cancel.send(true);
            }
        }
        self.active_turns.lock().unwrap().insert(
            key.clone(),
            ActiveTurn {
                id: turn_id,
                stop: stop.clone(),
                acp_cancel: (driver_id == "cursor:acp").then_some(acp_cancel),
            },
        );

        let agent_id = agent.id.to_string();
        let active_turns = self.active_turns.clone();
        let acp_session_id = thread
            .get("acpSessionId")
            .and_then(Value::as_str)
            .map(str::to_string);
        thread::spawn(move || {
            run_turn(
                app_bg,
                root_path,
                thread_id,
                assistant_id,
                text,
                agent_id,
                driver_id,
                acp_session_id,
                acp_cancel_rx,
                stop,
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
            if let Some(cancel) = active.acp_cancel {
                let _ = cancel.send(true);
            }
        }
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
            if agent.id != "cursor" {
                thread["acpSessionId"] = Value::Null;
            }
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
            thread["driverId"] = json!(driver_id);
        }
        if let Some(model) = input.get("model") {
            thread["model"] = model.clone();
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
                    "models": if installed { json!([{ "slug": "auto", "name": "Auto", "shortName": "Auto" }]) } else { json!([]) },
                })
            })
            .collect::<Vec<_>>();
        json!({ "providers": providers, "updatedAt": Self::now_iso() })
    }

    pub fn stop_all(&self) {
        for (_, active) in self.active_turns.lock().unwrap().drain() {
            *active.stop.lock().unwrap() = true;
            if let Some(cancel) = active.acp_cancel {
                let _ = cancel.send(true);
            }
        }
    }
}

impl Default for AgentsHost {
    fn default() -> Self {
        Self::new()
    }
}

fn agent_snapshot(agent: &AgentSpec) -> Value {
    let installed = agent_available(agent);
    let driver_id = AgentsHost::default_driver_id(agent.id);
    let driver_kind = if agent.id == "cursor" { "acp" } else { "cli" };
    json!({
        "id": agent.id,
        "displayName": agent.display_name,
        "enabled": installed,
        "activeDriverId": driver_id,
        "drivers": [{
            "id": driver_id,
            "kind": driver_kind,
            "status": if installed { "ready" } else { "unavailable" },
            "message": if installed { Value::Null } else { json!(format!("{} CLI not found on PATH", agent.display_name)) },
        }],
        "models": if installed {
            json!([{ "slug": "auto", "name": "Auto", "shortName": "Auto" }])
        } else {
            json!([])
        },
    })
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
    acp_session_id: Option<String>,
    acp_cancel: watch::Receiver<bool>,
    stop: Arc<Mutex<bool>>,
) {
    let use_mock = std::env::var("GHARARGAH_AGENT_MOCK").ok().as_deref() == Some("1");
    if use_mock {
        run_mock_turn(&app, &root_path, &thread_id, &assistant_id, &prompt, &stop);
        return;
    }
    if driver_id == "cursor:acp" && agent_id == "cursor" {
        if let Err(error) = run_cursor_acp_turn(
            &app,
            &root_path,
            &thread_id,
            &assistant_id,
            &prompt,
            acp_session_id,
            acp_cancel,
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
        "cursor" => return None,
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

fn run_cursor_acp_turn(
    app: &EventHub,
    root_path: &str,
    thread_id: &str,
    assistant_id: &str,
    prompt: &str,
    existing_session_id: Option<String>,
    cancel: watch::Receiver<bool>,
) -> Result<(), String> {
    let binary = cursor_binary().ok_or("Cursor Agent CLI not found on PATH")?;
    let transport = cursor_acp_agent(binary)?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| error.to_string())?;
    let result = runtime.block_on(run_acp_turn(
        transport,
        AcpTurnInput {
            cwd: PathBuf::from(root_path),
            prompt: prompt.to_string(),
            existing_session_id,
        },
        cancel,
        {
            let app = app.clone();
            let root_path = root_path.to_string();
            let thread_id = thread_id.to_string();
            Arc::new(move |session_id| {
                persist_acp_session_id(&app, &root_path, &thread_id, session_id);
            })
        },
        {
            let app = app.clone();
            let root_path = root_path.to_string();
            let thread_id = thread_id.to_string();
            let assistant_id = assistant_id.to_string();
            Arc::new(move |text| {
                emit_assistant_delta(&app, &root_path, &thread_id, &assistant_id, text);
            })
        },
    ))?;
    if result.stop_reason == agent_client_protocol::schema::v1::StopReason::Cancelled {
        update_assistant(
            app,
            root_path,
            thread_id,
            assistant_id,
            Some(&result.text),
            "error",
            Some("Turn interrupted"),
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
            "status": "streaming",
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
        _ => Err(format!("unknown agents channel: {channel}")),
    }
}

#[cfg(test)]
mod tests {
    use super::{cli_args, AgentsHost};
    use serde_json::json;
    use std::fs;

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
        assert_eq!(migrated["driverId"], "codex:cli");
        assert!(agents_dir.join("index.json").exists());
        assert!(agents_dir.join("threads").join("thread-1.json").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn agent_catalog_separates_agents_from_cli_drivers() {
        let catalog = AgentsHost::new().list_agents();
        let agents = catalog["agents"].as_array().unwrap();
        let ids = agents
            .iter()
            .map(|agent| agent["id"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["codex", "claude", "opencode", "cursor"]);
        for agent in agents {
            let id = agent["id"].as_str().unwrap();
            let expected_driver = if id == "cursor" {
                "cursor:acp".to_string()
            } else {
                format!("{id}:cli")
            };
            assert_eq!(agent["activeDriverId"], expected_driver);
            assert_eq!(agent["drivers"][0]["id"], expected_driver);
            assert_eq!(
                agent["drivers"][0]["kind"],
                if id == "cursor" { "acp" } else { "cli" }
            );
        }
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
        assert_eq!(cli_args("cursor", "hello"), None);
    }

    #[test]
    fn new_cursor_thread_defaults_to_acp_and_starts_idle() {
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
        assert_eq!(thread["driverId"], "cursor:acp");
        assert_eq!(thread["status"], "idle");
        assert!(thread.get("provider").is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn legacy_cursor_cli_threads_migrate_to_acp() {
        let thread = AgentsHost::normalize_thread(json!({
            "agentId": "cursor",
            "driverId": "cursor:cli",
        }));
        assert_eq!(thread["driverId"], "cursor:acp");
    }
}
