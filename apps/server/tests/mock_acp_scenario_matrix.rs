//! Exhaustive mock ACP scenario matrix.
//!
//! Every entry in `Scenario::ALL` must have a dedicated assertion below.
//! Adding a scenario without a test fails `every_mock_scenario_has_a_matrix_entry`.

use jet_server::host::acp::{
    mock_strict, AcpSupervisor, NormalizedEvent, SupervisorTurnRequest, TimelineItemKind,
};
use jet_server::mock_acp::Scenario;
use serde_json::Value;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tempfile::TempDir;

/// Scenarios exercised by this file. Must stay equal to `Scenario::ALL` names.
const MATRIX_SCENARIOS: &[&str] = &[
    "echo",
    "thought_then_answer",
    "tool_lifecycle",
    "permission_allow",
    "permission_tool_race",
    "permission_allow_always",
    "plan_update",
    "cancel_coop",
    "slow_stream",
    "usage_meter",
    "config_model",
    "slash_commands",
    "chaos_malformed",
    "load_session",
    "fs_roundtrip",
    "terminal_roundtrip",
    "multi_session",
    "ask_question",
    "create_plan",
    "update_todos",
    "elicitation",
    "auth_required",
    "image_prompt",
    "set_mode_plan",
    "mcp_servers_inject",
];

fn mock_bin() -> String {
    std::env::var("CARGO_BIN_EXE_gharargah-mock-acp")
        .expect("Cargo must provide the mock ACP binary path")
}

fn install_mock_bin() {
    std::env::set_var("GHARARGAH_MOCK_ACP_BIN", mock_bin());
}

fn profile_for(scenario: &str) -> jet_server::host::acp::ProviderProfile {
    let mut profile = mock_strict();
    profile.spawn_args = vec![
        "--scenario".to_string(),
        scenario.to_string(),
        "--strict".to_string(),
    ];
    profile
}

fn timeline_kinds(events: &[(u64, NormalizedEvent)]) -> Vec<TimelineItemKind> {
    events
        .iter()
        .filter_map(|(_, event)| match event {
            NormalizedEvent::Timeline(item) => Some(item.kind),
            _ => None,
        })
        .collect()
}

async fn run_turn(
    supervisor: &AcpSupervisor,
    scenario: &str,
    thread_key: &str,
    prompt: &str,
    cwd: PathBuf,
    model: Option<String>,
    existing_session_id: Option<String>,
    on_session: Arc<dyn Fn(&str) + Send + Sync>,
    on_text: Arc<dyn Fn(&str) + Send + Sync>,
    on_activity: Arc<dyn Fn(&str) + Send + Sync>,
    on_event: Arc<dyn Fn(u64, NormalizedEvent) + Send + Sync>,
) -> Result<jet_server::host::acp::SupervisorTurnResult, String> {
    run_turn_with_images(
        supervisor,
        scenario,
        thread_key,
        prompt,
        cwd,
        model,
        existing_session_id,
        vec![],
        on_session,
        on_text,
        on_activity,
        on_event,
    )
    .await
}

async fn run_turn_with_images(
    supervisor: &AcpSupervisor,
    scenario: &str,
    thread_key: &str,
    prompt: &str,
    cwd: PathBuf,
    model: Option<String>,
    existing_session_id: Option<String>,
    images: Vec<(String, String)>,
    on_session: Arc<dyn Fn(&str) + Send + Sync>,
    on_text: Arc<dyn Fn(&str) + Send + Sync>,
    on_activity: Arc<dyn Fn(&str) + Send + Sync>,
    on_event: Arc<dyn Fn(u64, NormalizedEvent) + Send + Sync>,
) -> Result<jet_server::host::acp::SupervisorTurnResult, String> {
    tokio::time::timeout(
        Duration::from_secs(30),
        supervisor.run_turn(SupervisorTurnRequest {
            provider: profile_for(scenario),
            workspace_root: cwd,
            thread_key: thread_key.to_string(),
            prompt: prompt.to_string(),
            images,
            model,
            existing_session_id,
            runtime_mode: None,
            interaction_mode: None,
            prefer_resume: false,
            initial_sequence: 0,
            on_session,
            on_text,
            on_activity,
            on_event,
        }),
    )
    .await
    .map_err(|_| format!("{scenario}: timed out"))?
}

