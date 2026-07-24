//! Map Gharargah interaction/runtime modes → ACP `session/set_mode` ids (t3code parity).

use agent_client_protocol::schema::v1::{SessionMode, SessionModeState};

const PLAN_ALIASES: &[&str] = &["plan", "architect"];
const IMPLEMENT_ALIASES: &[&str] = &["code", "agent", "default", "chat", "implement"];
const APPROVAL_ALIASES: &[&str] = &["ask"];

fn normalize_mode_search_text(mode: &SessionMode) -> String {
    let mut parts = vec![mode.id.0.as_ref(), mode.name.as_str()];
    if let Some(description) = mode.description.as_deref() {
        parts.push(description);
    }
    parts
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn find_mode_by_aliases<'a>(modes: &'a [SessionMode], aliases: &[&str]) -> Option<&'a SessionMode> {
    let normalized_aliases: Vec<String> = aliases.iter().map(|a| a.to_lowercase()).collect();
    for alias in &normalized_aliases {
        if let Some(exact) = modes.iter().find(|mode| {
            mode.id.0.eq_ignore_ascii_case(alias) || mode.name.eq_ignore_ascii_case(alias)
        }) {
            return Some(exact);
        }
    }
    for alias in &normalized_aliases {
        if let Some(partial) = modes
            .iter()
            .find(|mode| normalize_mode_search_text(mode).contains(alias.as_str()))
        {
            return Some(partial);
        }
    }
    None
}

fn is_plan_mode(mode: &SessionMode) -> bool {
    find_mode_by_aliases(std::slice::from_ref(mode), PLAN_ALIASES).is_some()
}

/// Resolve ACP mode id from Gharargah interaction + runtime mode (t3 `resolveRequestedModeId`).
pub fn resolve_requested_mode_id(
    interaction_mode: Option<&str>,
    runtime_mode: Option<&str>,
    mode_state: &SessionModeState,
) -> Option<String> {
    if mode_state.available_modes.is_empty() {
        return None;
    }

    if interaction_mode == Some("plan") {
        return find_mode_by_aliases(&mode_state.available_modes, PLAN_ALIASES)
            .map(|mode| mode.id.0.to_string());
    }

    if interaction_mode == Some("ask") {
        return find_mode_by_aliases(&mode_state.available_modes, APPROVAL_ALIASES)
            .map(|mode| mode.id.0.to_string())
            .or_else(|| {
                find_mode_by_aliases(&mode_state.available_modes, IMPLEMENT_ALIASES)
                    .map(|mode| mode.id.0.to_string())
            });
    }

    if runtime_mode == Some("approval-required") {
        return find_mode_by_aliases(&mode_state.available_modes, APPROVAL_ALIASES)
            .map(|mode| mode.id.0.to_string())
            .or_else(|| {
                find_mode_by_aliases(&mode_state.available_modes, IMPLEMENT_ALIASES)
                    .map(|mode| mode.id.0.to_string())
            })
            .or_else(|| {
                mode_state
                    .available_modes
                    .iter()
                    .find(|mode| !is_plan_mode(mode))
                    .map(|mode| mode.id.0.to_string())
            })
            .or_else(|| Some(mode_state.current_mode_id.0.to_string()));
    }

    find_mode_by_aliases(&mode_state.available_modes, IMPLEMENT_ALIASES)
        .map(|mode| mode.id.0.to_string())
        .or_else(|| {
            find_mode_by_aliases(&mode_state.available_modes, APPROVAL_ALIASES)
                .map(|mode| mode.id.0.to_string())
        })
        .or_else(|| {
            mode_state
                .available_modes
                .iter()
                .find(|mode| !is_plan_mode(mode))
                .map(|mode| mode.id.0.to_string())
        })
        .or_else(|| Some(mode_state.current_mode_id.0.to_string()))
}

/// Strip Cursor parameterized suffix: `model[fast=false]` → `model`.
pub fn resolve_cursor_base_model_id(model: &str) -> &str {
    let trimmed = model.trim();
    if trimmed.is_empty() {
        return "default";
    }
    trimmed
        .split_once('[')
        .map(|(base, _)| base)
        .unwrap_or(trimmed)
}

/// Parse `model[key=value,key2=value2]` into (base, selections).
pub fn parse_parameterized_model(model: &str) -> (String, Vec<(String, String)>) {
    let base = resolve_cursor_base_model_id(model).to_string();
    let Some((_, rest)) = model.trim().split_once('[') else {
        return (base, Vec::new());
    };
    let Some(inner) = rest.strip_suffix(']') else {
        return (base, Vec::new());
    };
    let selections = inner
        .split(',')
        .filter_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            let key = key.trim();
            let value = value.trim().trim_matches('"');
            if key.is_empty() || value.is_empty() {
                return None;
            }
            Some((key.to_string(), value.to_string()))
        })
        .collect();
    (base, selections)
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::v1::SessionModeId;

    fn mode(id: &str, name: &str) -> SessionMode {
        SessionMode::new(SessionModeId::new(id), name)
    }

    #[test]
    fn plan_interaction_picks_plan_mode() {
        let state = SessionModeState::new(
            SessionModeId::new("agent"),
            vec![mode("agent", "Agent"), mode("plan", "Plan")],
        );
        assert_eq!(
            resolve_requested_mode_id(Some("plan"), Some("full-access"), &state).as_deref(),
            Some("plan")
        );
    }

    #[test]
    fn approval_runtime_prefers_ask() {
        let state = SessionModeState::new(
            SessionModeId::new("agent"),
            vec![mode("agent", "Agent"), mode("ask", "Ask")],
        );
        assert_eq!(
            resolve_requested_mode_id(None, Some("approval-required"), &state).as_deref(),
            Some("ask")
        );
    }

    #[test]
    fn parameterized_model_parse() {
        let (base, sels) = parse_parameterized_model("composer-2[fast=false,effort=high]");
        assert_eq!(base, "composer-2");
        assert_eq!(sels.len(), 2);
        assert_eq!(sels[0], ("fast".into(), "false".into()));
    }
}
