use jet_server::host::line_rpc::{LineRpcClient, LineRpcError};
use serde_json::json;
use std::time::Duration;

fn spawn_mock() -> (tempfile::TempDir, LineRpcClient) {
    let workspace = tempfile::tempdir().expect("create temporary workspace");
    let executable = env!("CARGO_BIN_EXE_gharargah-mock-line-rpc");
    let client = LineRpcClient::spawn(executable, &[], workspace.path(), &[])
        .expect("start mock line RPC process");
    (workspace, client)
}

#[tokio::test]
async fn routes_responses_notifications_and_server_requests() {
    let (_workspace, client) = spawn_mock();
    let mut notifications = client.subscribe_notifications();
    let mut server_requests = client
        .take_server_requests()
        .expect("take server request receiver");

    let echoed = client
        .request(
            "echo",
            json!({ "message": "hello" }),
            Duration::from_secs(2),
        )
        .await
        .expect("echo response");
    assert_eq!(echoed, json!({ "message": "hello" }));

    let event_result = client
        .request("events", json!({}), Duration::from_secs(2))
        .await
        .expect("events response");
    assert_eq!(event_result, json!({ "queued": true }));

    let notification = tokio::time::timeout(Duration::from_secs(2), notifications.recv())
        .await
        .expect("notification timeout")
        .expect("notification channel closed");
    assert_eq!(notification.method, "mock/progress");
    assert_eq!(notification.params, json!({ "percent": 50 }));

    let request = tokio::time::timeout(Duration::from_secs(2), server_requests.recv())
        .await
        .expect("server request timeout")
        .expect("server request channel closed");
    assert_eq!(request.method, "mock/approve");
    assert_eq!(request.params, json!({ "action": "read" }));
    request
        .respond(json!({ "decision": "approved" }))
        .await
        .expect("respond to server request");

    client.stop().await;
    assert!(client.is_closed());
}

#[tokio::test]
async fn supports_parameterless_notifications_used_by_codex_app_server() {
    let (_workspace, client) = spawn_mock();
    let mut notifications = client.subscribe_notifications();

    client
        .notify_without_params("initialized")
        .await
        .expect("send parameterless notification");
    let notification = tokio::time::timeout(Duration::from_secs(2), notifications.recv())
        .await
        .expect("notification timeout")
        .expect("notification channel closed");
    assert_eq!(notification.method, "mock/initialized");
    assert_eq!(
        notification.params,
        json!({ "receivedParams": false }),
        "Codex initialized notification must omit params"
    );

    client.stop().await;
}

#[tokio::test]
async fn correlates_concurrent_responses_that_arrive_out_of_order() {
    let (_workspace, client) = spawn_mock();
    let mut notifications = client.subscribe_notifications();
    let held_client = client.clone();
    let held = tokio::spawn(async move {
        held_client
            .request("hold", json!({ "order": 1 }), Duration::from_secs(2))
            .await
    });

    let held_notification = tokio::time::timeout(Duration::from_secs(2), notifications.recv())
        .await
        .expect("held notification timeout")
        .expect("notification channel closed");
    assert_eq!(held_notification.method, "mock/held");

    let released = client
        .request("release", json!({ "order": 2 }), Duration::from_secs(2))
        .await
        .expect("release response");
    assert_eq!(released, json!({ "order": 2 }));
    assert_eq!(
        held.await
            .expect("held task panicked")
            .expect("held response"),
        json!({ "order": 1 })
    );

    client.stop().await;
}

#[tokio::test]
async fn exposes_remote_errors_and_enforces_request_timeouts() {
    let (_workspace, client) = spawn_mock();

    let error = client
        .request("remote_error", json!({}), Duration::from_secs(2))
        .await
        .expect_err("remote error expected");
    match error {
        LineRpcError::Remote(remote) => {
            assert_eq!(remote.code, -32042);
            assert_eq!(remote.message, "mock remote error");
            assert_eq!(remote.data, Some(json!({ "retryable": false })));
        }
        other => panic!("unexpected error: {other}"),
    }

    let error = client
        .request(
            "delay",
            json!({ "delayMs": 250 }),
            Duration::from_millis(25),
        )
        .await
        .expect_err("timeout expected");
    assert_eq!(
        error,
        LineRpcError::Timeout {
            method: "delay".to_string()
        }
    );

    client.stop().await;
}

#[tokio::test]
async fn process_exit_fails_pending_requests_and_closes_transport() {
    let (_workspace, client) = spawn_mock();
    let error = client
        .request("exit", json!({}), Duration::from_secs(2))
        .await
        .expect_err("process exit should fail request");
    assert_eq!(error, LineRpcError::Closed);

    tokio::time::timeout(Duration::from_secs(2), async {
        while !client.is_closed() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("transport did not close");
}
