use jet_server::host::claude_sdk::{
    ClaudePermissionMode, ClaudeProcessOptions, ClaudeSdkError, ClaudeSdkProcess,
};
use serde_json::json;
use std::{path::PathBuf, time::Duration};

fn mock_binary() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_gharargah-mock-claude-sdk"))
}

fn options() -> ClaudeProcessOptions {
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
async fn initializes_and_streams_sdk_messages() {
    let process = ClaudeSdkProcess::spawn(&options()).expect("spawn mock Claude SDK");
    let mut messages = process.subscribe_messages();
    let initialize = process
        .initialize(Duration::from_secs(2))
        .await
        .expect("initialize");
    assert_eq!(initialize["models"][0]["value"], "mock-sonnet");

    process
        .send_user_message(json!("hello"), "default")
        .await
        .expect("send prompt");

    let mut delta = String::new();
    let session_id = loop {
        let message = tokio::time::timeout(Duration::from_secs(2), messages.recv())
            .await
            .expect("message timeout")
            .expect("message");
        if message["type"] == "stream_event"
            && message["event"]["type"] == "content_block_delta"
        {
            delta.push_str(message["event"]["delta"]["text"].as_str().unwrap_or(""));
        }
        if message["type"] == "result" {
            break message["session_id"].as_str().map(str::to_string);
        }
    };
    assert_eq!(delta, "mock:hello");
    assert_eq!(
        session_id.as_deref(),
        Some("11111111-1111-4111-8111-111111111111")
    );
    process.stop().await;
}

#[tokio::test]
async fn handles_provider_permission_control_request() {
    let process = ClaudeSdkProcess::spawn(&options()).expect("spawn mock Claude SDK");
    let mut messages = process.subscribe_messages();
    let mut controls = process.take_control_requests().expect("control receiver");
    process
        .initialize(Duration::from_secs(2))
        .await
        .expect("initialize");
    process
        .send_user_message(json!("permission"), "default")
        .await
        .expect("send prompt");

    let request = tokio::time::timeout(Duration::from_secs(2), controls.recv())
        .await
        .expect("permission timeout")
        .expect("permission request");
    assert_eq!(request.subtype(), Some("can_use_tool"));
    assert_eq!(request.request["tool_name"], "Bash");
    request
        .respond(json!({
            "behavior": "allow",
            "updatedInput": {"command": "echo hello"},
        }))
        .await
        .expect("permission response");

    loop {
        let message = tokio::time::timeout(Duration::from_secs(2), messages.recv())
            .await
            .expect("message timeout")
            .expect("message");
        if message["type"] == "result" {
            assert_eq!(message["result"], "permission:allow");
            break;
        }
    }
    process.stop().await;
}

#[tokio::test]
async fn correlates_out_of_order_control_responses() {
    let process = ClaudeSdkProcess::spawn(&options()).expect("spawn mock Claude SDK");
    process
        .initialize(Duration::from_secs(2))
        .await
        .expect("initialize");
    let held = process.control_request(json!({"subtype": "hold"}), Duration::from_secs(2));
    let released = process.control_request(json!({"subtype": "release"}), Duration::from_secs(2));
    let (held, released) = tokio::join!(held, released);
    assert_eq!(held.expect("held response")["held"], true);
    assert_eq!(released.expect("release response")["released"], true);
    process.stop().await;
}

#[tokio::test]
async fn reports_remote_errors_and_process_close() {
    let process = ClaudeSdkProcess::spawn(&options()).expect("spawn mock Claude SDK");
    process
        .initialize(Duration::from_secs(2))
        .await
        .expect("initialize");
    let error = process
        .control_request(json!({"subtype": "unknown"}), Duration::from_secs(2))
        .await
        .expect_err("remote error");
    assert!(matches!(error, ClaudeSdkError::Remote(_)));
    process.stop().await;
    assert!(matches!(
        process
            .control_request(json!({"subtype": "initialize"}), Duration::from_secs(1))
            .await,
        Err(ClaudeSdkError::Closed)
    ));
}
