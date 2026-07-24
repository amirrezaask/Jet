use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();
    let mut stdout = tokio::io::stdout();
    let mut held_response: Option<(Value, Value)> = None;
    let mut pending_codex_turn: Option<(String, String)> = None;

    while let Some(line) = lines.next_line().await? {
        let message: Value = serde_json::from_str(&line)?;
        let Some(method) = message.get("method").and_then(Value::as_str) else {
            if message.get("id").and_then(Value::as_str) == Some("mock-codex-permission") {
                if let Some((thread_id, turn_id)) = pending_codex_turn.take() {
                    let decision = message
                        .pointer("/result/decision")
                        .and_then(Value::as_str)
                        .unwrap_or("missing");
                    write_message(
                        &mut stdout,
                        &json!({
                            "method": "item/agentMessage/delta",
                            "params": {
                                "threadId": thread_id,
                                "turnId": turn_id,
                                "itemId": "mock-message",
                                "delta": format!("permission {decision}")
                            }
                        }),
                    )
                    .await?;
                    write_message(
                        &mut stdout,
                        &json!({
                            "method": "turn/completed",
                            "params": {
                                "threadId": thread_id,
                                "turn": {
                                    "id": turn_id,
                                    "status": "completed"
                                }
                            }
                        }),
                    )
                    .await?;
                }
            }
            continue;
        };
        let id = message.get("id").cloned();
        let params = message.get("params").cloned().unwrap_or(Value::Null);

        match method {
            "initialize" => {
                if let Some(id) = id {
                    write_message(
                        &mut stdout,
                        &json!({
                            "id": id,
                            "result": {
                                "userAgent": "gharargah-mock-line-rpc",
                                "codexHome": "/tmp/mock-codex-home",
                                "platformFamily": "unix",
                                "platformOs": "test"
                            }
                        }),
                    )
                    .await?;
                }
            }
            "initialized" => {
                write_message(
                    &mut stdout,
                    &json!({
                        "method": "mock/initialized",
                        "params": {
                            "receivedParams": message.get("params").is_some()
                        }
                    }),
                )
                .await?;
            }
            "thread/start" | "thread/resume" => {
                if let Some(id) = id {
                    let thread_id = params
                        .get("threadId")
                        .and_then(Value::as_str)
                        .unwrap_or("mock-codex-thread");
                    write_message(
                        &mut stdout,
                        &json!({
                            "id": id,
                            "result": {
                                "thread": { "id": thread_id },
                                "model": "mock-model",
                                "modelProvider": "mock"
                            }
                        }),
                    )
                    .await?;
                }
            }
            "turn/start" => {
                if let Some(id) = id {
                    let thread_id = params
                        .get("threadId")
                        .and_then(Value::as_str)
                        .unwrap_or("mock-codex-thread");
                    let turn_id = "mock-codex-turn";
                    write_message(
                        &mut stdout,
                        &json!({
                            "id": id,
                            "result": {
                                "turn": {
                                    "id": turn_id,
                                    "status": "inProgress"
                                }
                            }
                        }),
                    )
                    .await?;
                    let requests_permission = params
                        .get("input")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .any(|input| {
                            input.get("text").and_then(Value::as_str) == Some("request permission")
                        });
                    if requests_permission {
                        pending_codex_turn = Some((thread_id.to_string(), turn_id.to_string()));
                        write_message(
                            &mut stdout,
                            &json!({
                                "id": "mock-codex-permission",
                                "method": "item/commandExecution/requestApproval",
                                "params": {
                                    "threadId": thread_id,
                                    "turnId": turn_id,
                                    "itemId": "mock-command",
                                    "reason": "test command"
                                }
                            }),
                        )
                        .await?;
                        continue;
                    }
                    write_message(
                        &mut stdout,
                        &json!({
                            "method": "item/agentMessage/delta",
                            "params": {
                                "threadId": thread_id,
                                "turnId": turn_id,
                                "itemId": "mock-message",
                                "delta": "mock codex reply"
                            }
                        }),
                    )
                    .await?;
                    write_message(
                        &mut stdout,
                        &json!({
                            "method": "turn/completed",
                            "params": {
                                "threadId": thread_id,
                                "turn": {
                                    "id": turn_id,
                                    "status": "completed"
                                }
                            }
                        }),
                    )
                    .await?;
                }
            }
            "turn/interrupt" => {
                if let Some(id) = id {
                    write_message(&mut stdout, &json!({ "id": id, "result": {} })).await?;
                }
            }
            "echo" => {
                if let Some(id) = id {
                    write_message(&mut stdout, &json!({ "id": id, "result": params })).await?;
                }
            }
            "remote_error" => {
                if let Some(id) = id {
                    write_message(
                        &mut stdout,
                        &json!({
                            "id": id,
                            "error": {
                                "code": -32042,
                                "message": "mock remote error",
                                "data": { "retryable": false }
                            }
                        }),
                    )
                    .await?;
                }
            }
            "events" => {
                write_message(
                    &mut stdout,
                    &json!({
                        "method": "mock/progress",
                        "params": { "percent": 50 }
                    }),
                )
                .await?;
                write_message(
                    &mut stdout,
                    &json!({
                        "id": "server-request-1",
                        "method": "mock/approve",
                        "params": { "action": "read" }
                    }),
                )
                .await?;
                if let Some(id) = id {
                    write_message(
                        &mut stdout,
                        &json!({ "id": id, "result": { "queued": true } }),
                    )
                    .await?;
                }
            }
            "delay" => {
                let delay_ms = params.get("delayMs").and_then(Value::as_u64).unwrap_or(100);
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                if let Some(id) = id {
                    write_message(
                        &mut stdout,
                        &json!({ "id": id, "result": { "delayed": true } }),
                    )
                    .await?;
                }
            }
            "hold" => {
                if let Some(id) = id {
                    held_response = Some((id, params));
                    write_message(&mut stdout, &json!({ "method": "mock/held", "params": {} }))
                        .await?;
                }
            }
            "release" => {
                if let Some(id) = id {
                    write_message(&mut stdout, &json!({ "id": id, "result": params })).await?;
                }
                if let Some((held_id, held_params)) = held_response.take() {
                    write_message(
                        &mut stdout,
                        &json!({ "id": held_id, "result": held_params }),
                    )
                    .await?;
                }
            }
            "exit" => break,
            _ => {
                if let Some(id) = id {
                    write_message(
                        &mut stdout,
                        &json!({
                            "id": id,
                            "error": { "code": -32601, "message": "method not found" }
                        }),
                    )
                    .await?;
                }
            }
        }
    }

    Ok(())
}

async fn write_message(
    stdout: &mut tokio::io::Stdout,
    value: &Value,
) -> Result<(), Box<dyn std::error::Error>> {
    stdout
        .write_all(serde_json::to_string(value)?.as_bytes())
        .await?;
    stdout.write_all(b"\n").await?;
    stdout.flush().await?;
    Ok(())
}
