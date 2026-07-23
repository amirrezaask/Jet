use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PermissionRequest {
    pub id: String,
    pub title: String,
    pub resolved: bool,
}
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct Permissions {
    pub pending: BTreeMap<String, PermissionRequest>,
}

pub fn request(state: &mut Permissions, permission: PermissionRequest) {
    if !permission.resolved {
        state.pending.insert(permission.id.clone(), permission);
    }
}
pub fn resolve(state: &mut Permissions, id: &str) {
    state.pending.remove(id);
}
pub fn tool_in_progress(_state: &mut Permissions, _tool_id: &str) {
    // Protocols interleave tool progress with approvals; never clear pending permission here.
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tool_progress_preserves_pending_permission() {
        let mut state = Permissions::default();
        request(
            &mut state,
            PermissionRequest {
                id: "p".into(),
                title: "Allow write".into(),
                resolved: false,
            },
        );
        tool_in_progress(&mut state, "tool");
        assert!(state.pending.contains_key("p"));
    }
    #[test]
    fn only_explicit_resolution_removes_permission() {
        let mut state = Permissions::default();
        request(
            &mut state,
            PermissionRequest {
                id: "p".into(),
                title: "Allow".into(),
                resolved: false,
            },
        );
        resolve(&mut state, "p");
        assert!(state.pending.is_empty());
    }
}
