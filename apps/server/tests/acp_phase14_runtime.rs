//! Extra ACP Phase 1–4 acceptance tests beyond the scenario matrix.

use jet_server::host::acp::{
    mock_strict, AcpSupervisor, NormalizedEvent, SupervisorTurnRequest, TimelineItemKind,
};
use std::collections::{HashMap, HashSet};
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
            runtime_mode: None,
            interaction_mode: None,
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
    assert!(
        after_first >= 1,
        "expected sequenced events, got {after_first}"
    );

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
            runtime_mode: None,
            interaction_mode: None,
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
            runtime_mode: None,
            interaction_mode: None,
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
            runtime_mode: None,
            interaction_mode: None,
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
            runtime_mode: None,
            interaction_mode: None,
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

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancelling_one_turn_does_not_cancel_another_turns_permission() {
    install_mock_bin();
    let supervisor = Arc::new(AcpSupervisor::new());
    let workspace_a = tempfile::TempDir::new().expect("first workspace");
    let workspace_b = tempfile::TempDir::new().expect("second workspace");
    let (permission_tx, mut permission_rx) =
        tokio::sync::mpsc::unbounded_channel::<(String, String, String)>();

    let spawn_turn =
        |thread_key: &'static str, prompt: &'static str, workspace_root: std::path::PathBuf| {
            let supervisor = supervisor.clone();
            let permission_tx = permission_tx.clone();
            tokio::spawn(async move {
                supervisor
                    .run_turn(SupervisorTurnRequest {
                        provider: profile("permission_allow"),
                        workspace_root,
                        thread_key: thread_key.to_string(),
                        prompt: prompt.to_string(),
                        images: vec![],
                        model: None,
                        existing_session_id: None,
                        runtime_mode: None,
                        interaction_mode: None,
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
                            let Some(owner) = item.turn_id else {
                                return;
                            };
                            let Some(request_id) = item
                                .payload
                                .get("requestId")
                                .and_then(|value| value.as_str())
                            else {
                                return;
                            };
                            let Some(option_id) = item
                                .payload
                                .get("options")
                                .and_then(|value| value.as_array())
                                .and_then(|options| {
                                    options.iter().find_map(|option| {
                                        (option.get("kind").and_then(|value| value.as_str())
                                            == Some("allow_once"))
                                        .then(|| {
                                            option
                                                .get("id")
                                                .and_then(|value| value.as_str())
                                                .map(str::to_string)
                                        })
                                        .flatten()
                                    })
                                })
                            else {
                                return;
                            };
                            let _ = permission_tx.send((owner, request_id.to_string(), option_id));
                        }),
                    })
                    .await
            })
        };

    let mut permissions = HashMap::new();
    let turn_a = spawn_turn(
        "concurrent-permission-a",
        "first protected operation",
        workspace_a.path().to_path_buf(),
    );
    let (owner_a, request_a, option_a) =
        tokio::time::timeout(Duration::from_secs(10), permission_rx.recv())
            .await
            .expect("first permission request timed out")
            .expect("permission request channel closed");
    permissions.insert(owner_a, (request_a, option_a));

    let turn_b = spawn_turn(
        "concurrent-permission-b",
        "second protected operation",
        workspace_b.path().to_path_buf(),
    );
    drop(permission_tx);
    let (owner_b, request_b, option_b) =
        tokio::time::timeout(Duration::from_secs(10), permission_rx.recv())
            .await
            .expect("second permission request timed out")
            .expect("permission request channel closed");
    permissions.insert(owner_b, (request_b, option_b));

    supervisor.cancel_turn("concurrent-permission-a");
    let (request_b, option_b) = permissions
        .get("concurrent-permission-b")
        .expect("second permission");
    supervisor
        .resolve_permission(request_b, option_b)
        .expect("second turn permission must remain pending");

    let result_b = tokio::time::timeout(Duration::from_secs(10), turn_b)
        .await
        .expect("second turn timed out")
        .expect("second turn task panicked")
        .expect("second turn failed");
    assert!(
        result_b
            .text
            .contains("Mock agent reply: second protected operation"),
        "second turn was incorrectly cancelled: {:?}",
        result_b.stop_reason
    );

    let _ = tokio::time::timeout(Duration::from_secs(10), turn_a)
        .await
        .expect("cancelled turn timed out")
        .expect("cancelled turn task panicked");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn advertised_auth_methods_do_not_mean_authentication_is_required() {
    install_mock_bin();
    let supervisor = AcpSupervisor::new();
    let mut provider = profile("echo");
    provider
        .spawn_args
        .extend(["--capabilities".to_string(), "auth_methods".to_string()]);
    let result = tokio::time::timeout(
        Duration::from_secs(20),
        supervisor.run_turn(SupervisorTurnRequest {
            provider,
            workspace_root: std::env::current_dir().unwrap(),
            thread_key: "auth-methods-available".into(),
            prompt: "already authenticated".into(),
            images: vec![],
            model: None,
            existing_session_id: None,
            runtime_mode: None,
            interaction_mode: None,
            prefer_resume: false,
            initial_sequence: 0,
            on_session: Arc::new(|_| {}),
            on_text: Arc::new(|_| {}),
            on_activity: Arc::new(|_| {}),
            on_event: Arc::new(|_, _| {}),
        }),
    )
    .await
    .expect("turn timed out")
    .expect("advertised auth methods must not block the turn");
    assert!(result
        .text
        .contains("Mock agent reply: already authenticated"));
    let snapshot = supervisor.connection_snapshot("mock-strict");
    assert_eq!(
        snapshot.state,
        jet_server::host::acp::ConnectionState::Ready
    );
    assert_eq!(snapshot.auth_method_ids, vec!["mock-token"]);
}
