use agent_client_protocol::schema::v1::StopReason;
use agent_client_protocol::AcpAgent;
use jet_server::host::acp_client::{auto_permission_for_tests, run_acp_turn, AcpTurnInput};
use std::sync::{Arc, Mutex};
use tokio::sync::watch;

fn mock_agent(scenario: &str) -> AcpAgent {
    let binary = std::env::var("CARGO_BIN_EXE_gharargah-mock-acp")
        .expect("Cargo must provide the mock ACP binary path");
    AcpAgent::from_args([binary, "--scenario".to_string(), scenario.to_string()])
        .expect("mock agent command must be valid")
}

async fn turn(scenario: &str, prompt: &str, activity: Arc<Mutex<Vec<String>>>) -> String {
    let (_cancel_tx, cancel_rx) = watch::channel(false);
    let result = run_acp_turn(
        mock_agent(scenario),
        AcpTurnInput {
            cwd: std::env::current_dir().expect("current directory"),
            prompt: prompt.to_string(),
            model: None,
            existing_session_id: None,
        },
        cancel_rx,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(move |label| {
            activity
                .lock()
                .expect("activity lock")
                .push(label.to_string())
        }),
        Arc::new(|request| Box::pin(async move { auto_permission_for_tests(&request.options) })),
    )
    .await
    .expect("mock ACP turn should succeed");
    result.text
}

#[tokio::test]
async fn mock_acp_echo_streams_the_prompt_response() {
    let text = turn(
        "echo",
        "hello from integration test",
        Arc::new(Mutex::new(Vec::new())),
    )
    .await;
    assert!(text.contains("Mock agent reply: hello from integration test"));
}

#[tokio::test]
async fn mock_acp_permission_tool_race_keeps_the_tool_update() {
    let activity = Arc::new(Mutex::new(Vec::new()));
    let text = turn("permission_tool_race", "approve this", activity.clone()).await;
    assert!(text.contains("Mock agent reply: approve this"));
    assert!(
        activity
            .lock()
            .expect("activity lock")
            .iter()
            .any(|label| label.contains("Tool") || label.contains("InProgress")),
        "the tool update sent alongside the permission request was not observed"
    );
}

#[tokio::test]
async fn mock_acp_cancel_coop_returns_cancelled() {
    let (cancel_tx, cancel_rx) = watch::channel(false);
    let result = run_acp_turn(
        mock_agent("cancel_coop"),
        AcpTurnInput {
            cwd: std::env::current_dir().expect("current directory"),
            prompt: "please cancel".to_string(),
            model: None,
            existing_session_id: None,
        },
        cancel_rx,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
        Arc::new(move |activity| {
            if activity == "Thinking…" {
                let _ = cancel_tx.send(true);
            }
        }),
        Arc::new(|request| Box::pin(async move { auto_permission_for_tests(&request.options) })),
    )
    .await
    .expect("cancel_coop ACP turn should succeed");
    assert_eq!(result.stop_reason, StopReason::Cancelled);
}