async fn run_turn_with_modes(
    supervisor: &AcpSupervisor,
    scenario: &str,
    thread_key: &str,
    prompt: &str,
    cwd: PathBuf,
    interaction_mode: Option<String>,
    runtime_mode: Option<String>,
    on_session: Arc<dyn Fn(&str) + Send + Sync>,
    on_text: Arc<dyn Fn(&str) + Send + Sync>,
    on_activity: Arc<dyn Fn(&str) + Send + Sync>,
    on_event: Arc<dyn Fn(u64, NormalizedEvent) + Send + Sync>,
) -> Result<jet_server::host::acp::SupervisorTurnResult, String> {
    tokio::time::timeout(
        Duration::from_secs(30),
        supervisor.run_turn(SupervisorTurnRequest {
            provider: profile_for(scenario),
            workspace_root: cwd,
            thread_key: thread_key.to_string(),
            prompt: prompt.to_string(),
            images: vec![],
            model: None,
            existing_session_id: None,
            runtime_mode,
            interaction_mode,
            prefer_resume: false,
            initial_sequence: 0,
            on_session,
            on_text,
            on_activity,
            on_event,
        }),
    )
    .await
    .map_err(|_| format!("{scenario}: timed out"))?
}

#[test]
fn every_mock_scenario_has_a_matrix_entry() {
    let documented: HashSet<&str> = MATRIX_SCENARIOS.iter().copied().collect();
    let all: HashSet<&str> = Scenario::ALL.iter().map(|(name, _)| *name).collect();
    assert_eq!(
        documented, all,
        "MATRIX_SCENARIOS drifted from Scenario::ALL.\nonly in matrix: {:?}\nonly in Scenario::ALL: {:?}",
        documented.difference(&all).collect::<Vec<_>>(),
        all.difference(&documented).collect::<Vec<_>>(),
    );
    assert_eq!(MATRIX_SCENARIOS.len(), Scenario::ALL.len());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_echo() {
    install_mock_bin();
    let supervisor = AcpSupervisor::new();
    let result = run_turn(
        &supervisor,
        "echo",
        "matrix-echo",
        "hello matrix",
        std::env::current_dir().unwrap(),
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_, _| {}),
    )
    .await
    .expect("echo");
    assert!(result.text.contains("Mock agent reply: hello matrix"));
    assert!(!result.cancelled);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_thought_then_answer() {
    install_mock_bin();
    let events = Arc::new(Mutex::new(Vec::new()));
    let events_cb = events.clone();
    let supervisor = AcpSupervisor::new();
    let result = run_turn(
        &supervisor,
        "thought_then_answer",
        "matrix-thought",
        "think",
        std::env::current_dir().unwrap(),
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(move |seq, event| events_cb.lock().unwrap().push((seq, event))),
    )
    .await
    .expect("thought");
    assert!(result.text.contains("Mock agent reply: think"));
    let kinds = timeline_kinds(&events.lock().unwrap());
    assert!(kinds.contains(&TimelineItemKind::Thought), "{kinds:?}");
    assert!(kinds.contains(&TimelineItemKind::Text), "{kinds:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_tool_lifecycle() {
    install_mock_bin();
    let events = Arc::new(Mutex::new(Vec::new()));
    let events_cb = events.clone();
    let supervisor = AcpSupervisor::new();
    let result = run_turn(
        &supervisor,
        "tool_lifecycle",
        "matrix-tool",
        "tools",
        std::env::current_dir().unwrap(),
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(move |seq, event| events_cb.lock().unwrap().push((seq, event))),
    )
    .await
    .expect("tool");
    assert!(result.text.contains("Mock agent reply: tools"));
    let tool_ids: HashSet<String> = events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|(_, event)| match event {
            NormalizedEvent::Timeline(item) if item.kind == TimelineItemKind::ToolCall => {
                Some(item.id.clone())
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        tool_ids.len(),
        1,
        "tool lifecycle must reduce to one stable id, got {tool_ids:?}"
    );
    let tool_updates = events
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
    assert!(tool_updates >= 2, "tool updates={tool_updates}");
}

async fn permission_scenario(scenario: &str) {
    install_mock_bin();
    let supervisor = Arc::new(AcpSupervisor::new());
    let supervisor_cb = supervisor.clone();
    let permissions = Arc::new(Mutex::new(0u32));
    let permissions_cb = permissions.clone();
    let result = run_turn(
        supervisor.as_ref(),
        scenario,
        &format!("matrix-{scenario}"),
        "approve",
        std::env::current_dir().unwrap(),
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(move |_, event| {
            let NormalizedEvent::Timeline(item) = event else {
                return;
            };
            if item.kind != TimelineItemKind::Permission {
                return;
            }
            *permissions_cb.lock().unwrap() += 1;
            let id = item
                .payload
                .get("id")
                .or_else(|| item.payload.get("requestId"))
                .and_then(|value| value.as_str())
                .expect("permission id");
            let option_id = item
                .payload
                .get("options")
                .and_then(|value| value.as_array())
                .and_then(|options| {
                    options
                        .iter()
                        .find(|option| {
                            option.get("id").and_then(|value| value.as_str()) == Some("allow_always")
                        })
                        .or_else(|| options.first())
                })
                .and_then(|option| option.get("id").and_then(|value| value.as_str()))
                .unwrap_or("allow_once");
            supervisor_cb
                .resolve_permission(id, option_id)
                .expect("resolve permission");
        }),
    )
    .await
    .unwrap_or_else(|error| panic!("{scenario} failed: {error}"));
    assert!(
        result.text.contains("Mock agent reply: approve"),
        "{scenario} text={}",
        result.text
    );
    assert!(
        *permissions.lock().unwrap() >= 1,
        "{scenario} never requested permission"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_permission_allow() {
    permission_scenario("permission_allow").await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_permission_tool_race() {
    permission_scenario("permission_tool_race").await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_permission_allow_always() {
    permission_scenario("permission_allow_always").await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_plan_update() {
    install_mock_bin();
    let events = Arc::new(Mutex::new(Vec::new()));
    let events_cb = events.clone();
    let supervisor = AcpSupervisor::new();
    let result = run_turn(
        &supervisor,
        "plan_update",
        "matrix-plan",
        "plan it",
        std::env::current_dir().unwrap(),
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(move |seq, event| events_cb.lock().unwrap().push((seq, event))),
    )
    .await
    .expect("plan");
    assert!(result.text.contains("Mock agent reply: plan it"));
    assert!(timeline_kinds(&events.lock().unwrap()).contains(&TimelineItemKind::Plan));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_cancel_coop() {
    install_mock_bin();
    let supervisor = Arc::new(AcpSupervisor::new());
    let supervisor_cb = supervisor.clone();
    let thread_key = "matrix-cancel";
    let result = run_turn(
        supervisor.as_ref(),
        "cancel_coop",
        thread_key,
        "please cancel",
        std::env::current_dir().unwrap(),
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(move |activity| {
            if activity.contains("Thinking") {
                supervisor_cb.cancel_turn(thread_key);
            }
        }),
        Arc::new(|_, _| {}),
    )
    .await
    .expect("cancel_coop");
    assert!(result.cancelled, "expected cancelled stop reason");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_slow_stream() {
    install_mock_bin();
    let texts = Arc::new(Mutex::new(Vec::<String>::new()));
    let texts_cb = texts.clone();
    let supervisor = AcpSupervisor::new();
    let result = run_turn(
        &supervisor,
        "slow_stream",
        "matrix-slow",
        "stream me slowly",
        std::env::current_dir().unwrap(),
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(move |text| texts_cb.lock().unwrap().push(text.to_string())),
        Arc::new(|_| {}),
        Arc::new(|_, _| {}),
    )
    .await
    .expect("slow_stream");
    assert!(result.text.contains("Mock agent reply: stream me slowly"));
    assert!(
        texts.lock().unwrap().len() >= 2,
        "expected multiple streamed snapshots, got {:?}",
        texts.lock().unwrap()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_usage_meter() {
    install_mock_bin();
    let events = Arc::new(Mutex::new(Vec::new()));
    let events_cb = events.clone();
    let supervisor = AcpSupervisor::new();
    let result = run_turn(
        &supervisor,
        "usage_meter",
        "matrix-usage",
        "meter",
        std::env::current_dir().unwrap(),
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(move |seq, event| events_cb.lock().unwrap().push((seq, event))),
    )
    .await
    .expect("usage");
    assert!(result.text.contains("Mock agent reply: meter"));
    assert!(timeline_kinds(&events.lock().unwrap()).contains(&TimelineItemKind::Usage));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_config_model() {
    install_mock_bin();
    let supervisor = AcpSupervisor::new();
    let result = run_turn(
        &supervisor,
        "config_model",
        "matrix-config",
        "with model",
        std::env::current_dir().unwrap(),
        Some("mock-fast".to_string()),
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_, _| {}),
    )
    .await
    .expect("config_model");
    assert!(result.text.contains("Mock agent reply: with model"));
    assert!(!result.session_id.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_slash_commands() {
    install_mock_bin();
    let events = Arc::new(Mutex::new(Vec::new()));
    let events_cb = events.clone();
    let supervisor = AcpSupervisor::new();
    let result = run_turn(
        &supervisor,
        "slash_commands",
        "matrix-slash",
        "commands",
        std::env::current_dir().unwrap(),
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(move |seq, event| events_cb.lock().unwrap().push((seq, event))),
    )
    .await
    .expect("slash");
    assert!(result.text.contains("Mock agent reply: commands"));
    let command_status = events.lock().unwrap().iter().any(|(_, event)| {
        matches!(
            event,
            NormalizedEvent::Timeline(item)
                if item.kind == TimelineItemKind::Status
                    && item.payload.get("type").and_then(|v| v.as_str()) == Some("commands")
        )
    });
    assert!(command_status, "expected AvailableCommandsUpdate status event");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_chaos_malformed() {
    install_mock_bin();
    let supervisor = AcpSupervisor::new();
    let result = run_turn(
        &supervisor,
        "chaos_malformed",
        "matrix-chaos",
        "boom",
        std::env::current_dir().unwrap(),
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_, _| {}),
    )
    .await;
    assert!(
        result.is_err(),
        "chaos_malformed must fail the transport, got {:?}",
        result.map(|value| value.text)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_load_session() {
    install_mock_bin();
    let supervisor = AcpSupervisor::new();
    let cwd = std::env::current_dir().unwrap();
    let session_id = Arc::new(Mutex::new(None::<String>));
    let session_cb = session_id.clone();
    let first = run_turn(
        &supervisor,
        "load_session",
        "matrix-load-1",
        "first turn",
        cwd.clone(),
        None,
        None,
        Arc::new(move |id| {
            *session_cb.lock().unwrap() = Some(id.to_string());
        }),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_, _| {}),
    )
    .await
    .expect("load_session first turn");
    assert!(first.text.contains("Mock agent reply: first turn"));
    let existing = session_id
        .lock()
        .unwrap()
        .clone()
        .expect("session id from first turn");
    let events = Arc::new(Mutex::new(Vec::new()));
    let events_cb = events.clone();
    let texts = Arc::new(Mutex::new(Vec::<String>::new()));
    let texts_cb = texts.clone();
    let second = run_turn(
        &supervisor,
        "load_session",
        "matrix-load-2",
        "second turn",
        cwd,
        None,
        Some(existing),
        Arc::new(|_| {}),
        Arc::new(move |text| texts_cb.lock().unwrap().push(text.to_string())),
        Arc::new(|_| {}),
        Arc::new(move |seq, event| events_cb.lock().unwrap().push((seq, event))),
    )
    .await
    .expect("load_session second turn");
    assert!(second.text.contains("Mock agent reply: second turn"));
    // Load replay MUST be captured before the load response returns.
    let saw_replay = texts
        .lock()
        .unwrap()
        .iter()
        .any(|text| text.contains("Mock replayed session message"))
        || events.lock().unwrap().iter().any(|(_, event)| {
            matches!(
                event,
                NormalizedEvent::Timeline(item)
                    if item.kind == TimelineItemKind::Text
                        && item
                            .payload
                            .get("text")
                            .and_then(Value::as_str)
                            .is_some_and(|text| text.contains("Mock replayed session message"))
            )
        });
    assert!(
        saw_replay,
        "expected load replay to be captured, texts={:?} events={:?}",
        texts.lock().unwrap(),
        events.lock().unwrap().len()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_fs_roundtrip() {
    install_mock_bin();
    let dir = TempDir::new().expect("tempdir");
    let file = dir.path().join("fixture.txt");
    std::fs::write(&file, "fixture-bytes-42").expect("write fixture");
    let supervisor = AcpSupervisor::new();
    let result = run_turn(
        &supervisor,
        "fs_roundtrip",
        "matrix-fs",
        file.to_str().expect("utf8 path"),
        dir.path().to_path_buf(),
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_, _| {}),
    )
    .await
    .expect("fs_roundtrip");
    assert!(
        result.text.contains("Mock read: fixture-bytes-42"),
        "unexpected fs text: {}",
        result.text
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_terminal_roundtrip() {
    install_mock_bin();
    let supervisor = AcpSupervisor::new();
    let result = run_turn(
        &supervisor,
        "terminal_roundtrip",
        "matrix-term",
        "run echo",
        std::env::current_dir().unwrap(),
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_, _| {}),
    )
    .await
    .expect("terminal_roundtrip");
    assert!(
        result.text.contains("Mock terminal:") && result.text.to_lowercase().contains("hi"),
        "unexpected terminal text: {}",
        result.text
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn matrix_multi_session() {
    install_mock_bin();
    let supervisor = Arc::new(AcpSupervisor::new());
    let cwd = std::env::current_dir().unwrap();
    let sessions = Arc::new(Mutex::new(HashSet::<String>::new()));
    let chunks = Arc::new(Mutex::new(Vec::<(String, String)>::new()));
    let mut joins = Vec::new();
    for prompt in ["alpha", "beta"] {
        let supervisor = supervisor.clone();
        let sessions_cb = sessions.clone();
        let chunks_cb = chunks.clone();
        let cwd = cwd.clone();
        joins.push(tokio::spawn(async move {
            let result = run_turn(
                supervisor.as_ref(),
                "multi_session",
                &format!("matrix-multi-{prompt}"),
                prompt,
                cwd,
                None,
                None,
                Arc::new(move |session_id| {
                    sessions_cb.lock().unwrap().insert(session_id.to_string());
                }),
                Arc::new(move |text| {
                    chunks_cb
                        .lock()
                        .unwrap()
                        .push((prompt.to_string(), text.to_string()));
                }),
                Arc::new(|_| {}),
                Arc::new(|_, _| {}),
            )
            .await
            .unwrap_or_else(|error| panic!("multi_session {prompt}: {error}"));
            assert!(result.text.contains(&format!("Mock agent reply: {prompt}")));
            result.session_id
        }));
    }
    let mut ids = HashSet::new();
    for join in joins {
        ids.insert(join.await.expect("join"));
    }
    assert!(
        ids.len() >= 2 && sessions.lock().unwrap().len() >= 2,
        "expected concurrent distinct ACP sessions, got ids={ids:?} sessions={:?}",
        sessions.lock().unwrap()
    );
    let observed = chunks.lock().unwrap().clone();
    assert!(
        observed.len() >= 2,
        "expected interleaved text callbacks from concurrent turns, got {observed:?}"
    );
}

fn auto_resolve_user_input(
    supervisor: Arc<AcpSupervisor>,
) -> Arc<dyn Fn(u64, NormalizedEvent) + Send + Sync> {
    Arc::new(move |_seq, event| {
        let NormalizedEvent::Timeline(item) = event else {
            return;
        };
        if item.kind != TimelineItemKind::UserInput {
            return;
        }
        let id = item
            .payload
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if id.is_empty() {
            return;
        }
        let kind = item
            .payload
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("");
        let answer = if kind == "elicitation" {
            serde_json::json!({ "action": "accept", "text": "mock-note" })
        } else {
            let question_id = item
                .payload
                .get("questions")
                .and_then(Value::as_array)
                .and_then(|questions| questions.first())
                .and_then(|question| question.get("id").and_then(Value::as_str))
                .unwrap_or("q1");
            let selected = item
                .payload
                .get("questions")
                .and_then(Value::as_array)
                .and_then(|questions| questions.first())
                .and_then(|question| question.get("options").and_then(Value::as_array))
                .and_then(|options| options.first())
                .and_then(|option| option.get("label").and_then(Value::as_str))
                .unwrap_or("Red");
            serde_json::json!({
                "answers": [{ "questionId": question_id, "selected": [selected] }]
            })
        };
        let _ = supervisor.resolve_user_input(&id, answer);
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_ask_question() {
    install_mock_bin();
    let supervisor = Arc::new(AcpSupervisor::new());
    let on_event = auto_resolve_user_input(supervisor.clone());
    let result = run_turn(
        supervisor.as_ref(),
        "ask_question",
        "matrix-ask",
        "choose",
        std::env::current_dir().unwrap(),
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        on_event,
    )
    .await
    .expect("ask_question");
    assert!(
        result.text.contains("Mock agent reply: choose ->"),
        "unexpected text: {}",
        result.text
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_create_plan() {
    install_mock_bin();
    let events = Arc::new(Mutex::new(Vec::new()));
    let events_cb = events.clone();
    let supervisor = AcpSupervisor::new();
    let result = run_turn(
        &supervisor,
        "create_plan",
        "matrix-create-plan",
        "plan via ext",
        std::env::current_dir().unwrap(),
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(move |seq, event| events_cb.lock().unwrap().push((seq, event))),
    )
    .await
    .expect("create_plan");
    assert!(result.text.contains("Mock agent reply: plan via ext"));
    assert!(timeline_kinds(&events.lock().unwrap()).contains(&TimelineItemKind::Plan));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_update_todos() {
    install_mock_bin();
    let events = Arc::new(Mutex::new(Vec::new()));
    let events_cb = events.clone();
    let supervisor = AcpSupervisor::new();
    let result = run_turn(
        &supervisor,
        "update_todos",
        "matrix-todos",
        "todos",
        std::env::current_dir().unwrap(),
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(move |seq, event| events_cb.lock().unwrap().push((seq, event))),
    )
    .await
    .expect("update_todos");
    assert!(result.text.contains("Mock agent reply: todos"));
    assert!(timeline_kinds(&events.lock().unwrap()).contains(&TimelineItemKind::Plan));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_elicitation() {
    install_mock_bin();
    let supervisor = Arc::new(AcpSupervisor::new());
    let on_event = auto_resolve_user_input(supervisor.clone());
    let result = run_turn(
        supervisor.as_ref(),
        "elicitation",
        "matrix-elicit",
        "need note",
        std::env::current_dir().unwrap(),
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        on_event,
    )
    .await
    .expect("elicitation");
    assert!(result.text.contains("Mock agent reply: need note"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_auth_required() {
    install_mock_bin();
    let supervisor = AcpSupervisor::new();
    let cwd = std::env::current_dir().unwrap();
    let first = run_turn(
        &supervisor,
        "auth_required",
        "matrix-auth-1",
        "blocked",
        cwd.clone(),
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_, _| {}),
    )
    .await;
    let first_err = first.as_ref().err().map(String::as_str).unwrap_or("");
    assert!(
        first_err.contains("authentication_required"),
        "expected auth block, got Ok/err={first_err}"
    );
    let connection_key = format!("mock-strict:{}", cwd.display());
    supervisor
        .authenticate(&connection_key, Some("mock-token"))
        .await
        .expect("authenticate");
    let second = run_turn(
        &supervisor,
        "auth_required",
        "matrix-auth-2",
        "after auth",
        cwd,
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_, _| {}),
    )
    .await
    .expect("authenticated turn");
    assert!(second.text.contains("Mock agent reply: after auth"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_image_prompt() {
    install_mock_bin();
    let supervisor = AcpSupervisor::new();
    // Tiny 1x1 PNG base64.
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    let result = run_turn_with_images(
        &supervisor,
        "image_prompt",
        "matrix-image",
        "see image",
        std::env::current_dir().unwrap(),
        None,
        None,
        vec![(png.to_string(), "image/png".to_string())],
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_, _| {}),
    )
    .await
    .expect("image_prompt");
    assert!(
        result.text.contains("images=1") && result.text.contains("see image"),
        "unexpected text: {}",
        result.text
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_set_mode_plan() {
    install_mock_bin();
    let supervisor = AcpSupervisor::new();
    let result = run_turn_with_modes(
        &supervisor,
        "set_mode_plan",
        "matrix-set-mode",
        "plan mode",
        std::env::current_dir().unwrap(),
        Some("plan".to_string()),
        Some("full-access".to_string()),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_, _| {}),
    )
    .await
    .expect("set_mode_plan");
    assert!(
        result.text.contains("mode:plan"),
        "expected last set mode in reply, got: {}",
        result.text
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn matrix_mcp_servers_inject() {
    install_mock_bin();
    let supervisor = AcpSupervisor::new();
    let result = run_turn(
        &supervisor,
        "mcp_servers_inject",
        "matrix-mcp",
        "inject check",
        std::env::current_dir().unwrap(),
        None,
        None,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(|_, _| {}),
    )
    .await
    .expect("mcp_servers_inject");
    assert!(
        result.text.contains("mcp_servers="),
        "expected mcp server count in reply, got: {}",
        result.text
    );
    assert!(
        !result.text.contains("mcp_servers=0"),
        "expected at least one injected mcp server, got: {}",
        result.text
    );
}
