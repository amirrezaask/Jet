use jet_server::host::claude_sdk::{
    normalize_message, ClaudeInteractionKind, ClaudePermissionMode, ClaudeProcessOptions,
    ClaudeSession, ClaudeSessionOptions, ClaudeSessionTurnRequest, ClaudeSupervisor,
    ClaudeSupervisorTurnRequest, ClaudeTimelineUpdate, ClaudeTurnCallbacks,
};
use serde_json::json;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio::sync::watch;

fn mock_binary() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_gharargah-mock-claude-sdk"))
}

fn process_options() -> ClaudeProcessOptions {
    ClaudeProcessOptions {
        executable: mock_binary(),
        cwd: std::env::current_dir().expect("current directory"),
        env: Vec::new(),
        model: None,
        effort: None,
        permission_mode: ClaudePermissionMode::Default,
        resume_session_id: None,
        new_session_id: None,
        extra_args: Vec::new(),
    }
}

#[tokio::test]
async fn session_streams_and_completes_a_turn() {
    let session = ClaudeSession::open(ClaudeSessionOptions {
        process: process_options(),
    })
    .await
    .expect("open session");
    assert_eq!(session.initialize_info()["models"][0]["value"], "mock-sonnet");
    let deltas = Arc::new(Mutex::new(String::new()));
    let timeline = Arc::new(Mutex::new(Vec::<ClaudeTimelineUpdate>::new()));
    let (_cancel_tx, cancel) = watch::channel(false);
    let result = session
        .run_turn(ClaudeSessionTurnRequest {
            content: json!([{"type": "text", "text": "hello"}]),
            permission_mode: ClaudePermissionMode::Default,
            model: None,
            cancel,
            callbacks: ClaudeTurnCallbacks {
                on_text_delta: {
                    let deltas = deltas.clone();
                    Arc::new(move |delta| {
                        deltas.lock().expect("delta lock").push_str(delta);
                    })
                },
                on_timeline: {
                    let timeline = timeline.clone();
                    Arc::new(move |update| {
                        timeline.lock().expect("timeline lock").push(update);
                    })
                },
                ..ClaudeTurnCallbacks::default()
            },
        })
        .await
        .expect("run turn");
    assert_eq!(result.status, "completed");
    assert_eq!(result.text, "mock:hello");
    assert_eq!(*deltas.lock().expect("delta lock"), "mock:hello");
    assert_eq!(
        result.session_id,
        "11111111-1111-4111-8111-111111111111"
    );
    assert!(result.usage.is_some());
    assert!(timeline
        .lock()
        .expect("timeline lock")
        .iter()
        .any(|update| update.item.kind
            == jet_server::host::acp::TimelineItemKind::Usage));
    session.stop().await;
}

#[tokio::test]
async fn session_interrupts_a_running_turn() {
    let session = Arc::new(
        ClaudeSession::open(ClaudeSessionOptions {
            process: process_options(),
        })
        .await
        .expect("open session"),
    );
    let (cancel_tx, cancel) = watch::channel(false);
    let running = {
        let session = session.clone();
        tokio::spawn(async move {
            session
                .run_turn(ClaudeSessionTurnRequest {
                    content: json!([{"type": "text", "text": "wait"}]),
                    permission_mode: ClaudePermissionMode::Default,
                    model: None,
                    cancel,
                    callbacks: ClaudeTurnCallbacks::default(),
                })
                .await
        })
    };
    tokio::task::yield_now().await;
    cancel_tx.send(true).expect("cancel");
    let result = running.await.expect("join").expect("turn result");
    assert!(result.cancelled);
    assert_eq!(result.status, "interrupted");
    session.stop().await;
}

#[tokio::test]
async fn supervisor_reuses_process_and_resolves_permissions() {
    let supervisor = Arc::new(ClaudeSupervisor::new());
    let run = |prompt: &str,
               supervisor: Arc<ClaudeSupervisor>,
               on_interaction: Arc<
        dyn Fn(jet_server::host::claude_sdk::ClaudeInteraction) + Send + Sync,
    >| {
        let prompt = prompt.to_string();
        async move {
            let (_cancel_tx, cancel) = watch::channel(false);
            supervisor
                .run_turn(ClaudeSupervisorTurnRequest {
                    executable: mock_binary(),
                    extra_args: Vec::new(),
                    env: Vec::new(),
                    workspace_root: std::env::current_dir().expect("current directory"),
                    thread_key: "workspace::thread".to_string(),
                    existing_provider_session_id: None,
                    prompt,
                    images: Vec::new(),
                    permission_mode: ClaudePermissionMode::Default,
                    model: None,
                    effort: None,
                    cancel,
                    on_session: Arc::new(|_| {}),
                    on_text_delta: Arc::new(|_| {}),
                    on_message: Arc::new(|_| {}),
                    on_timeline: Arc::new(|_| {}),
                    on_interaction,
                })
                .await
        }
    };

    let first = run("process-count", supervisor.clone(), Arc::new(|_| {}))
        .await
        .expect("first turn");
    let second = run("process-count", supervisor.clone(), Arc::new(|_| {}))
        .await
        .expect("second turn");
    assert_eq!(first.text, "process-turn:1");
    assert_eq!(second.text, "process-turn:2");

    let permission_supervisor = supervisor.clone();
    let permission = run(
        "permission",
        supervisor.clone(),
        Arc::new(move |interaction| {
            assert_eq!(interaction.kind, ClaudeInteractionKind::Permission);
            permission_supervisor
                .resolve_permission(&interaction.request_id, "allow_once")
                .expect("resolve permission");
        }),
    )
    .await
    .expect("permission turn");
    assert_eq!(permission.text, "permission:allow");
    supervisor.shutdown();
}

#[test]
fn normalizes_thought_tools_usage_and_rate_limits() {
    let thought = normalize_message(
        &json!({
            "type": "stream_event",
            "uuid": "assistant",
            "session_id": "session",
            "event": {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "thinking_delta", "thinking": "reasoning"},
            }
        }),
        None,
    );
    assert_eq!(thought.len(), 1);
    assert!(thought[0].append_text);
    assert_eq!(thought[0].item.payload["text"], "reasoning");

    let tool = normalize_message(
        &json!({
            "type": "stream_event",
            "uuid": "assistant",
            "session_id": "session",
            "event": {
                "type": "content_block_start",
                "index": 1,
                "content_block": {
                    "type": "tool_use",
                    "id": "tool",
                    "name": "Bash",
                    "input": {"command": "pwd"},
                },
            }
        }),
        None,
    );
    assert_eq!(tool[0].item.id, "tool");
    assert_eq!(tool[0].item.payload["name"], "Bash");

    let usage = normalize_message(
        &json!({
            "type": "result",
            "session_id": "session",
            "usage": {"input_tokens": 5, "output_tokens": 3},
        }),
        None,
    );
    assert_eq!(usage[0].item.payload["usage"]["input_tokens"], 5);

    let rate_limit = normalize_message(
        &json!({
            "type": "rate_limit_event",
            "session_id": "session",
            "rate_limit_info": {"status": "allowed_warning"},
        }),
        None,
    );
    assert_eq!(rate_limit[0].item.payload["type"], "rate_limit");
}
