# ACP v1 support matrix

Status reflects the live `ConnectionPool` + `AcpSupervisor` path (2026-07-24).

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
| `session/request_permission` | Yes | — | Integration + e2e | PermissionCard | `timeline`, `pendingPermissions` | `permission_allow`, `permission_tool_race`, `permission_allow_always` | Exact option ids + kinds preserved; allow-always memory on host. |
| `fs/read_text_file` | Yes | Client FS | Unit | No direct UI | Disk | `fs_roundtrip` | Session-root contained. |
| `fs/write_text_file` | Yes | Client FS | Unit | No direct UI | Disk | — | No unsaved-buffer bridge yet. |
| Client terminal methods | Yes | Advertised | Unit + mock | Indirect | Ephemeral | `terminal_roundtrip` | create/output/wait/kill/release; 256KB bound. |
| Authentication methods | Yes | Initialize `auth_methods` | Unit + e2e | Connection state + auth banner | Snapshot | `auth_required` | Blocks turns until `agents:authenticate`. |
| Session list/close/delete | Yes | Capability-gated | Unit/RPC | No | No | — | Live RPCs on connection. |
| Logout | Yes | `agentCapabilities.auth.logout` | Unit/RPC | No | Snapshot | — | Capability-gated. |
| Images/audio/resources in prompt | Partial | — | Unit + e2e | Composer attach | Prompt blocks | `image_prompt` | Text + optional image blocks (max 8); audio/resources still no. |
| Structured sequenced deltas | Yes | — | Integration + e2e | Yes | Timeline + `acpSequence` | thought/tool/plan/usage | Per-thread monotonic allocator; permissions included. |
| Protocol trace | Yes | — | Unit | AcpInspector | In-memory (bounded) | — | Redacted/bounded; inspector RPC. |
| Force-stop provider | Yes | — | Unit/RPC | Inspector | — | — | Cancels turns, settles perms, kills process via ChildGuard. |
| `cursor/ask_question` | Yes | Capability / Cursor | Unit + e2e | UserInputCard | pendingUserInputs | `ask_question` | Extension method; answers via `agents:resolveUserInput`. |
| `cursor/create_plan` | Yes | Capability / Cursor | Unit + e2e | PlanCard | plan + timeline | `create_plan` | Extension method → plan timeline. |
| `cursor/update_todos` | Yes | Capability / Cursor | Unit + e2e | PlanCard | plan + timeline | `update_todos` | Extension notification → plan timeline. |
| `cursor/list_available_models` | Yes | Capability / Cursor | Soft | Model picker | discoveredModels | mock handler | Best-effort after session open; failures ignored. |
| `elicitation/create` | Yes | Client elicitation | Unit + e2e | UserInputCard | pendingUserInputs | `elicitation` | Unstable feature; form+url advertised. |

Provider profiles are launch configuration. See `acp-provider-compatibility.md` for real-provider opt-in smokes.

## t3code ACP parity checklist

Parity target = t3code `AcpSessionRuntime` path (Cursor/Grok ACP), not Codex app-server / Claude SDK.

| Area | Product | UX | Robustness | Notes |
|---|---|---|---|---|
| Multi-provider ACP (cursor/codex/claude/opencode/grok) | Yes | Same chat UI | Pool keyed by provider+workspace | CLI drivers remain as fallback where applicable |
| Auth discovery + `authenticate` | Yes | Auth banner + method picker | Blocks prompt until authenticated | |
| Connection lifecycle | Yes | Live banner + inspector force-stop | Restart policy + generation bump | |
| Permissions | Yes | PermissionCard + composer stack | Exact option ids; allow-always memory | |
| Tools / thoughts / plans / usage / slash | Yes | Timeline cards + meter + `/` menu | Stable ids + sequence allocator | |
| Session load/resume | Yes | Indirect | Replay capture; resume preferred | Replay-idle gate |
| Runtime modes + `session/set_mode` | Yes | Runtime select + interaction mode | Maps plan/ask/implement aliases like t3 | Mock: `set_mode_plan` |
| Interaction mode (plan/ask/implement) | Yes | Composer interaction select | Persisted `interactionMode` | |
| Images in prompt | Yes | Composer attach | Max 8 images | |
| Cursor extensions | Yes | Ask/plan/todos + model discovery | `create_plan` keeps `isProject`/`phases` | |
| Parameterized model picker meta | Yes | Advertised on initialize | Base model + bracket config batch | |
| Continuation key | Yes | Picker locked mid-thread | Host + UI `lockedProvider` | |
| Sequence-gap heal | Yes | Refetch thread on hole | `acpSequence` guard | |
| Host MCP (`mcpServers`) | Yes | Indirect | Loopback HTTP + Bearer | Mock: `mcp_servers_inject` |
| Session list/close/delete/logout UI | Yes | ACP inspector actions | Host RPCs | |
| Plan implement follow-up | Yes | Composer primary actions | Sends implement prompt | |

## Mock scenario coverage (required)

| Scenario | Supervisor matrix | Host e2e |
|---|---|---|
| `echo` | `matrix_echo` | `scenario:echo` |
| `thought_then_answer` | `matrix_thought_then_answer` | `scenario:thought_then_answer` |
| `tool_lifecycle` | `matrix_tool_lifecycle` | `scenario:tool_lifecycle` |
| `permission_allow` | `matrix_permission_allow` | `scenario:permission_allow` |
| `permission_tool_race` | `matrix_permission_tool_race` | `scenario:permission_tool_race` |
| `permission_allow_always` | `matrix_permission_allow_always` | `scenario:permission_allow_always` |
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
| `ask_question` | `matrix_ask_question` | `scenario:ask_question` |
| `create_plan` | `matrix_create_plan` | `scenario:create_plan` |
| `update_todos` | `matrix_update_todos` | `scenario:update_todos` |
| `elicitation` | `matrix_elicitation` | `scenario:elicitation` |
| `auth_required` | `matrix_auth_required` | `scenario:auth_required` |
| `image_prompt` | `matrix_image_prompt` | `scenario:image_prompt` |
| `set_mode_plan` | `matrix_set_mode_plan` | `scenario:set_mode_plan` |
| `mcp_servers_inject` | `matrix_mcp_servers_inject` | `scenario:mcp_servers_inject` |

Drift guards: `every_mock_scenario_has_a_matrix_entry` (Rust) + `matrix covers every documented mock scenario name` (e2e).
