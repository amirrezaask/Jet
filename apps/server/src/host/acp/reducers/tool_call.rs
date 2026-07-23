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

pub fn reduce(state: &mut ToolCalls, update: ToolCallState) {
    let current = state.calls.entry(update.id.clone()).or_default();
    current.id = update.id;
    if update.title.is_some() {
        current.title = update.title;
    }
    if update.detail.is_some() {
        current.detail = update.detail;
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
}
