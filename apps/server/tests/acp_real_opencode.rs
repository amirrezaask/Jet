//! Opt-in real OpenCode ACP smoke (`GHARARGAH_ACP_REAL_OPENCODE=1`).
//!
//! Requires `opencode` on PATH and an authenticated provider configured in OpenCode.

use jet_server::host::acp::{opencode_acp, AcpSupervisor, SupervisorTurnRequest};
use std::env;
use std::sync::Arc;
use std::time::Duration;

fn enabled() -> bool {
    matches!(
        env::var("GHARARGAH_ACP_REAL_OPENCODE").as_deref(),
        Ok("1") | Ok("true") | Ok("yes")
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_opencode_acp_initialize_and_prompt() {
    if !enabled() {
        eprintln!("skip: set GHARARGAH_ACP_REAL_OPENCODE=1 to run");
        return;
    }
    let mut profile = opencode_acp();
    let executable = profile
        .resolve_executable()
        .unwrap_or_else(|error| panic!("OpenCode ACP unavailable: {error}"));
    eprintln!("using opencode binary {}", executable.display());
    profile.executable = Box::leak(executable.to_string_lossy().into_owned().into_boxed_str());

    let workspace = tempfile::TempDir::new().expect("temp workspace");
    std::fs::write(workspace.path().join("README.md"), "# ACP smoke\n").expect("fixture");

    let supervisor = AcpSupervisor::new();
    let result = tokio::time::timeout(
        Duration::from_secs(180),
        supervisor.run_turn(SupervisorTurnRequest {
            provider: profile,
            workspace_root: workspace.path().to_path_buf(),
            thread_key: format!("real-opencode::{}", std::process::id()),
            prompt: "Reply with exactly: gharargah-opencode-acp-ok".to_string(),
            images: Vec::new(),
            model: None,
            existing_session_id: None,
            runtime_mode: Some("approval-required".into()),
            interaction_mode: Some("ask".into()),
            prefer_resume: false,
            initial_sequence: 0,
            on_session: Arc::new(|_| {}),
            on_text: Arc::new(|_| {}),
            on_activity: Arc::new(|_| {}),
            on_event: Arc::new(|_, _| {}),
        }),
    )
    .await
    .expect("OpenCode ACP timed out")
    .expect("OpenCode ACP turn failed");

    assert!(!result.session_id.is_empty(), "expected ACP session id");
    assert!(
        result
            .text
            .to_lowercase()
            .contains("gharargah-opencode-acp-ok")
            || !result.text.trim().is_empty(),
        "expected non-empty OpenCode reply, got: {}",
        result.text
    );
}
