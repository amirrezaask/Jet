use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    #[default]
    NotStarted,
    Starting,
    Initializing,
    AuthenticationRequired,
    Authenticating,
    Ready,
    Degraded,
    Restarting,
    Stopping,
    Stopped,
    Failed,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    #[default]
    New,
    Loading,
    Ready,
    Running,
    Stopping,
    Stopped,
    Failed,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnState {
    #[default]
    Queued,
    Running,
    Stopping,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    #[default]
    EndTurn,
    Cancelled,
    MaxTokens,
    MaxTurnRequests,
    Refusal,
    Error,
    TransportClosed,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TimelineItemKind {
    Text,
    Thought,
    ToolCall,
    Permission,
    UserInput,
    Plan,
    Usage,
    Status,
    Error,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct TimelineItem {
    pub kind: TimelineItemKind,
    pub id: String,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub payload: Value,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NormalizedEvent {
    Connection {
        state: ConnectionState,
        detail: Option<String>,
    },
    Session {
        session_id: String,
        state: SessionState,
    },
    Turn {
        session_id: String,
        turn_id: String,
        state: TurnState,
        stop_reason: Option<StopReason>,
    },
    Timeline(TimelineItem),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProviderConnectionSnapshot {
    pub provider_id: String,
    pub state: ConnectionState,
    pub detail: Option<String>,
    pub process_id: Option<u32>,
    pub restart_count: u32,
    pub started_at_ms: Option<u64>,
    pub last_transition_at_ms: u64,
    pub last_error: Option<String>,
    #[serde(default)]
    pub auth_method_ids: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AcpError {
    // ACP turns are serialized per session; a second prompt is rejected rather than queued.
    TurnAlreadyRunning {
        session_id: String,
        turn_id: String,
    },
    InvalidPath {
        path: PathBuf,
        reason: String,
    },
    PathOutsideAllowedRoots {
        path: PathBuf,
    },
    Io {
        operation: &'static str,
        message: String,
    },
    Profile {
        provider_id: String,
        message: String,
    },
    Protocol {
        message: String,
    },
}

impl fmt::Display for AcpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TurnAlreadyRunning {
                session_id,
                turn_id,
            } => {
                write!(
                    f,
                    "turn {turn_id} is already running for session {session_id}"
                )
            }
            Self::InvalidPath { path, reason } => {
                write!(f, "invalid path {}: {reason}", path.display())
            }
            Self::PathOutsideAllowedRoots { path } => {
                write!(f, "path is outside allowed roots: {}", path.display())
            }
            Self::Io { operation, message } => write!(f, "{operation}: {message}"),
            Self::Profile {
                provider_id,
                message,
            } => write!(f, "profile {provider_id}: {message}"),
            Self::Protocol { message } => f.write_str(message),
        }
    }
}

impl std::error::Error for AcpError {}
