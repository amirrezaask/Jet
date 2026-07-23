# ACP v1 support matrix

Status reflects the live `ConnectionPool` + `AcpSupervisor` path (2026-07-23).

| Method / update / capability | Supported | Capability-gated | Tested | UI | Persistence | Mock scenarios | Notes |
|---|---|---|---|---|---|---|---|
| `initialize` / ACP v1 | Yes | — | Yes | Indirect | Connection snapshot | all | Rejects non-v1 negotiated protocol. |
| `session/new` | Yes | — | Yes | Yes | `acpSessionId` | all | Created when no reusable session id. |
| `session/load` | Yes | Agent `load_session` | Unit | Indirect | `acpSessionId` | `load_session` | Load errors surface; no silent fallback to new. Replayed updates suppressed. |
| `session/prompt` text | Yes | — | Yes | Streaming chat | `messages` + timeline text | `echo`, `slow_stream` | One text content block. |
| `session/cancel` | Yes | — | Yes | Interrupt | Final message/error | `cancel_coop` | 15 s grace → `provider_unresponsive_after_cancel`. |
| `session/set_config_option` (model) | Yes | Agent config options | Unit | Model picker | Thread `model` | `config_model` | Applied on pool path after session new/load. |
| `AgentMessageChunk` | Yes | — | Yes | Yes | Assistant message + timeline | `echo`, `slow_stream` | Snapshot deltas + coalesced timeline flush. |
| `AgentThoughtChunk` | Yes | — | Yes | ThoughtBlock | Timeline | `thought_then_answer` | Structured timeline + activity. |
| `ToolCall` / `ToolCallUpdate` | Yes | — | Yes | ToolCallCard | Timeline | `tool_lifecycle` | Normalized to UI `AgentToolCall`. |
| `Plan` | Yes | — | Unit/e2e-indirect | PlanCard | `plan` + timeline | `plan_update` | Mapped to `AgentPlan`. |
| `UsageUpdate` | Yes | — | Unit | UsageMeter | `usage` + timeline | `usage_meter` | Mapped to `AgentUsage`. |
| `AvailableCommandsUpdate` | Yes | — | Unit | Slash menu | `availableCommands` | `slash_commands` | Composer `/` menu. |
| `session/request_permission` | Yes | — | Integration + e2e | PermissionCard | `timeline`, `pendingPermissions` | `permission_allow`, `permission_tool_race` | Host accepts `{requestId\|permissionId, optionId\|decision}`. |
| `fs/read_text_file` | Yes | Client FS | Unit | No direct UI | Disk | `fs_roundtrip` | Workspace-contained. |
| `fs/write_text_file` | Yes | Client FS | Unit | No direct UI | Disk | — | No unsaved-buffer bridge yet. |
| Client terminal methods | Yes | Advertised | Unit + mock | Indirect | Ephemeral | `terminal_roundtrip` | create/output/wait/kill/release; 256KB bound. |
| Authentication methods | Partial | Initialize `auth_methods` | Stub | Connection state | Snapshot | — | `AuthenticationRequired` when methods present; `agents:authenticate` stub. |
| Session list/close | Stub | Capability-gated | Stub RPC | No | No | — | `agents:listAcpSessions` / supervisor stubs return clear unsupported errors when capability absent. |
| Session resume/delete | Partial | load_session | Unit | Indirect | `acpSessionId` | `load_session` | Resume via load; delete not implemented. |
| Images/audio/resources in prompt | No | Not advertised | No | No | No | No | Prompt is text-only. |
| Structured sequenced deltas | Yes | — | Integration + e2e | Yes | Timeline + `acpSequence` | thought/tool/plan/usage | `EventPipeline` + `agents:structuredDelta`. |
| Protocol trace | Yes | — | Unit | AcpInspector | In-memory (bounded) | — | Redacted/bounded; inspector RPC. |
| Force-stop provider | Yes | — | Unit/RPC | Inspector affordance (RPC) | — | — | `agents:forceStopProvider` drops pool worker. |

Provider profiles are launch configuration. See `acp-provider-compatibility.md` for real-provider opt-in smokes.

## Mock scenario coverage (required)

| Scenario | Supervisor matrix | Host e2e |
|---|---|---|
| `echo` | `matrix_echo` | `scenario:echo` |
| `thought_then_answer` | `matrix_thought_then_answer` | `scenario:thought_then_answer` |
| `tool_lifecycle` | `matrix_tool_lifecycle` | `scenario:tool_lifecycle` |
| `permission_allow` | `matrix_permission_allow` | `scenario:permission_allow` |
| `permission_tool_race` | `matrix_permission_tool_race` | `scenario:permission_tool_race` |
| `plan_update` | `matrix_plan_update` | `scenario:plan_update` |
| `cancel_coop` | `matrix_cancel_coop` | `scenario:cancel_coop` |
| `slow_stream` | `matrix_slow_stream` | `scenario:slow_stream` |
| `usage_meter` | `matrix_usage_meter` | `scenario:usage_meter` |
| `config_model` | `matrix_config_model` | `scenario:config_model` |
| `slash_commands` | `matrix_slash_commands` | `scenario:slash_commands` |
| `chaos_malformed` | `matrix_chaos_malformed` | `scenario:chaos_malformed` |
| `load_session` | `matrix_load_session` (new + reload, no replay paint) | `scenario:load_session` (session id persisted) |
| `fs_roundtrip` | `matrix_fs_roundtrip` | `scenario:fs_roundtrip` |
| `terminal_roundtrip` | `matrix_terminal_roundtrip` | `scenario:terminal_roundtrip` |
| `multi_session` | `matrix_multi_session` (≥2 session ids) | `scenario:multi_session` (host turn under flag) |

Drift guards: `every_mock_scenario_has_a_matrix_entry` (Rust) + `matrix covers every documented mock scenario name` (e2e).
