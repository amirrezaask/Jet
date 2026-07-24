use jet_server::host::codex_app_server::{
    CodexAppServer, CodexInteractionKind, CodexInteractionStore, CodexSession, CodexSessionOptions,
    CodexSessionTurnRequest, CodexSupervisor, CodexSupervisorTurnRequest, CodexThreadOptions,
    CodexTurnCallbacks, CodexTurnInput, CodexTurnOptions, RuntimeMode,
};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

fn executable() -> &'static str {
    env!("CARGO_BIN_EXE_gharargah-mock-line-rpc")
}

#[tokio::test]
async fn initializes_opens_resumes_prompts_and_interrupts() {
    let workspace = tempfile::tempdir().expect("create temporary workspace");
    let server = CodexAppServer::start(executable(), &[], workspace.path(), &[])
        .await
        .expect("start Codex protocol client");
    assert_eq!(
        server.initialize_response().user_agent,
        "gharargah-mock-line-rpc"
    );

    let options = CodexThreadOptions {
        cwd: workspace.path().to_path_buf(),
        runtime_mode: RuntimeMode::ApprovalRequired,
        model: Some("mock-model".to_string()),
        service_tier: None,
        ephemeral: true,
    };
    let opened = server.start_thread(&options).await.expect("start thread");
    assert_eq!(opened.thread.id, "mock-codex-thread");

    let resumed = server
        .resume_thread(&opened.thread.id, &options)
        .await
        .expect("resume thread");
    assert_eq!(resumed.thread.id, opened.thread.id);

    let mut notifications = server.subscribe_notifications();
    let turn = server
        .start_turn(&CodexTurnOptions {
            thread_id: opened.thread.id.clone(),
            input: vec![
                CodexTurnInput::Text("hello".to_string()),
                CodexTurnInput::Image {
                    url: "data:image/png;base64,AA==".to_string(),
                },
            ],
            runtime_mode: RuntimeMode::ApprovalRequired,
            model: Some("mock-model".to_string()),
            service_tier: None,
            effort: Some("medium".to_string()),
        })
        .await
        .expect("start turn");
    assert_eq!(turn.turn.id, "mock-codex-turn");

    let delta = tokio::time::timeout(Duration::from_secs(2), notifications.recv())
        .await
        .expect("delta timeout")
        .expect("notification channel closed");
    assert_eq!(delta.method, "item/agentMessage/delta");
    assert_eq!(delta.params["delta"], "mock codex reply");

    let completed = tokio::time::timeout(Duration::from_secs(2), notifications.recv())
        .await
        .expect("completion timeout")
        .expect("notification channel closed");
    assert_eq!(completed.method, "turn/completed");
    assert_eq!(completed.params["turn"]["status"], "completed");

    server
        .interrupt_turn(&opened.thread.id, &turn.turn.id)
        .await
        .expect("interrupt turn");
    server.stop().await;
}

#[tokio::test]
async fn rejects_empty_turn_input_before_writing_to_transport() {
    let workspace = tempfile::tempdir().expect("create temporary workspace");
    let server = CodexAppServer::start(executable(), &[], workspace.path(), &[])
        .await
        .expect("start Codex protocol client");
    let error = server
        .start_turn(&CodexTurnOptions {
            thread_id: "thread".to_string(),
            input: Vec::new(),
            runtime_mode: RuntimeMode::ApprovalRequired,
            model: None,
            service_tier: None,
            effort: None,
        })
        .await
        .expect_err("empty input must fail");
    assert!(
        error.to_string().contains("at least one input"),
        "unexpected error: {error}"
    );
    server.stop().await;
}

