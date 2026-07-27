# ACP v1 support matrix

Status reflects the live **Effect agent-server** path (`apps/agent-server`, 2026-07-27).
Rust `AgentsHost` / `AcpSupervisor` / `host/acp` are **removed** from the live host — `agents:*` RPC on jet returns a migration error. Parity target for Cursor/Grok ACP remains t3code `AcpSessionRuntime` (vendored at `.t3code`).

| Method / update / capability | Supported | Capability-gated | Tested | UI | Persistence | Mock scenarios | Notes |
|---|---|---|---|---|---|---|---|
| `initialize` / ACP v1 | Yes | — | Yes | Indirect | Pool client | all | Via `@gharargah/effect-acp`. |
| `session/new` | Yes | — | Yes | Yes | `acpSessionId` | all | Injects host MCP `mcpServers` (loopback HTTP) or mock stdio. |
| `session/load` | Yes | Agent `load_session` | Unit | Indirect | `acpSessionId` | `load_session` | Replay idle gate (2s / 90s); MCP injected. |
| `session/resume` | Yes | Agent `sessionCapabilities.resume` | Soft | Indirect | `acpSessionId` | — | Preferred when local history exists; falls back to load. |
| `session/prompt` text | Yes | — | Yes | Streaming chat | `messages` + timeline | `echo`, `slow_stream` | |
| `session/cancel` | Yes | — | Yes | Interrupt | Final cancelled status | `cancel_coop` | 15s grace → `forceKill`. |
| `session/set_config_option` (model) | Yes | Agent config options | Unit | Model picker | Thread `model` | `config_model` | |
| `AgentMessageChunk` | Yes | — | Yes | Yes | Assistant message + timeline | `echo`, `slow_stream` | |
| `AgentThoughtChunk` | Yes | — | Yes | ThoughtBlock | Timeline | `thought_then_answer` | |
| `ToolCall` / `ToolCallUpdate` | Yes | — | Yes | ToolCallCard | Timeline | `tool_lifecycle` | |
| `Plan` | Yes | — | Unit/e2e-indirect | PlanCard | `plan` + timeline | `plan_update` | |
| `UsageUpdate` | Yes | — | Unit | UsageMeter | `usage` + timeline | `usage_meter` | |
| `AvailableCommandsUpdate` | Yes | — | Unit | Slash menu | `availableCommands` | `slash_commands` | |
| `session/request_permission` | Yes | — | Integration + e2e | PermissionCard | `pendingPermissions` | `permission_*` | |
| `fs/read_text_file` | Yes | Client FS | Unit | No direct UI | Disk | `fs_roundtrip` | Session-root contained. |
| `fs/write_text_file` | Yes | Client FS | Unit | No direct UI | Disk | — | No unsaved-buffer bridge yet. |
| Client terminal methods | Yes | Advertised | Unit + mock | Indirect | Ephemeral | `terminal_roundtrip` | create/output/wait/kill/release; 256KB bound. |
| Authentication methods | Yes | Initialize `auth_methods` | Unit + e2e | Connection banner | Pool connection state | `auth_required` | |
| Session list/close/delete | Yes | Capability-gated | Unit/RPC | AcpInspector | No | — | Effect pool RPCs. |
| Logout | Yes | `agentCapabilities.auth.logout` | Unit/RPC | AcpInspector | Snapshot | — | Best-effort. |
| Images/audio/resources in prompt | Partial | — | Unit + e2e | Composer attach | Prompt blocks | `image_prompt` | Text + optional image blocks (max 8). |
| Structured sequenced deltas | Yes | — | Integration + e2e | Yes | Timeline + `acpSequence` | thought/tool/plan/usage | |
| Protocol trace | Yes | — | Unit | AcpInspector | In-memory (bounded, redacted) | — | `agents:getAcpTrace`. |
| Force-stop provider | Yes | — | Unit/RPC | Inspector | — | — | `agents:forceStopProvider` → pool force-kill. |
| `cursor/ask_question` | Yes | Capability / Cursor | Unit + e2e | UserInputCard | pendingUserInputs | `ask_question` | |
| `cursor/create_plan` | Yes | Capability / Cursor | Unit + e2e | PlanCard | plan + timeline | `create_plan` | |
| `cursor/update_todos` | Yes | Capability / Cursor | Unit + e2e | PlanCard | plan + timeline | `update_todos` | |
| `cursor/list_available_models` | Yes | Capability / Cursor | Soft | Model picker | discoveredModels | mock handler | |
| `elicitation/create` | Yes | Client elicitation | Unit + e2e | UserInputCard | pendingUserInputs | `elicitation` | |

