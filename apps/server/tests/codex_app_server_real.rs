//! Opt-in real Codex app-server smoke (`GHARARGAH_CODEX_APP_SERVER_REAL=1`).
//!
//! Requires `codex` on PATH and an authenticated Codex CLI session.

use jet_server::host::line_rpc::LineRpcClient;
use serde_json::json;
use std::{env, time::Duration};

fn enabled() -> bool {
    matches!(
        env::var("GHARARGAH_CODEX_APP_SERVER_REAL").as_deref(),
        Ok("1") | Ok("true") | Ok("yes")
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_codex_app_server_initialize_thread_and_turn() {
    if !enabled() {
        eprintln!("skip: set GHARARGAH_CODEX_APP_SERVER_REAL=1 to run");
        return;
    }

    let workspace = tempfile::tempdir().expect("create temporary workspace");
    std::fs::write(
        workspace.path().join("README.md"),
        "# Codex app-server smoke\n",
    )
    .expect("write fixture");
    let client = LineRpcClient::spawn("codex", &["app-server".to_string()], workspace.path(), &[])
        .expect("start codex app-server");
    let mut notifications = client.subscribe_notifications();
    let mut server_requests = client.take_server_requests().expect("take server requests");

    let request_handler = tokio::spawn(async move {
        while let Some(request) = server_requests.recv().await {
            request
                .reject(
                    -32_000,
                    "live smoke test does not approve interactive requests",
                    None,
                )
                .await
                .expect("reject interactive request");
        }
    });

    let initialized = client
        .request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "gharargah_test",
                    "title": "Gharargah Test",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {
                    "experimentalApi": true
                }
            }),
            Duration::from_secs(15),
        )
        .await
        .expect("initialize codex app-server");
    assert!(
        initialized
            .get("userAgent")
            .and_then(|value| value.as_str())
            .is_some(),
        "initialize response omitted userAgent: {initialized}"
    );
    client
        .notify_without_params("initialized")
        .await
        .expect("send initialized notification");

    let opened = client
        .request(
            "thread/start",
            json!({
                "cwd": workspace.path(),
                "approvalPolicy": "untrusted",
                "sandbox": "read-only",
                "approvalsReviewer": "user",
                "ephemeral": true
            }),
            Duration::from_secs(30),
        )
        .await
        .expect("start codex thread");
    let thread_id = opened
        .pointer("/thread/id")
        .and_then(|value| value.as_str())
        .expect("thread/start response omitted thread.id")
        .to_string();

    let started = client
        .request(
            "turn/start",
            json!({
                "threadId": thread_id,
                "input": [{
                    "type": "text",
                    "text": "Reply with exactly: gharargah-codex-app-server-ok"
                }],
                "approvalPolicy": "untrusted",
                "approvalsReviewer": "user",
                "sandboxPolicy": {
                    "type": "readOnly"
                }
            }),
            Duration::from_secs(30),
        )
        .await
        .expect("start codex turn");
    let turn_id = started
        .pointer("/turn/id")
        .and_then(|value| value.as_str())
        .expect("turn/start response omitted turn.id")
        .to_string();

    let (text, completed_turn) = tokio::time::timeout(Duration::from_secs(180), async {
        let mut text = String::new();
        loop {
            let notification = notifications
                .recv()
                .await
                .expect("codex notification stream closed");
            if notification.method == "item/agentMessage/delta"
                && notification
                    .params
                    .get("turnId")
                    .and_then(|value| value.as_str())
                    == Some(turn_id.as_str())
            {
                if let Some(delta) = notification
                    .params
                    .get("delta")
                    .and_then(|value| value.as_str())
                {
                    text.push_str(delta);
                }
            }
            if notification.method == "turn/completed"
                && notification
                    .params
                    .pointer("/turn/id")
                    .and_then(|value| value.as_str())
                    == Some(turn_id.as_str())
            {
                break (
                    text,
                    notification.params.get("turn").cloned().unwrap_or_default(),
                );
            }
        }
    })
    .await
    .expect("codex turn timed out");

    let status = completed_turn
        .get("status")
        .and_then(|value| value.as_str());
    if status == Some("failed")
        && completed_turn
            .pointer("/error/codexErrorInfo")
            .and_then(|value| value.as_str())
            == Some("usageLimitExceeded")
    {
        eprintln!(
            "Codex app-server transport completed the live turn lifecycle; account usage limit \
             prevented model output: {completed_turn}"
        );
        client.stop().await;
        request_handler.abort();
        return;
    }
    assert_eq!(
        status,
        Some("completed"),
        "Codex turn did not complete: {completed_turn}"
    );
    assert!(
        text.to_lowercase()
            .contains("gharargah-codex-app-server-ok"),
        "expected Codex reply, got: {text}"
    );

    client.stop().await;
    request_handler.abort();
}
