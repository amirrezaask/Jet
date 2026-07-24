use jet_server::host::acp::{
    mock_strict, AcpSupervisor, NormalizedEvent, SupervisorTurnRequest, TimelineItemKind,
};
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn mock_profile(scenario: &str) -> jet_server::host::acp::ProviderProfile {
    let binary = std::env::var("CARGO_BIN_EXE_gharargah-mock-acp")
        .expect("Cargo must provide the mock ACP binary path");
    std::env::set_var("GHARARGAH_MOCK_ACP_BIN", &binary);
    let mut profile = mock_strict();
    profile.spawn_args = vec![
        "--scenario".to_string(),
        scenario.to_string(),
        "--strict".to_string(),
    ];
    profile
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn mock_acp_echo_streams_the_prompt_response() {
    let supervisor = AcpSupervisor::new();
    let texts = Arc::new(Mutex::new(Vec::<String>::new()));
    let texts_cb = texts.clone();
    let result = tokio::time::timeout(
        Duration::from_secs(20),
        supervisor.run_turn(SupervisorTurnRequest {
            provider: mock_profile("echo"),
            workspace_root: std::env::current_dir().expect("cwd"),
            thread_key: "echo-thread".to_string(),
            prompt: "hello from integration test".to_string(),
            images: vec![],
            model: None,
            existing_session_id: None,
            runtime_mode: None,
            interaction_mode: None,
            prefer_resume: false,
            initial_sequence: 0,
            on_session: Arc::new(|_| {}),
            on_text: Arc::new(move |text| {
                texts_cb.lock().unwrap().push(text.to_string());
            }),
            on_activity: Arc::new(|_| {}),
            on_event: Arc::new(|_, _| {}),
        }),
    )
    .await
    .expect("turn timed out")
    .expect("turn failed");
    assert!(result.text.contains("Mock agent reply: hello from integration test"));
    assert!(!texts.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn mock_acp_permission_tool_race_keeps_the_tool_update() {
    let supervisor = Arc::new(AcpSupervisor::new());
    let activity = Arc::new(Mutex::new(Vec::<String>::new()));
    let activity_cb = activity.clone();
    let supervisor_cb = supervisor.clone();
    let result = tokio::time::timeout(
        Duration::from_secs(20),
        supervisor.run_turn(SupervisorTurnRequest {
            provider: mock_profile("permission_tool_race"),
            workspace_root: std::env::current_dir().expect("cwd"),
            thread_key: "perm-race".to_string(),
            prompt: "approve this".to_string(),
            images: vec![],
            model: None,
            existing_session_id: None,
            runtime_mode: None,
            interaction_mode: None,
            prefer_resume: false,
            initial_sequence: 0,
            on_session: Arc::new(|_| {}),
            on_text: Arc::new(|_| {}),
            on_activity: Arc::new(move |label| {
                activity_cb.lock().unwrap().push(label.to_string());
            }),
            on_event: Arc::new(move |_, event| {
                let NormalizedEvent::Timeline(item) = event else {
                    return;
                };
                if item.kind != TimelineItemKind::Permission {
                    return;
                }
                let id = item
                    .payload
                    .get("id")
                    .or_else(|| item.payload.get("requestId"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                let option_id = item
                    .payload
                    .get("options")
                    .and_then(|value| value.as_array())
                    .and_then(|options| options.first())
                    .and_then(|option| option.get("id").and_then(|value| value.as_str()))
                    .unwrap_or("allow_once");
                let _ = supervisor_cb.resolve_permission(id, option_id);
            }),
        }),
    )
    .await
    .expect("turn timed out")
    .expect("turn failed");
    assert!(result.text.contains("Mock agent reply: approve this"));
    assert!(
        activity
            .lock()
            .unwrap()
            .iter()
            .any(|label| label.contains("Tool") || label.contains("InProgress")),
        "tool update alongside permission was not observed"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn mock_acp_cancel_coop_returns_cancelled() {
    let supervisor = Arc::new(AcpSupervisor::new());
    let thread_key = "cancel-coop".to_string();
    let supervisor_cb = supervisor.clone();
    let thread_key_cb = thread_key.clone();
    let turn = tokio::spawn(async move {
        supervisor_cb
            .run_turn(SupervisorTurnRequest {
                provider: mock_profile("cancel_coop"),
                workspace_root: std::env::current_dir().expect("cwd"),
                thread_key: thread_key_cb,
                prompt: "please cancel".to_string(),
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
            })
            .await
    });
    tokio::time::sleep(Duration::from_millis(300)).await;
    supervisor.cancel_turn(&thread_key);
    let result = tokio::time::timeout(Duration::from_secs(20), turn)
        .await
        .expect("join timed out")
        .expect("join failed")
        .expect("turn failed");
    assert!(result.cancelled, "expected cancelled turn");
}
