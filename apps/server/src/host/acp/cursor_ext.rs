//! Cursor ACP extension methods (`cursor/*`) — not part of core ACP schema.

use agent_client_protocol::{JsonRpcNotification, JsonRpcRequest, JsonRpcResponse};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, JsonRpcRequest)]
#[request(method = "cursor/ask_question", response = CursorAskQuestionResponse)]
pub struct CursorAskQuestionRequest {
    #[serde(rename = "toolCallId")]
    pub tool_call_id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub questions: Vec<CursorAskQuestion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorAskQuestion {
    pub id: String,
    pub prompt: String,
    #[serde(default)]
    pub allow_multiple: Option<bool>,
    #[serde(default)]
    pub options: Vec<CursorAskOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorAskOption {
    pub label: String,
    #[serde(default)]
    pub id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonRpcResponse)]
pub struct CursorAskQuestionResponse {
    pub answers: Vec<CursorAskAnswer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorAskAnswer {
    #[serde(rename = "questionId")]
    pub question_id: String,
    /// Selected option labels (or free-text when no options).
    pub selected: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonRpcRequest)]
#[request(method = "cursor/create_plan", response = CursorCreatePlanResponse)]
pub struct CursorCreatePlanRequest {
    #[serde(rename = "toolCallId")]
    pub tool_call_id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub overview: Option<String>,
    pub plan: String,
    #[serde(default)]
    pub todos: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonRpcResponse)]
pub struct CursorCreatePlanResponse {
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonRpcRequest)]
#[request(method = "cursor/list_available_models", response = CursorListAvailableModelsResponse)]
pub struct CursorListAvailableModelsRequest {}

#[derive(Debug, Clone, Serialize, Deserialize, JsonRpcResponse)]
pub struct CursorListAvailableModelsResponse {
    #[serde(default)]
    pub models: Vec<CursorAvailableModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorAvailableModel {
    pub value: String,
    pub name: String,
    #[serde(default, rename = "configOptions")]
    pub config_options: Option<Vec<Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonRpcNotification)]
#[notification(method = "cursor/update_todos")]
pub struct CursorUpdateTodosNotification {
    #[serde(rename = "toolCallId")]
    pub tool_call_id: String,
    #[serde(default)]
    pub todos: Vec<Value>,
    #[serde(default)]
    pub merge: Option<bool>,
}

impl CursorAskQuestionRequest {
    pub fn to_user_input_payload(&self, request_id: &str) -> Value {
        serde_json::json!({
            "id": request_id,
            "kind": "ask_question",
            "source": "cursor/ask_question",
            "title": self.title.clone().unwrap_or_else(|| "Questions".to_string()),
            "toolCallId": self.tool_call_id,
            "questions": self.questions.iter().map(|q| {
                serde_json::json!({
                    "id": q.id,
                    "prompt": q.prompt,
                    "allowMultiple": q.allow_multiple.unwrap_or(false),
                    "options": q.options.iter().map(|o| {
                        serde_json::json!({
                            "id": o.id.clone().unwrap_or_else(|| o.label.clone()),
                            "label": o.label,
                        })
                    }).collect::<Vec<_>>(),
                })
            }).collect::<Vec<_>>(),
            "createdAt": chrono::Utc::now().to_rfc3339(),
        })
    }
}

impl CursorCreatePlanRequest {
    pub fn to_plan_payload(&self) -> Value {
        todos_to_plan_payload(
            &self.tool_call_id,
            &self.plan,
            self.name.as_deref(),
            self.overview.as_deref(),
            &self.todos,
        )
    }
}

impl CursorUpdateTodosNotification {
    pub fn to_plan_payload(&self) -> Value {
        todos_to_plan_payload(&self.tool_call_id, "", None, None, &self.todos)
    }
}

fn todos_to_plan_payload(
    plan_id: &str,
    plan_markdown: &str,
    name: Option<&str>,
    overview: Option<&str>,
    todos: &[Value],
) -> Value {
    let entries: Vec<Value> = todos
        .iter()
        .enumerate()
        .filter_map(|(index, todo)| {
            let label = todo
                .get("content")
                .or_else(|| todo.get("title"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            if label.is_empty() {
                return None;
            }
            let status = match todo.get("status").and_then(Value::as_str).unwrap_or("") {
                "completed" => "completed",
                "in_progress" | "in-progress" => "in_progress",
                "failed" => "failed",
                _ => "pending",
            };
            Some(serde_json::json!({
                "id": todo.get("id").and_then(Value::as_str).unwrap_or(&format!("todo-{index}")),
                "label": label,
                "status": status,
            }))
        })
        .collect();
    let mut markdown = plan_markdown.to_string();
    if let Some(name) = name {
        if !markdown.contains(name) {
            markdown = format!("# {name}\n\n{markdown}");
        }
    }
    if let Some(overview) = overview {
        if !overview.is_empty() && !markdown.contains(overview) {
            markdown = format!("{markdown}\n\n{overview}");
        }
    }
    if markdown.trim().is_empty() {
        markdown = entries
            .iter()
            .filter_map(|entry| entry.get("label").and_then(Value::as_str))
            .map(|label| format!("- {label}"))
            .collect::<Vec<_>>()
            .join("\n");
    }
    serde_json::json!({
        "id": plan_id,
        "entries": entries,
        "markdown": markdown,
        "updatedAt": chrono::Utc::now().to_rfc3339(),
    })
}
