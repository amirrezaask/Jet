use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCallStatus {
    #[default]
    Pending,
    InProgress,
    Completed,
    Failed,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct ToolCallState {
    pub id: String,
    pub title: Option<String>,
    pub status: ToolCallStatus,
    pub detail: Option<Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct ToolCalls {
    pub calls: BTreeMap<String, ToolCallState>,
}

fn merge_detail(current: &mut Value, update: Value) {
    match (current, update) {
        (Value::Object(current), Value::Object(update)) => {
            for (key, value) in update {
                current.insert(key, value);
            }
        }
        (current, update) => *current = update,
    }
}

pub fn reduce(state: &mut ToolCalls, update: ToolCallState) {
    let current = state.calls.entry(update.id.clone()).or_default();
    current.id = update.id;
    if update.title.is_some() {
        current.title = update.title;
    }
    if let Some(detail) = update.detail {
        if let Some(current_detail) = current.detail.as_mut() {
            merge_detail(current_detail, detail);
        } else {
            current.detail = Some(detail);
        }
    }
    current.status = update.status;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn merges_partial_update_without_losing_title() {
        let mut calls = ToolCalls::default();
        reduce(
            &mut calls,
            ToolCallState {
                id: "a".into(),
                title: Some("run".into()),
                status: ToolCallStatus::Pending,
                detail: None,
            },
        );
        reduce(
            &mut calls,
            ToolCallState {
                id: "a".into(),
                title: None,
                status: ToolCallStatus::InProgress,
                detail: None,
            },
        );
        assert_eq!(calls.calls["a"].title.as_deref(), Some("run"));
        assert_eq!(calls.calls["a"].status, ToolCallStatus::InProgress);
    }
    #[test]
    fn independent_ids_are_deterministically_keyed() {
        let mut calls = ToolCalls::default();
        reduce(
            &mut calls,
            ToolCallState {
                id: "b".into(),
                ..Default::default()
            },
        );
        reduce(
            &mut calls,
            ToolCallState {
                id: "a".into(),
                ..Default::default()
            },
        );
        assert_eq!(calls.calls.keys().next().map(String::as_str), Some("a"));
    }

    #[test]
    fn partial_update_keeps_tool_input_kind_and_location() {
        let mut calls = ToolCalls::default();
        reduce(
            &mut calls,
            ToolCallState {
                id: "read-1".into(),
                title: Some("Read File".into()),
                status: ToolCallStatus::InProgress,
                detail: Some(serde_json::json!({
                    "kind": "read",
                    "rawInput": { "path": "/workspace/src/main.rs" },
                    "locations": [{ "path": "/workspace/src/main.rs" }],
                })),
            },
        );
        reduce(
            &mut calls,
            ToolCallState {
                id: "read-1".into(),
                title: None,
                status: ToolCallStatus::Completed,
                detail: Some(serde_json::json!({
                    "status": "completed",
                    "rawOutput": "fn main() {}",
                })),
            },
        );

        let detail = calls.calls["read-1"].detail.as_ref().unwrap();
        assert_eq!(detail["kind"], "read");
        assert_eq!(detail["rawInput"]["path"], "/workspace/src/main.rs");
        assert_eq!(detail["rawOutput"], "fn main() {}");
    }
}