#[tokio::test]
async fn session_runtime_collects_streaming_text_and_completion() {
    let workspace = tempfile::tempdir().expect("create temporary workspace");
    let session = CodexSession::open(CodexSessionOptions {
        executable: executable().into(),
        extra_args: Vec::new(),
        env: Vec::new(),
        thread: CodexThreadOptions {
            cwd: workspace.path().to_path_buf(),
            runtime_mode: RuntimeMode::ApprovalRequired,
            model: None,
            service_tier: None,
            ephemeral: true,
        },
        resume_thread_id: None,
    })
    .await
    .expect("open Codex session");
    assert_eq!(session.thread_id(), "mock-codex-thread");

    let streamed = Arc::new(Mutex::new(String::new()));
    let streamed_callback = streamed.clone();
    let (_cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    let result = session
        .run_turn(CodexSessionTurnRequest {
            input: vec![CodexTurnInput::Text("hello".to_string())],
            runtime_mode: RuntimeMode::ApprovalRequired,
            model: None,
            service_tier: None,
            effort: None,
            cancel: cancel_rx,
            callbacks: CodexTurnCallbacks {
                on_text_delta: Arc::new(move |delta| {
                    streamed_callback
                        .lock()
                        .expect("streamed text lock poisoned")
                        .push_str(delta);
                }),
                ..CodexTurnCallbacks::default()
            },
        })
        .await
        .expect("run Codex turn");

    assert_eq!(result.status, "completed");
    assert_eq!(result.text, "mock codex reply");
    assert_eq!(
        streamed
            .lock()
            .expect("streamed text lock poisoned")
            .as_str(),
        "mock codex reply"
    );
    assert!(!result.cancelled);
    session.stop().await;
}

#[tokio::test]
async fn permission_requests_round_trip_through_the_interaction_store() {
    let workspace = tempfile::tempdir().expect("create temporary workspace");
    let session = Arc::new(
        CodexSession::open(CodexSessionOptions {
            executable: executable().into(),
            extra_args: Vec::new(),
            env: Vec::new(),
            thread: CodexThreadOptions {
                cwd: workspace.path().to_path_buf(),
                runtime_mode: RuntimeMode::ApprovalRequired,
                model: None,
                service_tier: None,
                ephemeral: true,
            },
            resume_thread_id: None,
        })
        .await
        .expect("open Codex session"),
    );
    let store = CodexInteractionStore::default();
    let callback_store = store.clone();
    let (interaction_tx, mut interaction_rx) = tokio::sync::mpsc::unbounded_channel();
    let (_cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    let turn_session = session.clone();
    let turn = tokio::spawn(async move {
        turn_session
            .run_turn(CodexSessionTurnRequest {
                input: vec![CodexTurnInput::Text("request permission".to_string())],
                runtime_mode: RuntimeMode::ApprovalRequired,
                model: None,
                service_tier: None,
                effort: None,
                cancel: cancel_rx,
                callbacks: CodexTurnCallbacks {
                    on_server_request: Arc::new(move |request| {
                        let interaction = callback_store
                            .register("workspace::thread", request)
                            .expect("register Codex interaction")
                            .expect("supported Codex interaction");
                        interaction_tx
                            .send(interaction)
                            .expect("send interaction to test");
                    }),
                    ..CodexTurnCallbacks::default()
                },
            })
            .await
    });

    let interaction = tokio::time::timeout(Duration::from_secs(2), interaction_rx.recv())
        .await
        .expect("permission timeout")
        .expect("permission channel closed");
    assert_eq!(interaction.kind, CodexInteractionKind::Permission);
    assert_eq!(interaction.payload["title"], "Run command");
    assert_eq!(store.pending_count(), 1);
    store
        .resolve_permission(&interaction.request_id, "allow_once")
        .expect("resolve permission");

    let result = turn
        .await
        .expect("turn task panicked")
        .expect("permission turn failed");
    assert_eq!(result.status, "completed");
    assert_eq!(result.text, "permission accept");
    assert_eq!(store.pending_count(), 0);
    session.stop().await;
}

#[tokio::test]
async fn supervisor_reuses_one_session_across_turns() {
    let workspace = tempfile::tempdir().expect("create temporary workspace");
    let supervisor = CodexSupervisor::new();
    let provider_thread_ids = Arc::new(Mutex::new(Vec::<String>::new()));

    for prompt in ["first", "second"] {
        let provider_thread_ids = provider_thread_ids.clone();
        let (_cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        let result = supervisor
            .run_turn(CodexSupervisorTurnRequest {
                executable: executable().into(),
                extra_args: Vec::new(),
                env: Vec::new(),
                workspace_root: workspace.path().to_path_buf(),
                thread_key: "workspace::product-thread".to_string(),
                existing_provider_thread_id: None,
                prompt: prompt.to_string(),
                images: Vec::new(),
                runtime_mode: RuntimeMode::ApprovalRequired,
                model: None,
                service_tier: None,
                effort: None,
                cancel: cancel_rx,
                on_session: Arc::new(move |thread_id| {
                    provider_thread_ids
                        .lock()
                        .expect("provider thread id lock poisoned")
                        .push(thread_id.to_string());
                }),
                on_text_delta: Arc::new(|_| {}),
                on_notification: Arc::new(|_| {}),
                on_interaction: Arc::new(|_| {}),
            })
            .await
            .expect("run supervised turn");
        assert_eq!(result.status, "completed");
    }

    assert_eq!(supervisor.session_count(), 1);
    assert_eq!(
        provider_thread_ids
            .lock()
            .expect("provider thread id lock poisoned")
            .as_slice(),
        ["mock-codex-thread", "mock-codex-thread"]
    );
    supervisor.shutdown();
}
