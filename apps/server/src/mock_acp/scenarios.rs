#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Scenario {
    Echo,
    ThoughtThenAnswer,
    ToolLifecycle,
    PermissionAllow,
    PermissionToolRace,
    PlanUpdate,
    CancelCoop,
    SlowStream,
    UsageMeter,
    ConfigModel,
    SlashCommands,
    ChaosMalformed,
    LoadSession,
    FsRoundtrip,
    TerminalRoundtrip,
    MultiSession,
}

impl Scenario {
    pub const ALL: &[(&str, Self)] = &[
        ("echo", Self::Echo),
        ("thought_then_answer", Self::ThoughtThenAnswer),
        ("tool_lifecycle", Self::ToolLifecycle),
        ("permission_allow", Self::PermissionAllow),
        ("permission_tool_race", Self::PermissionToolRace),
        ("plan_update", Self::PlanUpdate),
        ("cancel_coop", Self::CancelCoop),
        ("slow_stream", Self::SlowStream),
        ("usage_meter", Self::UsageMeter),
        ("config_model", Self::ConfigModel),
        ("slash_commands", Self::SlashCommands),
        ("chaos_malformed", Self::ChaosMalformed),
        ("load_session", Self::LoadSession),
        ("fs_roundtrip", Self::FsRoundtrip),
        ("terminal_roundtrip", Self::TerminalRoundtrip),
        ("multi_session", Self::MultiSession),
    ];

    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL
            .iter()
            .find_map(|(candidate, scenario)| (*candidate == name).then_some(*scenario))
    }
}
