//! Extra ACP Phase 1–4 acceptance tests beyond the scenario matrix.

use jet_server::host::acp::{
    mock_strict, AcpSupervisor, NormalizedEvent, SupervisorTurnRequest, TimelineItemKind,
};
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn install_mock_bin() {
    let binary = std::env::var("CARGO_BIN_EXE_gharargah-mock-acp")
        .expect("Cargo must provide the mock ACP binary path");
    std::env::set_var("GHARARGAH_MOCK_ACP_BIN", binary);
}

fn profile(scenario: &str) -> jet_server::host::acp::ProviderProfile {
    let mut profile = mock_strict();
    profile.spawn_args = vec![
        "--scenario".to_string(),
        scenario.to_string(),
        "--strict".to_string(),
    ];
    profile
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sequence_continues_across_turns() {
    install_mock_bin();
    let supervisor = AcpSupervisor::new();
    let max_seq = Arc::new(AtomicU64::new(0));
    let max_a = max_seq.clone();
    let first = tokio::time::timeout(
        Duration::from_secs(20),
        supervisor.run_turn(SupervisorTurnRequest {
            provider: profile("echo"),
            workspace_root: std::env::current_dir().unwrap(),
            thread_key: "seq-1".into(),
            prompt: "one".into(),
            images: vec![],
            model: None,
            existing_session_id: None,
            prefer_resume: false,
            initial_sequence: 0,
            on_session: Arc::new(|_| {}),
            on_text: Arc::new(|_| {}),
            on_activity: Arc::new(|_| {}),
            on_event: Arc::new(move |seq, _| {
                max_a.fetch_max(seq, Ordering::AcqRel);
            }),
        }),
    )
    .await
    .expect("timeout")
    .expect("first turn");
    assert!(!first.cancelled);
    let after_first = max_seq.load(Ordering::Acquire);
    assert!(after_first >= 1, "expected sequenced events, got {after_first}");

    let max_b = max_seq.clone();
    let _second = tokio::time::timeout(
        Duration::from_secs(20),
        supervisor.run_turn(SupervisorTurnRequest {
            provider: profile("echo"),
            workspace_root: std::env::current_dir().unwrap(),
            thread_key: "seq-2".into(),
            prompt: "two".into(),
            images: vec![],
            model: None,
            existing_session_id: None,
            prefer_resume: false,
            initial_sequence: after_first,
            on_session: Arc::new(|_| {}),
            on_text: Arc::new(|_| {}),
            on_activity: Arc::new(|_| {}),
            on_event: Arc::new(move |seq, _| {
                max_b.fetch_max(seq, Ordering::AcqRel);
            }),
        }),
    )
    .await
    .expect("timeout")
    .expect("second turn");
    let after_second = max_seq.load(Ordering::Acquire);
    assert!(
        after_second > after_first,
        "sequence must continue across turns ({after_first} -> {after_second})"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn force_stop_bumps_generation_and_stops_worker() {
    install_mock_bin();
    let supervisor = AcpSupervisor::new();
    let cwd = std::env::current_dir().unwrap();
    let connection_key = format!("mock-strict:{}", cwd.display());
    let _ = tokio::time::timeout(
        Duration::from_secs(20),
        supervisor.run_turn(SupervisorTurnRequest {
            provider: profile("echo"),
            workspace_root: cwd.clone(),
            thread_key: "force-stop-1".into(),
            prompt: "ping".into(),
            images: vec![],
            model: None,
            existing_session_id: None,
            prefer_resume: false,
            initial_sequence: 0,
            on_session: Arc::new(|_| {}),
            on_text: Arc::new(|_| {}),
            on_activity: Arc::new(|_| {}),
            on_event: Arc::new(|_, _| {}),
        }),
    )
    .await
    .expect("timeout")
    .expect("turn");
    supervisor
        .force_stop_connection(&connection_key)
        .expect("force stop");
    let snapshot = supervisor.connection_snapshot("mock-strict");
    assert!(
        matches!(
            snapshot.state,
            jet_server::host::acp::ConnectionState::Stopped
        ),
        "expected Stopped, got {:?}",
        snapshot.state
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn session_restore_unsupported_when_no_load_or_resume() {
    install_mock_bin();
    let supervisor = AcpSupervisor::new();
    let result = tokio::time::timeout(
        Duration::from_secs(20),
        supervisor.run_turn(SupervisorTurnRequest {
            provider: profile("echo"),
            workspace_root: std::env::current_dir().unwrap(),
            thread_key: "restore-fail".into(),
            prompt: "x".into(),
            images: vec![],
            model: None,
            existing_session_id: Some("missing-session".into()),
            prefer_resume: false,
            initial_sequence: 0,
            on_session: Arc::new(|_| {}),
            on_text: Arc::new(|_| {}),
            on_activity: Arc::new(|_| {}),
            on_event: Arc::new(|_, _| {}),
        }),
    )
    .await
    .expect("timeout");
    let err = match result {
        Ok(_) => panic!("must not silently create a new session"),
        Err(error) => error,
    };
    assert!(
        err.contains("session_restore_unsupported") || err.contains("session_load_failed"),
        "unexpected error: {err}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn permission_options_preserve_provider_ids() {
    install_mock_bin();
    let supervisor = Arc::new(AcpSupervisor::new());
    let supervisor_cb = supervisor.clone();
    let option_ids = Arc::new(Mutex::new(HashSet::<String>::new()));
    let option_ids_cb = option_ids.clone();
    let result = tokio::time::timeout(
        Duration::from_secs(20),
        supervisor.run_turn(SupervisorTurnRequest {
            provider: profile("permission_allow"),
            workspace_root: std::env::current_dir().unwrap(),
            thread_key: "perm-ids".into(),
            prompt: "approve".into(),
            images: vec![],
            model: None,
            existing_session_id: None,
            prefer_resume: false,
            initial_sequence: 0,
            on_session: Arc::new(|_| {}),
            on_text: Arc::new(|_| {}),
            on_activity: Arc::new(|_| {}),
            on_event: Arc::new(move |_, event| {
                let NormalizedEvent::Timeline(item) = event else {
                    return;
                };
                if item.kind != TimelineItemKind::Permission {
                    return;
                }
                if let Some(options) = item.payload.get("options").and_then(|v| v.as_array()) {
                    for option in options {
                        if let Some(id) = option.get("id").and_then(|v| v.as_str()) {
                            option_ids_cb.lock().unwrap().insert(id.to_string());
                        }
                    }
                }
                let id = item
                    .payload
                    .get("id")
                    .and_then(|v| v.as_str())
                    .expect("permission id");
                let option_id = item
                    .payload
                    .get("options")
                    .and_then(|v| v.as_array())
                    .and_then(|options| options.first())
                    .and_then(|option| option.get("id").and_then(|v| v.as_str()))
                    .expect("option id");
                supervisor_cb
                    .resolve_permission(id, option_id)
                    .expect("resolve");
            }),
        }),
    )
    .await
    .expect("timeout")
    .expect("permission turn");
    assert!(result.text.contains("Mock agent reply: approve"));
    let ids = option_ids.lock().unwrap().clone();
    assert!(
        ids.contains("allow_once"),
        "expected provider option ids preserved, got {ids:?}"
    );
}
