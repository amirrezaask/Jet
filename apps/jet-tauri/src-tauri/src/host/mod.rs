use serde_json::Value;
use tauri::AppHandle;

pub mod agents;
pub mod events;
pub mod fff_service;
pub mod fs;
pub mod git;
pub mod launch;
pub mod lsp;
pub mod perf;
pub mod search;
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
        }
    }

    pub fn shutdown(&self) {
        self.lsp.stop_all();
        self.terminal.stop_all();
        self.workspace.stop_all();
    }

    pub fn invoke(
        &self,
        app: &AppHandle,
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
        if channel.starts_with("search:") {
            return search::handle(channel, args_ref, Some(app));
        }
        if channel.starts_with("workspace:") {
            return workspace::handle(&self.workspace, app, channel, args_ref);
        }
        if channel.starts_with("lsp:") {
            return lsp::handle(&self.lsp, app, channel, args_ref);
        }
        if channel.starts_with("terminal:") {
            return terminal::handle(&self.terminal, app, client_id, channel, args_ref);
        }
        if channel.starts_with("agents:") {
            return agents::handle(&self.agents, app, channel, args_ref);
        }
        if channel.starts_with("perf:") {
            return perf::handle(&self.perf, channel, args_ref);
        }
        if channel.starts_with("jet:") {
            return launch::handle(channel, args_ref, &self.home_dir);
        }
        if channel == "ui:syncNativeChrome" {
            return Ok(Value::Null);
        }
        Err(format!("unknown host channel: {channel}"))
    }
}
