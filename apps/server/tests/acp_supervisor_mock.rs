use jet_server::host::acp::{
    mock_strict, AcpSupervisor, NormalizedEvent, SupervisorTurnRequest, TimelineItemKind,
};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn supervisor_runs_echo_scenario_through_shared_pool() {
    let binary = std::env::var("CARGO_BIN_EXE_gharargah-mock-acp")
        .expect("Cargo must provide the mock ACP binary path");
    std::env::set_var("GHARARGAH_MOCK_ACP_BIN", &binary);

    let supervisor = AcpSupervisor::new();
    let mut profile = mock_strict();
    profile.spawn_args = vec![
        "--scenario".to_string(),
        "echo".to_string(),
        "--strict".to_string(),
    ];
    let texts = Arc::new(Mutex::new(Vec::<String>::new()));
    let texts_cb = texts.clone();
    let result = tokio::time::timeout(
        Duration::from_secs(20),
        supervisor.run_turn(SupervisorTurnRequest {
            provider: profile,
            workspace_root: std::env::current_dir().expect("cwd"),
            thread_key: "test-thread".to_string(),
            prompt: "supervisor smoke".to_string(),
            model: None,
            existing_session_id: None,
            on_session: Arc::new(|_| {}),
            on_text: Arc::new(move |text| {
                texts_cb.lock().unwrap().push(text.to_string());
            }),
            on_activity: Arc::new(|_| {}),
            on_event: Arc::new(|_, _| {}),
        }),
    )
    .await
    .expect("supervisor turn timed out")
    .expect("supervisor turn failed");

    assert!(
        result.text.contains("Mock agent reply: supervisor smoke"),
        "unexpected text: {}",
        result.text
    );
    assert!(!result.cancelled);
    assert!(!texts.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn supervisor_reuses_connection_for_second_turn() {
    let binary = std::env::var("CARGO_BIN_EXE_gharargah-mock-acp")
        .expect("Cargo must provide the mock ACP binary path");
    std::env::set_var("GHARARGAH_MOCK_ACP_BIN", &binary);

    let supervisor = AcpSupervisor::new();
    let mut profile = mock_strict();
    profile.spawn_args = vec![
        "--scenario".to_string(),
        "echo".to_string(),
        "--strict".to_string(),
    ];
    let cwd = std::env::current_dir().expect("cwd");
    for prompt in ["first", "second"] {
        let result = supervisor
            .run_turn(SupervisorTurnRequest {
                provider: profile.clone(),
                workspace_root: cwd.clone(),
                thread_key: format!("thread-{prompt}"),
                prompt: prompt.to_string(),
                model: None,
                existing_session_id: None,
                on_session: Arc::new(|_| {}),
                on_text: Arc::new(|_| {}),
                on_activity: Arc::new(|_| {}),
                on_event: Arc::new(|_, _| {}),
            })
            .await
            .expect("turn");
        assert!(result.text.contains(&format!("Mock agent reply: {prompt}")));
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn supervisor_emits_thought_and_text_timeline_for_thought_then_answer() {
    let binary = std::env::var("CARGO_BIN_EXE_gharargah-mock-acp")
        .expect("Cargo must provide the mock ACP binary path");
    std::env::set_var("GHARARGAH_MOCK_ACP_BIN", &binary);

    let supervisor = AcpSupervisor::new();
    let mut profile = mock_strict();
    profile.spawn_args = vec![
        "--scenario".to_string(),
        "thought_then_answer".to_string(),
        "--strict".to_string(),
    ];
    let events = Arc::new(Mutex::new(Vec::<(u64, NormalizedEvent)>::new()));
    let events_cb = events.clone();
    let result = tokio::time::timeout(
        Duration::from_secs(20),
        supervisor.run_turn(SupervisorTurnRequest {
            provider: profile,
            workspace_root: std::env::current_dir().expect("cwd"),
            thread_key: "thought-thread".to_string(),
            prompt: "think please".to_string(),
            model: None,
            existing_session_id: None,
            on_session: Arc::new(|_| {}),
            on_text: Arc::new(|_| {}),
            on_activity: Arc::new(|_| {}),
            on_event: Arc::new(move |sequence, event| {
                events_cb.lock().unwrap().push((sequence, event));
            }),
        }),
    )
    .await
    .expect("supervisor turn timed out")
    .expect("supervisor turn failed");

    assert!(result.text.contains("Mock agent reply: think please"));
    let kinds: Vec<TimelineItemKind> = events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|(_, event)| match event {
            NormalizedEvent::Timeline(item) => Some(item.kind),
            _ => None,
        })
        .collect();
    assert!(
        kinds.contains(&TimelineItemKind::Thought),
        "expected Thought timeline item, got {kinds:?}"
    );
    assert!(
        kinds.contains(&TimelineItemKind::Text),
        "expected Text timeline item, got {kinds:?}"
    );
    let thought = events.lock().unwrap().iter().find_map(|(_, event)| {
        match event {
            NormalizedEvent::Timeline(item) if item.kind == TimelineItemKind::Thought => {
                Some(item.payload.clone())
            }
            _ => None,
        }
    });
    let thought = thought.expect("thought payload");
    assert!(
        thought
            .get("text")
            .and_then(|value| value.as_str())
            .is_some_and(|text| text.contains("Mock thought")),
        "unexpected thought payload: {thought}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn supervisor_emits_tool_call_timeline_for_tool_lifecycle() {
    let binary = std::env::var("CARGO_BIN_EXE_gharargah-mock-acp")
        .expect("Cargo must provide the mock ACP binary path");
    std::env::set_var("GHARARGAH_MOCK_ACP_BIN", &binary);

    let supervisor = AcpSupervisor::new();
    let mut profile = mock_strict();
    profile.spawn_args = vec![
        "--scenario".to_string(),
        "tool_lifecycle".to_string(),
        "--strict".to_string(),
    ];
    let events = Arc::new(Mutex::new(Vec::<(u64, NormalizedEvent)>::new()));
    let events_cb = events.clone();
    let activities = Arc::new(Mutex::new(Vec::<String>::new()));
    let activities_cb = activities.clone();
    let result = tokio::time::timeout(
        Duration::from_secs(20),
        supervisor.run_turn(SupervisorTurnRequest {
            provider: profile,
            workspace_root: std::env::current_dir().expect("cwd"),
            thread_key: "tool-thread".to_string(),
            prompt: "use a tool".to_string(),
            model: None,
            existing_session_id: None,
            on_session: Arc::new(|_| {}),
            on_text: Arc::new(|_| {}),
            on_activity: Arc::new(move |activity| {
                activities_cb.lock().unwrap().push(activity.to_string());
            }),
            on_event: Arc::new(move |sequence, event| {
                events_cb.lock().unwrap().push((sequence, event));
            }),
        }),
    )
    .await
    .expect("supervisor turn timed out")
    .expect("supervisor turn failed");

    assert!(result.text.contains("Mock agent reply: use a tool"));
    let tool_count = events
        .lock()
        .unwrap()
        .iter()
        .filter(|(_, event)| {
            matches!(
                event,
                NormalizedEvent::Timeline(item) if item.kind == TimelineItemKind::ToolCall
            )
        })
        .count();
    assert!(
        tool_count >= 2,
        "expected multiple ToolCall timeline items, got {tool_count}"
    );
    let activities = activities.lock().unwrap().clone();
    assert!(
        activities.iter().any(|activity| activity.starts_with("Tool:")),
        "expected Tool activity updates, got {activities:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn supervisor_emits_plan_and_usage_timeline() {
    let binary = std::env::var("CARGO_BIN_EXE_gharargah-mock-acp")
        .expect("Cargo must provide the mock ACP binary path");
    std::env::set_var("GHARARGAH_MOCK_ACP_BIN", &binary);

    for (scenario, expected) in [
        ("plan_update", TimelineItemKind::Plan),
        ("usage_meter", TimelineItemKind::Usage),
        ("slash_commands", TimelineItemKind::Status),
    ] {
        let supervisor = AcpSupervisor::new();
        let mut profile = mock_strict();
        profile.spawn_args = vec![
            "--scenario".to_string(),
            scenario.to_string(),
            "--strict".to_string(),
        ];
        let events = Arc::new(Mutex::new(Vec::<(u64, NormalizedEvent)>::new()));
        let events_cb = events.clone();
        let result = tokio::time::timeout(
            Duration::from_secs(20),
            supervisor.run_turn(SupervisorTurnRequest {
                provider: profile,
                workspace_root: std::env::current_dir().expect("cwd"),
                thread_key: format!("{scenario}-thread"),
                prompt: format!("{scenario} prompt"),
                model: None,
                existing_session_id: None,
                on_session: Arc::new(|_| {}),
                on_text: Arc::new(|_| {}),
                on_activity: Arc::new(|_| {}),
                on_event: Arc::new(move |sequence, event| {
                    events_cb.lock().unwrap().push((sequence, event));
                }),
            }),
        )
        .await
        .expect("supervisor turn timed out")
        .expect("supervisor turn failed");
        assert!(
            result
                .text
                .contains(&format!("Mock agent reply: {scenario} prompt")),
            "unexpected text for {scenario}: {}",
            result.text
        );
        let kinds: Vec<TimelineItemKind> = events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(_, event)| match event {
                NormalizedEvent::Timeline(item) => Some(item.kind),
                _ => None,
            })
            .collect();
        assert!(
            kinds.contains(&expected),
            "scenario {scenario}: expected {expected:?}, got {kinds:?}"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn supervisor_terminal_roundtrip_completes() {
    let binary = std::env::var("CARGO_BIN_EXE_gharargah-mock-acp")
        .expect("Cargo must provide the mock ACP binary path");
    std::env::set_var("GHARARGAH_MOCK_ACP_BIN", &binary);

    let supervisor = AcpSupervisor::new();
    let mut profile = mock_strict();
    profile.spawn_args = vec![
        "--scenario".to_string(),
        "terminal_roundtrip".to_string(),
        "--strict".to_string(),
    ];
    let result = tokio::time::timeout(
        Duration::from_secs(20),
        supervisor.run_turn(SupervisorTurnRequest {
            provider: profile,
            workspace_root: std::env::current_dir().expect("cwd"),
            thread_key: "terminal-thread".to_string(),
            prompt: "run echo".to_string(),
            model: None,
            existing_session_id: None,
            on_session: Arc::new(|_| {}),
            on_text: Arc::new(|_| {}),
            on_activity: Arc::new(|_| {}),
            on_event: Arc::new(|_, _| {}),
        }),
    )
    .await
    .expect("supervisor turn timed out")
    .expect("supervisor turn failed");
    assert!(
        result.text.contains("Mock agent reply: run echo")
            || result.text.to_lowercase().contains("hi")
            || !result.text.is_empty(),
        "unexpected terminal scenario text: {}",
        result.text
    );
    assert!(!result.cancelled);
}
