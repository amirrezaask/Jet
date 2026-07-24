//! Agent orchestration characterization — freeze behavior before splitting `agents.rs`.

use jet_server::host::agents::{reset_write_thread_metrics, write_thread_metrics, AgentsHost};
use serde_json::json;
use tempfile::TempDir;

fn temp_workspace() -> (TempDir, String) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().to_string_lossy().to_string();
    (dir, path)
}

#[test]
fn create_thread_persists_runtime_and_interaction_modes() {
    let (_dir, root) = temp_workspace();
    let host = AgentsHost::new();
    let thread = host
        .create_thread(&json!({
            "workspaceRootUri": format!("file://{root}"),
            "workspaceRootPath": root,
            "agentId": "cursor",
            "runtimeMode": "auto-accept-edits",
            "interactionMode": "implement",
        }))
        .expect("create");
    assert_eq!(thread["runtimeMode"], "auto-accept-edits");
    assert_eq!(thread["interactionMode"], "implement");
    assert_eq!(thread["driverId"], "cursor:acp");
    let (writes, bytes) = write_thread_metrics();
    assert!(writes >= 1, "create must persist thread");
    assert!(bytes > 0);
}

#[test]
fn turn_already_running_rejects_second_prompt() {
    reset_write_thread_metrics();
    let (_dir, root) = temp_workspace();
    let host = AgentsHost::new();
    let thread = host
        .create_thread(&json!({
            "workspaceRootUri": format!("file://{root}"),
            "workspaceRootPath": root,
            "agentId": "cursor",
            "driverId": "cursor:cli",
        }))
        .expect("create");
    let thread_id = thread["id"].as_str().unwrap().to_string();
    let hub = jet_server::host::events::EventHub::new(64);

    std::env::set_var("GHARARGAH_AGENT_MOCK", "1");
    std::env::set_var("GHARARGAH_AGENT_MOCK_LEGACY", "1");
    let first = host.send_message(
        &hub,
        &json!({
            "workspaceRootUri": format!("file://{root}"),
            "workspaceRootPath": root,
            "threadId": thread_id,
            "text": "first",
        }),
    );
    let second = host.send_message(
        &hub,
        &json!({
            "workspaceRootUri": format!("file://{root}"),
            "workspaceRootPath": root,
            "threadId": thread_id,
            "text": "second",
        }),
    );
    std::env::remove_var("GHARARGAH_AGENT_MOCK");
    std::env::remove_var("GHARARGAH_AGENT_MOCK_LEGACY");

    if first.is_ok() {
        assert_eq!(
            second.err().as_deref(),
            Some("turn_already_running"),
            "second prompt must be rejected while first turn is active"
        );
    }
}

#[test]
fn write_thread_metrics_count_full_rewrites() {
    reset_write_thread_metrics();
    let (_dir, root) = temp_workspace();
    let host = AgentsHost::new();
    let thread = host
        .create_thread(&json!({
            "workspaceRootUri": format!("file://{root}"),
            "workspaceRootPath": root,
            "agentId": "opencode",
        }))
        .expect("create");
    let (after_create, _) = write_thread_metrics();
    assert!(after_create >= 1);
    let id = thread["id"].as_str().unwrap();
    let hub = jet_server::host::events::EventHub::new(64);
    let _ = host
        .update_settings(
            &hub,
            &json!({
                "workspaceRootUri": format!("file://{root}"),
                "workspaceRootPath": root,
                "threadId": id,
                "runtimeMode": "full-access",
            }),
        )
        .expect("update");
    let (after_update, bytes) = write_thread_metrics();
    assert!(after_update > after_create);
    assert!(bytes > 0);
}

#[test]
fn server_does_not_auto_title_from_first_prompt_on_create() {
    let (_dir, root) = temp_workspace();
    let host = AgentsHost::new();
    let thread = host
        .create_thread(&json!({
            "workspaceRootUri": format!("file://{root}"),
            "workspaceRootPath": root,
            "agentId": "claude",
        }))
        .expect("create");
    assert_eq!(thread["title"], "New agent");
}

#[test]
fn cursor_cli_driver_is_marked_degraded_in_catalog() {
    let catalog = AgentsHost::new().list_agents();
    let cursor = catalog["agents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|agent| agent["id"] == "cursor")
        .expect("cursor");
    let cli = cursor["drivers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|driver| driver["id"] == "cursor:cli")
        .expect("cli");
    assert_eq!(cli["degraded"], true);
}
