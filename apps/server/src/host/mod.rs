use events::EventHub;
use serde_json::Value;

pub mod acp;
pub mod acp_client;
pub mod agents;
pub mod events;
pub mod fff_service;
pub mod fs;
pub mod git;
pub mod launch;
pub mod lsp;
pub mod perf;
pub mod search;
pub mod shell;
pub mod tasks;
pub mod terminal;
pub mod uri;
pub mod workspace;

use agents::AgentsHost;
use lsp::LspHost;
use perf::PerfHost;
use terminal::TerminalHost;
use workspace::WorkspaceHost;

pub struct HostState {
    pub workspace: WorkspaceHost,
    pub lsp: LspHost,
    pub terminal: TerminalHost,
    pub agents: AgentsHost,
    pub perf: PerfHost,
    pub home_dir: String,
    pub events: EventHub,
}

impl HostState {
    pub fn new(home_dir: String, process_started: std::time::Instant) -> Self {
        Self {
            workspace: WorkspaceHost::new(),
            lsp: LspHost::new(),
            terminal: TerminalHost::new(),
            agents: AgentsHost::new(),
            perf: PerfHost::new(&home_dir, process_started),
            home_dir,
            events: EventHub::new(1_024),
        }
    }

    pub fn shutdown(&self) {
        self.agents.stop_all();
        self.lsp.stop_all();
        self.terminal.stop_all();
        self.workspace.stop_all();
    }

    pub fn invoke(
        &self,
        channel: &str,
        args: Vec<Value>,
        client_id: &str,
    ) -> Result<Value, String> {
        let args_ref: &[Value] = &args;
        if channel.starts_with("fs:") {
            return fs::handle(channel, args_ref);
        }
        if channel.starts_with("git:") {
            return git::handle(channel, args_ref);
        }
        if channel.starts_with("tasks:") {
            return tasks::handle(channel, args_ref);
        }
        if channel.starts_with("shell:") {
            return shell::handle(channel, args_ref);
        }
        if channel.starts_with("search:") {
            return search::handle(channel, args_ref, Some(&self.events));
        }
        if channel.starts_with("workspace:") {
            return workspace::handle(&self.workspace, &self.events, channel, args_ref);
        }
        if channel.starts_with("lsp:") {
            return lsp::handle(&self.lsp, &self.events, channel, args_ref);
        }
        if channel.starts_with("terminal:") {
            return terminal::handle(&self.terminal, &self.events, client_id, channel, args_ref);
        }
        if channel.starts_with("agents:") {
            return agents::handle(&self.agents, &self.events, channel, args_ref);
        }
        if channel.starts_with("perf:") {
            return perf::handle(&self.perf, channel, args_ref);
        }
        if channel.starts_with("gharargah:") {
            return launch::handle(channel, args_ref, &self.home_dir);
        }
        if channel == "ui:syncNativeChrome" {
            return Ok(Value::Null);
        }
        Err(format!("unknown host channel: {channel}"))
    }
}
