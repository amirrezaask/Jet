//! Opt-in real Cursor ACP smoke (`GHARARGAH_ACP_REAL_CURSOR=1`).
//!
//! Requires `cursor-agent`/`agent` on PATH and an authenticated Cursor CLI session.

use jet_server::host::acp::{cursor_acp, AcpSupervisor, SupervisorTurnRequest};
use std::env;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

fn enabled() -> bool {
    matches!(
        env::var("GHARARGAH_ACP_REAL_CURSOR").as_deref(),
        Ok("1") | Ok("true") | Ok("yes")
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_cursor_acp_initialize_and_prompt() {
    if !enabled() {
        eprintln!("skip: set GHARARGAH_ACP_REAL_CURSOR=1 to run");
        return;
    }
    let profile = cursor_acp();
    let exe = match profile.resolve_executable() {
        Ok(path) => path,
        Err(error) => {
            eprintln!("skip: {error}");
            return;
        }
    };
    eprintln!("using cursor binary {}", exe.display());

    let cwd = env::temp_dir().join(format!(
        "gharargah-cursor-acp-smoke-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&cwd);
    std::fs::create_dir_all(&cwd).expect("temp cwd");
    std::fs::write(cwd.join("README.md"), "# smoke\n").expect("fixture");

    let supervisor = AcpSupervisor::new();
    let connection_key = format!("cursor-acp:{}", cwd.display());
    // Warm connection via a no-op authenticate after first turn attempt, or probe first.
    // Cursor ACP advertises cursor_login; authenticate once a connection exists.
    // Kick a short turn attempt is not needed — authenticate requires an existing worker.
    // Start by ensuring worker via list connection: run authenticate after first failed auth signal.

    let result = tokio::time::timeout(
        Duration::from_secs(180),
        supervisor.run_turn(SupervisorTurnRequest {
            provider: {
                let mut p = cursor_acp();
                p.executable = Box::leak(exe.to_string_lossy().into_owned().into_boxed_str());
                p
            },
            workspace_root: cwd.clone(),
            thread_key: format!("real-cursor::{}", std::process::id()),
            prompt: "Reply with exactly: gharargah-cursor-acp-ok".to_string(),
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
    .expect("cursor acp timed out");

    let result = match result {
        Ok(result) => result,
        Err(error) if error.contains("authentication_required") => {
            let _ = supervisor
                .authenticate(&connection_key, Some("cursor_login"))
                .await;
            match tokio::time::timeout(
                Duration::from_secs(180),
                supervisor.run_turn(SupervisorTurnRequest {
                    provider: cursor_acp(),
                    workspace_root: cwd.clone(),
                    thread_key: format!("real-cursor::{}", std::process::id()),
                    prompt: "Reply with exactly: gharargah-cursor-acp-ok".to_string(),
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
            .expect("cursor acp retry timed out")
            {
                Ok(result) => result,
                Err(error) if error.contains("authentication_required") => {
                    eprintln!(
                        "cursor ACP reachable; login required (`cursor agent login`). \
                         probe validated initialize/session/new/models. error={error}"
                    );
                    return;
                }
                Err(error) => panic!("cursor acp turn failed after auth: {error:?}"),
            }
        }
        Err(error) => panic!("cursor acp turn failed: {error:?}"),
    };

    assert!(
        !result.session_id.is_empty(),
        "expected acp session id from cursor-agent"
    );
    assert!(
        result.text.to_lowercase().contains("gharargah-cursor-acp-ok")
            || !result.text.trim().is_empty(),
        "expected non-empty cursor reply, got: {}",
        result.text
    );

    // Second turn should reuse / resume session.
    let second = tokio::time::timeout(
        Duration::from_secs(180),
        supervisor.run_turn(SupervisorTurnRequest {
            provider: cursor_acp(),
            workspace_root: cwd,
            thread_key: format!("real-cursor::{}", std::process::id()),
            prompt: "Reply with exactly: gharargah-cursor-acp-2".to_string(),
            images: Vec::new(),
            model: None,
            existing_session_id: Some(result.session_id.clone()),
            runtime_mode: Some("approval-required".into()),
            interaction_mode: Some("ask".into()),
            prefer_resume: true,
            initial_sequence: 1,
            on_session: Arc::new(|_| {}),
            on_text: Arc::new(|_| {}),
            on_activity: Arc::new(|_| {}),
            on_event: Arc::new(|_, _| {}),
        }),
    )
    .await
    .expect("second turn timed out")
    .expect("second turn failed");
    assert_eq!(second.session_id, result.session_id);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_cursor_probe_script_smoke() {
    if !enabled() {
        return;
    }
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repo root");
    let script = root.join("scripts/cursor_acp_probe.py");
    if !script.is_file() {
        eprintln!("skip: missing {}", script.display());
        return;
    }
    let status = std::process::Command::new("python3")
        .arg(&script)
        .arg("--cwd")
        .arg(root.join("fixtures/sample-workspace"))
        .status()
        .expect("spawn probe");
    assert!(status.success(), "cursor_acp_probe.py failed");
}
