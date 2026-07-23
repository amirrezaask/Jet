# ACP v1 support matrix

Status reflects the live `ConnectionPool` + `AcpSupervisor` path (2026-07-23).

| Method / update / capability | Supported | Capability-gated | Tested | UI | Persistence | Mock scenarios | Notes |
|---|---|---|---|---|---|---|---|
| `initialize` / ACP v1 | Yes | — | Yes | Indirect | Connection snapshot | all | Rejects non-v1 negotiated protocol. |
| `session/new` | Yes | — | Yes | Yes | `acpSessionId` | all | Created when no reusable session id. |
| `session/load` | Yes | Agent `load_session` | Unit | Indirect | `acpSessionId` | `load_session` | Routing+capture registered before load; replay kept. |
| `session/resume` | Yes | Agent `sessionCapabilities.resume` | Unit | Indirect | `acpSessionId` | — | Preferred when local history exists; no replay. |
| `session/prompt` text | Yes | — | Yes | Streaming chat | `messages` + timeline text | `echo`, `slow_stream` | One text content block. |
| `session/cancel` | Yes | — | Yes | Interrupt | Final cancelled status | `cancel_coop` | 15 s grace → force-stop after `provider_unresponsive_after_cancel`. |
| `session/set_config_option` (model) | Yes | Agent config options | Unit | Model picker | Thread `model` | `config_model` | Applied on pool path after session new/load/resume. |
| `AgentMessageChunk` | Yes | — | Yes | Yes | Assistant message + timeline | `echo`, `slow_stream` | Snapshot deltas + coalesced timeline flush. |
| `AgentThoughtChunk` | Yes | — | Yes | ThoughtBlock | Timeline | `thought_then_answer` | Stable thought stream id. |
| `ToolCall` / `ToolCallUpdate` | Yes | — | Yes | ToolCallCard | Timeline (reduced by id) | `tool_lifecycle` | One timeline identity per `toolCallId`. |
| `Plan` | Yes | — | Unit/e2e-indirect | PlanCard | `plan` + timeline | `plan_update` | Stable plan id. |
| `UsageUpdate` | Yes | — | Unit | UsageMeter | `usage` + timeline | `usage_meter` | Mapped to `AgentUsage`. |
| `AvailableCommandsUpdate` | Yes | — | Unit | Slash menu | `availableCommands` | `slash_commands` | Composer `/` menu. |
| `session/request_permission` | Yes | — | Integration + e2e | PermissionCard | `timeline`, `pendingPermissions` | `permission_allow`, `permission_tool_race` | Exact option ids + kinds preserved. |
| `fs/read_text_file` | Yes | Client FS | Unit | No direct UI | Disk | `fs_roundtrip` | Session-root contained. |
| `fs/write_text_file` | Yes | Client FS | Unit | No direct UI | Disk | — | No unsaved-buffer bridge yet. |
| Client terminal methods | Yes | Advertised | Unit + mock | Indirect | Ephemeral | `terminal_roundtrip` | create/output/wait/kill/release; 256KB bound. |
| Authentication methods | Yes | Initialize `auth_methods` | Unit | Connection state | Snapshot | — | Blocks turns until `agents:authenticate`. |
| Session list/close/delete | Yes | Capability-gated | Unit/RPC | No | No | — | Live RPCs on connection. |
| Logout | Yes | `agentCapabilities.auth.logout` | Unit/RPC | No | Snapshot | — | Capability-gated. |
| Images/audio/resources in prompt | No | Not advertised | No | No | No | No | Prompt is text-only. |
| Structured sequenced deltas | Yes | — | Integration + e2e | Yes | Timeline + `acpSequence` | thought/tool/plan/usage | Per-thread monotonic allocator; permissions included. |
| Protocol trace | Yes | — | Unit | AcpInspector | In-memory (bounded) | — | Redacted/bounded; inspector RPC. |
| Force-stop provider | Yes | — | Unit/RPC | Inspector affordance (RPC) | — | — | Cancels turns, settles perms, kills process via ChildGuard. |

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
| `load_session` | `matrix_load_session` (new + reload, replay captured) | `scenario:load_session` (session id persisted) |
| `fs_roundtrip` | `matrix_fs_roundtrip` | `scenario:fs_roundtrip` |
| `terminal_roundtrip` | `matrix_terminal_roundtrip` | `scenario:terminal_roundtrip` |
| `multi_session` | `matrix_multi_session` (concurrent interleaved turns) | `scenario:multi_session` (host turn under flag) |

Drift guards: `every_mock_scenario_has_a_matrix_entry` (Rust) + `matrix covers every documented mock scenario name` (e2e).
