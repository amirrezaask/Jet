use clap::Parser;

/// Deterministic ACP peer used for exercising Jet's agent transport.
#[derive(Clone, Debug, Parser)]
#[command(name = "gharargah-mock-acp")]
pub struct Args {
    #[arg(long, default_value = "echo")]
    pub scenario: String,
    #[arg(long, default_value_t = 1)]
    pub seed: u64,
    #[arg(long, default_value_t = 0)]
    pub latency_ms: u64,
    #[arg(long, default_value_t = 0)]
    pub jitter_ms: u64,
    #[arg(long, default_value_t = 12)]
    pub chunk_size: usize,
    /// Inject a named transport fault. `malformed` is also selected by
    /// `chaos_malformed`.
    #[arg(long)]
    pub fault: Option<String>,
    /// Print protocol traffic to stderr.
    #[arg(long)]
    pub trace: bool,
    /// Comma-separated capability overrides (currently: load_session).
    #[arg(long)]
    pub capabilities: Option<String>,
    #[arg(long, default_value = "mock")]
    pub provider_profile: String,
    /// Stop after this many prompt turns. Zero means unlimited.
    #[arg(long, default_value_t = 0)]
    pub exit_after: u64,
    /// Emit this many harmless diagnostic lines to stderr at startup.
    #[arg(long, default_value_t = 0)]
    pub stderr_noise: u32,
    /// Reject unknown scenarios and unsupported protocol versions.
    #[arg(long)]
    pub strict: bool,
}