## Non-ACP drivers (Effect)

| Driver | Status | Notes |
|--------|--------|-------|
| Codex `codex:app-server` | Yes | Streams `item/agentMessage/delta` until `turn/completed` (no fixed sleep / fake mock fallback). |
| Claude `claude:sdk` | Yes | `@anthropic-ai/claude-agent-sdk` `query()`. |
| OpenCode `opencode:sdk` | Yes | `promptAsync` + SSE `event.subscribe`; falls back to blocking `prompt`. |
| Catalog `*:cli` | Catalog-only | `createAdapter` throws — not silently remapped to Cursor ACP. |

## t3code ACP parity checklist

Parity target = t3code `AcpSessionRuntime` path (Cursor/Grok ACP), not Codex app-server / Claude SDK.

| Area | Product | UX | Robustness | Notes |
|---|---|---|---|---|
| Multi-provider ACP (cursor/codex/claude/opencode/grok) | Yes | Same chat UI | Pool keyed by provider+workspace | CLI drivers catalog-only |
| Auth discovery + `authenticate` | Yes | Auth banner + method picker | Connection state in pool | |
| Connection lifecycle | Yes | Live banner + inspector force-stop | Idle reap 30m / 5m | |
| Permissions | Yes | PermissionCard + composer stack | Exact option ids; allow_always option pick | |
| Tools / thoughts / plans / usage / slash | Yes | Timeline cards + meter + `/` menu | Stable ids + sequence allocator | |
| Session load/resume | Yes | Indirect | Replay capture; resume preferred | Replay-idle gate |
| Crash durability | Yes | Interrupted status | SQLite SoT + JSON projection | |
| Command idempotency | Yes | Transparent | `commandId` receipts | |
| Idle reaper | Yes | Indirect | 30m idle / 5m sweep | Matches t3code |
| Checkpoints | Partial | Host IPC | Transcript trim + `git stash apply` on revert when stash message stored | Full tree rewrite still thinner than t3 `CheckpointReactor` |
| Host MCP (`mcpServers`) | Yes | Indirect | Loopback HTTP + Bearer (`gharargah_ping`, `gharargah_workspace_root`) | Mock: stdio inject |
| Session list/close/delete/logout UI | Yes | ACP inspector actions | Effect pool RPCs | |
| Desktop agent-server lifecycle | Yes | Tauri spawns Node launcher | Login-shell PATH shared with jet + agent-server | |

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
| `load_session` | `matrix_load_session` | `scenario:load_session` |
| `fs_roundtrip` | `matrix_fs_roundtrip` | `scenario:fs_roundtrip` |
| `terminal_roundtrip` | `matrix_terminal_roundtrip` | `scenario:terminal_roundtrip` |
| `multi_session` | `matrix_multi_session` | `scenario:multi_session` |
| `ask_question` | `matrix_ask_question` | `scenario:ask_question` |
| `create_plan` | `matrix_create_plan` | `scenario:create_plan` |
| `update_todos` | `matrix_update_todos` | `scenario:update_todos` |
| `elicitation` | `matrix_elicitation` | `scenario:elicitation` |
| `auth_required` | `matrix_auth_required` | `scenario:auth_required` |
| `image_prompt` | `matrix_image_prompt` | `scenario:image_prompt` |
| `set_mode_plan` | `matrix_set_mode_plan` | `scenario:set_mode_plan` |
| `mcp_servers_inject` | `matrix_mcp_servers_inject` | `scenario:mcp_servers_inject` |

Drift guards: Effect `acp-matrix.test.ts` + e2e scenario coverage. Canonical architecture: [`agents-effect-architecture.md`](./agents-effect-architecture.md).
