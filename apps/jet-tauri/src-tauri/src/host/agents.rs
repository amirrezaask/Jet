use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::AppHandle;
use uuid::Uuid;

use super::events::emit_host;
use super::launch::uri_to_path;

struct ActiveTurn {
    stop: Arc<Mutex<bool>>,
}

pub struct AgentsHost {
    active_turns: Mutex<HashMap<String, ActiveTurn>>,
}

impl AgentsHost {
    pub fn new() -> Self {
        Self {
            active_turns: Mutex::new(HashMap::new()),
        }
    }

    fn store_path(root_path: &str) -> PathBuf {
        PathBuf::from(root_path).join(".jet").join("agents").join("state.json")
    }

    fn read_store(root_path: &str) -> Value {
        let path = Self::store_path(root_path);
        fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_else(|| json!({ "threads": [] }))
    }

    fn write_store(root_path: &str, payload: &Value) -> Result<(), String> {
        let path = Self::store_path(root_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(path, serde_json::to_string_pretty(payload).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    }

    fn now_iso() -> String {
        chrono::Utc::now().to_rfc3339()
    }

    fn summarize_threads(threads: &[Value]) -> Vec<Value> {
        let mut summaries: Vec<Value> = threads
            .iter()
            .filter_map(|thread| {
                let id = thread.get("id")?.as_str()?;
                Some(json!({
                    "id": id,
                    "title": thread.get("title").and_then(|v| v.as_str()).unwrap_or("Agent"),
                    "updatedAt": thread.get("updatedAt"),
                    "createdAt": thread.get("createdAt"),
                    "archivedAt": thread.get("archivedAt"),
                    "status": thread.get("status").and_then(|v| v.as_str()).unwrap_or("idle"),
                    "lastError": thread.get("lastError"),
                    "latestUserMessageAt": null,
                    "messageCount": thread.get("messages").and_then(|m| m.as_array()).map(|a| a.len()).unwrap_or(0),
                }))
            })
            .collect();
        summaries.sort_by(|a, b| {
            let au = a.get("updatedAt").and_then(|v| v.as_str()).unwrap_or("");
            let bu = b.get("updatedAt").and_then(|v| v.as_str()).unwrap_or("");
            bu.cmp(au)
        });
        summaries
    }

    pub fn list_threads(&self, workspace_root_uri: &str, workspace_root_path: &str) -> Value {
        let root_path = if workspace_root_path.is_empty() {
            uri_to_path(workspace_root_uri)
        } else {
            workspace_root_path.to_string()
        };
        let store = Self::read_store(&root_path);
        let threads = store
            .get("threads")
            .and_then(|v| v.as_array())
            .map(|a| a.as_slice())
            .unwrap_or(&[]);
        json!({
            "workspaceRootUri": workspace_root_uri,
            "workspaceRootPath": root_path,
            "threads": Self::summarize_threads(threads),
        })
    }

    pub fn read_thread(&self, root_path: &str, thread_id: &str) -> Option<Value> {
        let store = Self::read_store(root_path);
        store
            .get("threads")
            .and_then(|v| v.as_array())
            .and_then(|threads| threads.iter().find(|t| t.get("id").and_then(|v| v.as_str()) == Some(thread_id)).cloned())
    }

    pub fn create_thread(&self, input: &Value) -> Result<Value, String> {
        let root_uri = input.get("workspaceRootUri").and_then(|v| v.as_str()).ok_or("missing workspaceRootUri")?;
        let root_path = input
            .get("workspaceRootPath")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| uri_to_path(root_uri));
        let created = Self::now_iso();
        let thread = json!({
            "id": Uuid::new_v4().to_string(),
            "title": input.get("title").and_then(|v| v.as_str()).unwrap_or("New agent"),
            "workspaceRootUri": root_uri,
            "workspaceRootPath": root_path,
            "provider": input.get("provider").and_then(|v| v.as_str()).unwrap_or("cursor"),
            "model": input.get("model").and_then(|v| v.as_str()).unwrap_or("auto"),
            "createdAt": created,
            "updatedAt": created,
            "archivedAt": Value::Null,
            "status": "running",
            "lastError": Value::Null,
            "messages": [],
        });
        let mut store = Self::read_store(&root_path);
        let threads = store
            .get_mut("threads")
            .and_then(|v| v.as_array_mut())
            .ok_or("invalid store")?;
        threads.insert(0, thread.clone());
        Self::write_store(&root_path, &store)?;
        Ok(thread)
    }

    pub fn send_message(&self, app: &AppHandle, input: &Value) -> Result<Value, String> {
        let root_uri = input.get("workspaceRootUri").and_then(|v| v.as_str()).ok_or("missing workspaceRootUri")?;
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

        let mut store = Self::read_store(&root_path);
        let threads = store.get_mut("threads").and_then(|v| v.as_array_mut()).ok_or("invalid store")?;
        let index = threads
            .iter()
            .position(|t| t.get("id").and_then(|v| v.as_str()) == Some(thread_id.as_str()))
            .ok_or("unknown thread")?;
        let assistant_id = Uuid::new_v4().to_string();
        let now = Self::now_iso();
        let user_message = json!({
            "id": Uuid::new_v4().to_string(),
            "role": "user",
            "text": text,
            "createdAt": now,
        });
        let assistant_message = json!({
            "id": assistant_id,
            "role": "assistant",
            "text": "",
            "createdAt": now,
            "status": "streaming",
        });
        let mut thread = threads[index].clone();
        if let Some(messages) = thread.get_mut("messages").and_then(|v| v.as_array_mut()) {
            messages.push(user_message);
            messages.push(assistant_message);
        }
        thread["status"] = json!("running");
        thread["updatedAt"] = json!(now);
        threads[index] = thread.clone();
        Self::write_store(&root_path, &store)?;
        emit_host(app, "agents:threadUpdated", vec![thread.clone()]);

        let app_bg = app.clone();
        let stop = Arc::new(Mutex::new(false));
        let key = format!("{root_path}::{thread_id}");
        if let Some(prev) = self.active_turns.lock().unwrap().remove(&key) {
            *prev.stop.lock().unwrap() = true;
        }
        self.active_turns
            .lock()
            .unwrap()
            .insert(key, ActiveTurn { stop: stop.clone() });

        thread::spawn(move || {
            run_turn(
                app_bg,
                root_path,
                thread_id,
                assistant_id,
                text,
                stop,
            );
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
        let thread_id = input.get("threadId").and_then(|v| v.as_str()).ok_or("missing threadId")?;
        let key = format!("{root_path}::{thread_id}");
        if let Some(active) = self.active_turns.lock().unwrap().remove(&key) {
            *active.stop.lock().unwrap() = true;
        }
        Ok(self.read_thread(&root_path, thread_id))
    }

    pub fn set_archived(&self, app: &AppHandle, input: &Value) -> Result<Option<Value>, String> {
        let archived = input.get("archived").and_then(|v| v.as_bool()).unwrap_or(false);
        self.patch_thread(app, input, move |thread| {
            thread["archivedAt"] = if archived {
                json!(Self::now_iso())
            } else {
                Value::Null
            };
        })
    }

    pub fn update_settings(&self, app: &AppHandle, input: &Value) -> Result<Option<Value>, String> {
        let root_path = input
            .get("workspaceRootPath")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .ok_or("missing workspaceRootPath")?;
        let thread_id = input.get("threadId").and_then(|v| v.as_str()).ok_or("missing threadId")?;
        let mut store = Self::read_store(&root_path);
        let threads = store.get_mut("threads").and_then(|v| v.as_array_mut()).ok_or("invalid store")?;
        let index = threads
            .iter()
            .position(|t| t.get("id").and_then(|v| v.as_str()) == Some(thread_id));
        let Some(index) = index else {
            return Ok(None);
        };
        let mut thread = threads[index].clone();
        if let Some(provider) = input.get("provider") {
            thread["provider"] = provider.clone();
        }
        if let Some(model) = input.get("model") {
            thread["model"] = model.clone();
        }
        thread["updatedAt"] = json!(Self::now_iso());
        threads[index] = thread.clone();
        Self::write_store(&root_path, &store)?;
        emit_host(app, "agents:threadUpdated", vec![thread.clone()]);
        Ok(Some(thread))
    }

    fn patch_thread(
        &self,
        app: &AppHandle,
        input: &Value,
        mut patch: impl FnMut(&mut Value),
    ) -> Result<Option<Value>, String> {
        let root_path = input
            .get("workspaceRootPath")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .ok_or("missing workspaceRootPath")?;
        let thread_id = input.get("threadId").and_then(|v| v.as_str()).ok_or("missing threadId")?;
        let mut store = Self::read_store(&root_path);
        let threads = store.get_mut("threads").and_then(|v| v.as_array_mut()).ok_or("invalid store")?;
        let index = threads
            .iter()
            .position(|t| t.get("id").and_then(|v| v.as_str()) == Some(thread_id));
        let Some(index) = index else {
            return Ok(None);
        };
        let mut thread = threads[index].clone();
        patch(&mut thread);
        thread["updatedAt"] = json!(Self::now_iso());
        threads[index] = thread.clone();
        Self::write_store(&root_path, &store)?;
        emit_host(app, "agents:threadUpdated", vec![thread.clone()]);
        Ok(Some(thread))
    }

    pub fn list_providers(&self) -> Value {
        let providers = vec![
            provider_snapshot("cursor", "Cursor", &["cursor-agent", "agent"]),
            provider_snapshot("claudeAgent", "Claude", &["claude"]),
            provider_snapshot("codex", "Codex", &["codex"]),
        ];
        json!({
            "providers": providers,
            "updatedAt": Self::now_iso(),
        })
    }
}

fn provider_snapshot(instance_id: &str, display_name: &str, binaries: &[&str]) -> Value {
    let installed = binaries.iter().any(|b| which_binary(b));
    json!({
        "instanceId": instance_id,
        "driverKind": instance_id,
        "displayName": display_name,
        "enabled": installed,
        "status": if installed { "ready" } else { "unavailable" },
        "message": if installed { Value::Null } else { json!(format!("{display_name} CLI not found on PATH")) },
        "models": if installed {
            json!([{ "slug": "auto", "name": "Auto", "shortName": "Auto" }])
        } else {
            json!([])
        },
    })
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
    app: AppHandle,
    root_path: String,
    thread_id: String,
    assistant_id: String,
    prompt: String,
    stop: Arc<Mutex<bool>>,
) {
    let use_mock = std::env::var("JET_AGENT_MOCK").ok().as_deref() == Some("1");
    if use_mock {
        run_mock_turn(&app, &root_path, &thread_id, &assistant_id, &prompt, &stop);
        return;
    }
    if which_binary("cursor-agent") || which_binary("agent") {
        let binary = if which_binary("cursor-agent") {
            "cursor-agent"
        } else {
            "agent"
        };
        if run_cursor_turn(&app, &root_path, &thread_id, &assistant_id, &prompt, binary, &stop).is_ok() {
            return;
        }
    }
    run_mock_turn(&app, &root_path, &thread_id, &assistant_id, &prompt, &stop);
}

fn run_mock_turn(
    app: &AppHandle,
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
            update_assistant(app, root_path, thread_id, assistant_id, None, "error", Some("Turn interrupted"));
            return;
        }
        offset = (offset + chunk).min(full.len());
        let slice = &full[..offset];
        update_assistant(app, root_path, thread_id, assistant_id, Some(slice), "streaming", None);
        thread::sleep(std::time::Duration::from_millis(80));
    }
    if *stop.lock().unwrap() {
        update_assistant(app, root_path, thread_id, assistant_id, None, "error", Some("Turn interrupted"));
        return;
    }
    update_assistant(app, root_path, thread_id, assistant_id, None, "idle", None);
}

fn run_cursor_turn(
    app: &AppHandle,
    root_path: &str,
    thread_id: &str,
    assistant_id: &str,
    prompt: &str,
    binary: &str,
    stop: &Arc<Mutex<bool>>,
) -> Result<(), String> {
    let output = Command::new(binary)
        .args([
            "--print",
            "--output-format",
            "stream-json",
            "--stream-partial-output",
            "--model",
            "auto",
            "-f",
            prompt,
        ])
        .current_dir(root_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;
    if *stop.lock().unwrap() {
        update_assistant(app, root_path, thread_id, assistant_id, None, "error", Some("Turn interrupted"));
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
    update_assistant(app, root_path, thread_id, assistant_id, Some(&text), "idle", None);
    Ok(())
}

fn update_assistant(
    app: &AppHandle,
    root_path: &str,
    thread_id: &str,
    assistant_id: &str,
    text: Option<&str>,
    status: &str,
    error: Option<&str>,
) {
    let mut store = AgentsHost::read_store(root_path);
    let Some(threads) = store.get_mut("threads").and_then(|v| v.as_array_mut()) else {
        return;
    };
    let Some(index) = threads
        .iter()
        .position(|t| t.get("id").and_then(|v| v.as_str()) == Some(thread_id))
    else {
        return;
    };
    let mut thread = threads[index].clone();
    if let Some(messages) = thread.get_mut("messages").and_then(|v| v.as_array_mut()) {
        if let Some(msg) = messages.iter_mut().find(|m| {
            m.get("id").and_then(|v| v.as_str()) == Some(assistant_id)
        }) {
            if let Some(text) = text {
                msg["text"] = json!(text);
            }
            msg["status"] = json!(if status == "idle" { "complete" } else { status });
        }
    }
    thread["status"] = json!(status);
    thread["updatedAt"] = json!(AgentsHost::now_iso());
    if let Some(error) = error {
        thread["lastError"] = json!(error);
    } else if status == "idle" {
        thread["lastError"] = Value::Null;
    }
    threads[index] = thread.clone();
    let _ = AgentsHost::write_store(root_path, &store);
    emit_host(app, "agents:threadUpdated", vec![thread]);
}

pub fn handle(host: &AgentsHost, app: &AppHandle, channel: &str, args: &[Value]) -> Result<Value, String> {
    match channel {
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
                .unwrap_or_else(|| uri_to_path(args.first().and_then(|v| v.as_str()).unwrap_or("")));
            let thread_id = args.get(2).and_then(|v| v.as_str()).ok_or("missing threadId")?;
            Ok(host.read_thread(&root_path, thread_id).unwrap_or(Value::Null))
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
