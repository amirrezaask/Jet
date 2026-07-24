//! Permission helpers shared by ACP orchestration.

use serde_json::{json, Value};

pub fn permission_tool_kind(permission: &Value) -> String {
    permission
        .pointer("/toolCall/fields/kind")
        .or_else(|| permission.pointer("/toolCall/kind"))
        .or_else(|| permission.get("kind"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase()
}

pub fn permission_is_file_mutation(permission: &Value) -> bool {
    let kind = permission_tool_kind(permission);
    if matches!(
        kind.as_str(),
        "edit" | "delete" | "move" | "write" | "write_text_file" | "create" | "patch"
    ) {
        return true;
    }
    let title = permission
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    let haystack = format!("{kind} {title}");
    [
        "edit",
        "write",
        "delete",
        "move",
        "rename",
        "create file",
        "apply_patch",
        "apply patch",
        "write_text_file",
        "fs/write",
    ]
    .iter()
    .any(|needle| haystack.contains(needle))
}

pub fn auto_approve_permission_option(permission: &Value) -> Option<String> {
    let options = permission
        .get("options")
        .or_else(|| permission.get("optionIds"))
        .and_then(Value::as_array)?;
    for preferred in ["allow_always", "allow_once", "allow"] {
        for option in options {
            let kind = option
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_ascii_lowercase();
            if kind == preferred || kind.replace('-', "_") == preferred {
                return option.get("id").and_then(Value::as_str).map(str::to_string);
            }
        }
    }
    None
}

pub fn mark_permission_denied_in_thread(
    thread: &mut Value,
    request_id: &str,
    pending_permission: &Option<Value>,
) {
    let tool_id = pending_permission
        .as_ref()
        .and_then(|pending| {
            pending
                .pointer("/toolCall/toolCallId")
                .or_else(|| pending.pointer("/toolCall/id"))
                .or_else(|| pending.pointer("/toolCall/fields/toolCallId"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default();
    if let Some(timeline) = thread.get_mut("timeline").and_then(Value::as_array_mut) {
        for item in timeline.iter_mut() {
            let kind = item
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if kind == "permission"
                && (item.get("id").and_then(Value::as_str) == Some(request_id)
                    || item.pointer("/permission/id").and_then(Value::as_str) == Some(request_id))
            {
                if let Some(permission) = item.get_mut("permission") {
                    permission["status"] = json!("rejected");
                }
                item["status"] = json!("rejected");
            }
            if kind == "tool_call" && !tool_id.is_empty() {
                let item_tool_id = item
                    .pointer("/toolCall/id")
                    .or_else(|| item.pointer("/toolCall/toolCallId"))
                    .and_then(Value::as_str)
                    .map(str::to_string);
                if item_tool_id.as_deref() == Some(tool_id.as_str()) {
                    if let Some(tool) = item.get_mut("toolCall") {
                        tool["status"] = json!("cancelled");
                        tool["output"] = json!("Permission denied — file was not changed.");
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_edit_kind() {
        let edit = json!({
            "title": "Edit file",
            "toolCall": { "fields": { "kind": "edit" } },
        });
        assert!(permission_is_file_mutation(&edit));
        let execute = json!({
            "title": "Run shell",
            "toolCall": { "fields": { "kind": "execute" } },
        });
        assert!(!permission_is_file_mutation(&execute));
    }
}
