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

    fn store_dir(root_path: &str) -> PathBuf {
        PathBuf::from(root_path).join(".jet").join("agents")
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
        Self::write_thread(&root_path, &thread)?;
        Ok(thread)
    }

    pub fn send_message(&self, app: &AppHandle, input: &Value) -> Result<Value, String> {
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
        let key = format!("{root_path}::{thread_id}");
        if let Some(prev) = self.active_turns.lock().unwrap().remove(&key) {
            *prev.stop.lock().unwrap() = true;
        }
        self.active_turns
            .lock()
            .unwrap()
            .insert(key, ActiveTurn { stop: stop.clone() });

        thread::spawn(move || {
            run_turn(app_bg, root_path, thread_id, assistant_id, text, stop);
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
        }
        Ok(self.read_thread(&root_path, thread_id))
    }

    pub fn set_archived(&self, app: &AppHandle, input: &Value) -> Result<Option<Value>, String> {
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

    pub fn update_settings(&self, app: &AppHandle, input: &Value) -> Result<Option<Value>, String> {
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
        if let Some(provider) = input.get("provider") {
            thread["provider"] = provider.clone();
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
        if run_cursor_turn(
            &app,
            &root_path,
            &thread_id,
            &assistant_id,
            &prompt,
            binary,
            &stop,
        )
        .is_ok()
        {
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
    app: &AppHandle,
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
    if let Some(messages) = thread.get_mut("messages").and_then(|v| v.as_array_mut()) {
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
    app: &AppHandle,
    channel: &str,
    args: &[Value],
) -> Result<Value, String> {
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
    use super::AgentsHost;
    use serde_json::json;
    use std::fs;

    #[test]
    fn migrates_legacy_store_to_index_and_thread_files() {
        let root = std::env::temp_dir().join(format!(
            "jet-agent-store-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let agents_dir = root.join(".jet").join("agents");
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
        assert_eq!(
            AgentsHost::read_thread_value(&root_path, "thread-1").unwrap()["title"],
            "Migrated"
        );
        assert!(agents_dir.join("index.json").exists());
        assert!(agents_dir.join("threads").join("thread-1.json").exists());

        let _ = fs::remove_dir_all(root);
    }
}
