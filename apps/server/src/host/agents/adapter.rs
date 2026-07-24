//! Stable adapter contract for provider transports.
//! Concrete adapters (ACP / Codex / Claude / CLI) implement this over time;
//! `AgentsHost` still owns orchestration until extraction completes.

use serde_json::Value;

#[derive(Clone, Debug, Default)]
pub struct AgentCapabilities {
    pub supports_steer: bool,
    pub supports_queue: bool,
    pub supports_model_listing: bool,
    pub write_capable: bool,
    pub degraded: bool,
}

#[derive(Clone, Debug)]
pub struct ProviderSession {
    pub session_id: String,
    pub transport: String,
}

#[derive(Clone, Debug)]
pub struct SendTurnRequest {
    pub prompt: String,
    pub model: Option<String>,
    pub runtime_mode: Option<String>,
    pub interaction_mode: Option<String>,
}

/// Future boundary for transport-specific turn execution.
pub trait AgentAdapter: Send + Sync {
    fn capabilities(&self) -> AgentCapabilities;
    fn transport_id(&self) -> &'static str;
}

pub struct CliFallbackAdapter;

impl AgentAdapter for CliFallbackAdapter {
    fn capabilities(&self) -> AgentCapabilities {
        AgentCapabilities {
            supports_steer: false,
            supports_queue: false,
            supports_model_listing: false,
            write_capable: false,
            degraded: true,
        }
    }

    fn transport_id(&self) -> &'static str {
        "cli"
    }
}

pub struct AcpAdapter;

impl AgentAdapter for AcpAdapter {
    fn capabilities(&self) -> AgentCapabilities {
        AgentCapabilities {
            supports_steer: false,
            supports_queue: false,
            supports_model_listing: true,
            write_capable: true,
            degraded: false,
        }
    }

    fn transport_id(&self) -> &'static str {
        "acp"
    }
}

pub fn adapter_for_driver(driver_id: &str) -> Box<dyn AgentAdapter> {
    if driver_id.ends_with(":cli") {
        Box::new(CliFallbackAdapter)
    } else {
        Box::new(AcpAdapter)
    }
}

pub fn capabilities_json(adapter: &dyn AgentAdapter) -> Value {
    let caps = adapter.capabilities();
    serde_json::json!({
        "supportsSteer": caps.supports_steer,
        "supportsQueue": caps.supports_queue,
        "supportsModelListing": caps.supports_model_listing,
        "writeCapable": caps.write_capable,
        "degraded": caps.degraded,
        "transport": adapter.transport_id(),
    })
}
