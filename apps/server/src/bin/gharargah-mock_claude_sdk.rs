use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

fn send(value: Value) {
    println!("{}", serde_json::to_string(&value).expect("serialize mock message"));
    io::stdout().flush().expect("flush mock stdout");
}

fn success(request_id: &str, response: Value) {
    send(json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": response,
        }
    }));
}

fn main() {
    let stdin = io::stdin();
    let mut initialized = false;
    let mut session_id = "11111111-1111-4111-8111-111111111111".to_string();
    let mut pending_permission: Option<String> = None;
    let mut turn_count = 0_u64;

    for line in stdin.lock().lines() {
        let Ok(line) = line else {
            break;
        };
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match message.get("type").and_then(Value::as_str) {
            Some("control_request") => {
                let request_id = message
                    .get("request_id")
                    .and_then(Value::as_str)
                    .unwrap_or("missing");
                let request = message.get("request").cloned().unwrap_or(Value::Null);
                match request.get("subtype").and_then(Value::as_str) {
                    Some("initialize") => {
                        initialized = true;
                        success(
                            request_id,
                            json!({
                                "commands": [{"name": "compact", "description": "Compact context"}],
                                "models": [{"value": "mock-sonnet", "displayName": "Mock Sonnet"}],
                                "account": {"email": "mock@example.com"},
                            }),
                        );
                    }
                    Some("interrupt") => {
                        success(request_id, json!({}));
                        send(json!({
                            "type": "result",
                            "subtype": "error_during_execution",
                            "duration_ms": 1,
                            "duration_api_ms": 0,
                            "is_error": false,
                            "num_turns": 1,
                            "session_id": session_id,
                            "errors": ["Interrupted by user"],
                        }));
                    }
                    Some("set_permission_mode") | Some("set_model") => {
                        success(request_id, json!({}));
                    }
                    Some("hold") => {
                        pending_permission = Some(request_id.to_string());
                    }
                    Some("release") => {
                        success(request_id, json!({"released": true}));
                        if let Some(held) = pending_permission.take() {
                            success(&held, json!({"held": true}));
                        }
                    }
                    Some(other) => {
                        send(json!({
                            "type": "control_response",
                            "response": {
                                "subtype": "error",
                                "request_id": request_id,
                                "error": format!("unsupported control request: {other}"),
                            }
                        }));
                    }
                    None => {}
                }
            }
            Some("control_response") => {
                let response = message.get("response").cloned().unwrap_or(Value::Null);
                let decision = response
                    .get("response")
                    .and_then(|response| response.get("behavior"))
                    .and_then(Value::as_str)
                    .unwrap_or("missing");
                send(json!({
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [{"type": "text", "text": format!("permission:{decision}")}],
                    },
                    "session_id": session_id,
                }));
                send(json!({
                    "type": "result",
                    "subtype": "success",
                    "duration_ms": 2,
                    "duration_api_ms": 1,
                    "is_error": false,
                    "num_turns": 1,
                    "session_id": session_id,
                    "result": format!("permission:{decision}"),
                    "usage": {"input_tokens": 2, "output_tokens": 1},
                    "total_cost_usd": 0.001,
                }));
            }
            Some("user") if initialized => {
                turn_count += 1;
                if let Some(requested) = message.get("session_id").and_then(Value::as_str) {
                    if requested != "default" && !requested.is_empty() {
                        session_id = requested.to_string();
                    }
                }
                let content = message
                    .pointer("/message/content")
                    .cloned()
                    .unwrap_or(Value::Null);
                let text = if let Some(text) = content.as_str() {
                    text.to_string()
                } else {
                    content
                        .as_array()
                        .and_then(|blocks| {
                            blocks.iter().find_map(|block| {
                                block.get("text").and_then(Value::as_str).map(str::to_string)
                            })
                        })
                        .unwrap_or_default()
                };
                send(json!({
                    "type": "system",
                    "subtype": "init",
                    "session_id": session_id,
                    "model": "mock-sonnet",
                    "permissionMode": "default",
                    "tools": ["Read", "Edit", "Bash"],
                }));
                if text == "permission" {
                    send(json!({
                        "type": "control_request",
                        "request_id": "permission-1",
                        "request": {
                            "subtype": "can_use_tool",
                            "tool_name": "Bash",
                            "input": {"command": "echo hello"},
                            "tool_use_id": "tool-1",
                            "permission_suggestions": [{
                                "type": "addRules",
                                "rules": [{"toolName": "Bash", "ruleContent": "echo:*"}],
                                "behavior": "allow",
                                "destination": "session",
                            }],
                            "title": "Claude wants to run a command",
                            "display_name": "Run command",
                            "description": "echo hello",
                        }
                    }));
                    continue;
                }
                if text == "wait" {
                    continue;
                }
                let response_text = if text == "process-count" {
                    format!("process-turn:{turn_count}")
                } else {
                    format!("mock:{text}")
                };
                send(json!({
                    "type": "stream_event",
                    "uuid": "assistant-1",
                    "session_id": session_id,
                    "event": {
                        "type": "content_block_start",
                        "index": 0,
                        "content_block": {"type": "text", "text": ""},
                    }
                }));
                send(json!({
                    "type": "stream_event",
                    "uuid": "assistant-1",
                    "session_id": session_id,
                    "event": {
                        "type": "content_block_delta",
                        "index": 0,
                        "delta": {"type": "text_delta", "text": response_text},
                    }
                }));
                send(json!({
                    "type": "stream_event",
                    "uuid": "assistant-1",
                    "session_id": session_id,
                    "event": {"type": "content_block_stop", "index": 0},
                }));
                send(json!({
                    "type": "assistant",
                    "uuid": "assistant-1",
                    "message": {
                        "role": "assistant",
                        "content": [{"type": "text", "text": response_text}],
                    },
                    "session_id": session_id,
                }));
                send(json!({
                    "type": "result",
                    "subtype": "success",
                    "duration_ms": 2,
                    "duration_api_ms": 1,
                    "is_error": false,
                    "num_turns": 1,
                    "session_id": session_id,
                    "result": response_text,
                    "usage": {"input_tokens": 2, "output_tokens": 1},
                    "modelUsage": {
                        "mock-sonnet": {
                            "inputTokens": 2,
                            "outputTokens": 1,
                            "contextWindow": 200000,
                            "costUSD": 0.001,
                        }
                    },
                    "total_cost_usd": 0.001,
                }));
            }
            _ => {}
        }
    }
}
