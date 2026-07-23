# ACP Audit — Gharargah / Jet

Date: 2026-07-23  
Scope: Agent Client Protocol (stable v1) integration in `apps/server` + agent UI packages  
Pinned SDK at audit: `agent-client-protocol = "1.2"` (resolved 1.2.0; crates.io latest SDK 1.3.0; protocol version remains stable `1`)

## Current architecture

```
Browser (gharargah-app / gharargah-ui)
  └─ host-client RPC + WS events (agents:*)
       └─ apps/server HostState.agents (AgentsHost)
            ├─ JSON files under <workspace>/.gharargah/agents/
            ├─ GHARARGAH_AGENT_MOCK=1 → in-process fake text stream (bypasses ACP)
            ├─ driver *:cli → spawn CLI once per turn
            └─ driver cursor:acp → OS thread → nested Tokio runtime → AcpAgent process → run_acp_turn()
```

Key files:

| Layer | Path |
| ----- | ---- |
| ACP turn client | `apps/server/src/host/acp_client.rs` |
| Agents host / persistence / events | `apps/server/src/host/agents.rs` |
| Event fanout | `apps/server/src/host/events.rs` |
| SQLite session roster (metadata only) | `apps/server/src/persistence.rs` |
| TS contracts | `packages/gharargah-agents/src/types.ts` |
| UI | `packages/gharargah-ui/src/agents/**` |
| App wiring | `packages/gharargah-app/src/App.tsx` |

Authoritative transcript store is **JSON on disk**, not SQLite. SQLite `sessions` only records create-time agent metadata.

## Current lifecycle

1. UI `agents:createThread` → JSON thread with `status: idle`, empty messages.
2. UI `agents:sendMessage` → append user + empty streaming assistant message; emit `agents:threadUpdated`.
3. Host inserts `ActiveTurn`, spawns **`std::thread`**.
4. Mock path: chunked string sleep loop; never speaks ACP.
5. ACP path: spawn `cursor-agent acp` (new process), build **new multi-thread Tokio runtime**, `block_on(run_acp_turn)`.
6. Inside turn: initialize → load-or-new session → optional model config → prompt → flatten text/activity → on cancel send `session/cancel` and after 15s **fabricate** cancelled stop reason.
7. On finish: write assistant text, emit `threadUpdated`; during stream emit `threadDelta` with full assistant text snapshot.
8. Process/runtime discarded after each turn. Next turn may `session/load` using stored `acpSessionId`, but always new process/connection.

## Protocol methods currently supported

| Method / update | Status |
| --------------- | ------ |
| `initialize` | Yes (client info + config_options capability only) |
| `session/new` | Yes |
| `session/load` | Yes, with **silent fallback to `session/new` on any failure** |
| `session/prompt` | Yes (single text block) |
| `session/cancel` | Yes (notification) |
| `session/set_config_option` | Yes (model category only; soft-fail) |
| `session/update` AgentMessageChunk (text) | Flattened to assistant string |
| `session/update` ToolCall / ToolCallUpdate / Thought | Collapsed to `activity` string |
| `session/request_permission` | Auto-selected AllowOnce/AllowAlways |
| Auth, resume, close, list, delete | No |
| FS / terminal client methods | Not advertised, not implemented |
| Plans, usage, commands, config updates (as structured state) | Lost |
| `$/cancel_request` | No explicit handling |

Client capabilities advertised: `session.config_options` only. No FS, no terminal, no image/audio content caps.

## Missing stable ACP methods / surfaces

- Authentication discovery / authenticate / logout
- `session/resume`, `session/close`, `session/list`, `session/delete`
- Additional workspace directories on new/load/resume
- MCP server definitions on session create
- Multi-block prompts (resource/image/audio/embedded)
- Structured plan / usage / available_commands / config option updates / session info
- Client filesystem (`fs/read_text_file`, `fs/write_text_file`)
- Client terminal create/output/wait/kill/release
- Permission surfacing to user + remembered rules
- Generic JSON-RPC `$/cancel_request`
- Raw protocol trace / inspector
- Long-lived multiplexed connection

## Data-loss points

1. Thought chunks → `"Thinking…"` activity only.
2. Tool calls → one-line activity; no id/kind/status/content/diff/locations persisted.
3. Plans / usage / commands / config updates → dropped.
4. Permission requests → never persisted; auto-approved.
5. Stop reasons other than cancelled → treated as idle success; cancelled → generic `"Turn interrupted"` error.
6. `agents:threadDelta` carries full assistant text, not incremental patches / sequence numbers.
7. Session load replay intentionally ignored (`capture_updates` false) — correct for not double-painting old text, but no structured replay hydration into timeline.
8. No event sequence / turn id / tool id in persistence model.

## Concurrency problems

1. **Nested Tokio runtime per ACP turn** (`agents.rs` ~912–917) while process already runs under `#[tokio::main]`.
2. **New OS thread per turn**; no shared supervisor; no connection reuse.
3. One process per turn → cannot multiplex sessions efficiently; provider startup cost every message.
4. `ActiveTurn` map keyed by `root::thread` — second send cancels previous turn (OK), but no queue / typed `turn_already_running` policy documented for UI.
5. Cross-thread mutex JSON read/write on every text chunk → disk + full event emit pressure.
6. No backpressure between ACP reader and browser/DB.

## Cancellation problems

1. After `CANCELLATION_TIMEOUT` (15s), client fabricates `PromptResponse::Cancelled` even if provider never replied — lies about remote completion.
2. Cancelled stop reason mapped to thread `error` + `"Turn interrupted"` — conflates user cancel with failure.
3. No distinction between `session/cancel` and `$/cancel_request`.
4. Fixed short mental model (15s grace) while prompts waiting on permissions may need much longer; permission is auto-approved today so issue is latent.
5. Late updates after fabricated cancel may race with `capture_updates=false`.

## Security risks

1. **Automatic permission approval** (`preferred_permission`) — AllowOnce then AllowAlways. Production-unsafe.
2. No user-visible permission UI; no scoped allow-always rules.
3. Client does not implement FS/terminal caps, so agent-side tools run in provider process with provider’s own sandbox — opaque to Gharargah policy.
4. No raw-trace redaction facility (and little tracing at all).
5. Agent env / secrets not systematically redacted from diagnostics.
6. Workspace path checks exist at RPC boundary for `agents:*` roots; ACP cwd uses thread workspace path — OK if create/send validated, but no additional-root model yet.

## UI gaps

Present: streaming text, markdown, diffs/changed files, model/provider picker, activity string, error banner, scroll anchoring helpers, T3-inspired composer chrome.

Missing vs T3-level ACP UX:

- Connection state machine UI (connecting / auth / reconnect / crashed)
- Thought panels
- Tool cards (structured)
- Permission cards + composer permission stack
- Plan cards
- Terminal tool output
- Context usage meter
- Slash command menu from ACP commands
- Dynamic configuration from advertised options (beyond hardcoded model list for Cursor CLI)
- ACP developer inspector
- Sequence-gap recovery / snapshot hydration
- Canonical status beyond `idle | running | error`

## Proposed migration sequence

0. Audit + pin/upgrade SDK to current stable v1-compatible release; keep protocol V1 only.
1. Domain types: connection/session/turn state, normalized events, provider profiles, reducers + unit tests.
2. Shared-runtime supervisor: long-lived process, connection state machine, trace, restart/backoff.
3. Capability-gated ACP services: auth, sessions, prompt updates, config, commands, plans, usage, FS, terminal, permissions, cancel.
4. Real mock ACP binary + scenario DSL; `GHARARGAH_AGENT_MOCK=1` launches it through normal stack.
5. Structured persistence + real deltas + legacy message compatibility.
6. UI: structured timeline, permissions, tools, plans, usage, inspector — preserve Gharargah tokens.
7. Provider profiles + quirks + opt-in smokes.
8. Fuzz/perf/bounds hardening + docs matrix.

## Risks to backward compatibility

| Risk | Mitigation |
| ---- | ---------- |
| Existing threads are plain `{messages:[{text}]}` | Keep rendering legacy messages; additive timeline fields |
| UI expects `agents:threadDelta` full-text snapshot | Emit both transitional snapshot deltas and new sequenced deltas during migrate; then prefer sequenced |
| `GHARARGAH_AGENT_MOCK=1` e2e expects `"Mock agent reply: …"` | Mock ACP scenario returns same prefix text; keep e2e green |
| Auto-approve removal may break unattended CI against real agents | Mock + explicit test permission resolver; real smokes opt-in |
| Silent load→new fallback removal surfaces errors | UI recovery action “Create new session”; store last load error |
| Nested-runtime removal changes scheduling | Use app Tokio handle; regression tests for cancel + stream |
| Activity string consumers | Keep optional `activity` derived field for one release |

## Baseline test inventory (pre-change)

Rust (`acp_client.rs`): launch args, permission prefer-allow, model config find, negotiate+stream, load without replay paint, set model, cancel forward.  
Rust (`agents.rs`): store migrate, catalog cursor-acp, legacy id normalize.  
E2E: `session-agent.electron.spec.ts`, `web-server.electron.spec.ts` with `GHARARGAH_AGENT_MOCK=1`.

## Decisions locked by this audit

1. **Prompt overlap policy:** reject second prompt with typed `turn_already_running` (queue later if product asks).
2. **Unsaved buffer FS policy (when FS advertised):** reads prefer dirty editor buffer when present; writes go to disk and mark buffer conflict/reload — never silently overwrite dirty buffer without notice.
3. **Cancel honesty:** never fabricate successful/cancelled ACP prompt results; after grace → `provider_unresponsive` + force-stop affordance.
4. **Mock default:** `GHARARGAH_AGENT_MOCK=1` = real stdio ACP mock. Legacy in-process fake only under `GHARARGAH_AGENT_MOCK_LEGACY=1`.
5. **SDK:** move to current stable `agent-client-protocol` 1.3.x; protocol negotiation stays `ProtocolVersion::V1`; no v2 draft deps in production paths.

## Post-implementation status (2026-07-23)

Fixed since this audit:

- `GHARARGAH_AGENT_MOCK=1` now runs the real strict stdio ACP mock; the old fake requires `GHARARGAH_AGENT_MOCK_LEGACY=1`.
- ACP provider processes are long-lived per provider/workspace in `ConnectionPool`, with one initialize per worker on the shared Tokio runtime.
- Overlapping thread turns are rejected; cancellation forwards `session/cancel` and reports `provider_unresponsive_after_cancel` after the grace period instead of fabricating cancellation.
- ACP filesystem read/write callbacks are advertised and workspace-contained; the host requires caller-mediated permission option selection (`{permissionId, decision}` or `{requestId, optionId}`).
- Live `EventPipeline` emits sequenced structured deltas (`agents:structuredDelta`) for text/thought/tool/plan/usage/commands; UI cards + slash menu + inspector wired.
- Terminal client methods (create/output/wait/kill/release) advertised and exercised by `terminal_roundtrip`.
- Model `session/set_config_option` applied on the pool path; force-stop + auth/list-session stubs exposed as host RPCs.
- E2E: `acp-structured` covers echo, thought timeline, and permission_allow resolution.

Still partial / out of production-critical path:

- Auth does not send a real `AuthenticateRequest` (stub + connection state only).
- Session list/close when the agent advertises the capability still return `*_not_implemented` (capability-gated stubs).
- Multi-block prompts, extra roots, unsaved-buffer FS bridge, remembered allow-always rules.
- Real-provider smoke tests remain opt-in (Cursor/Codex/Claude/OpenCode on PATH).
- Images/audio/resources in prompts not advertised.
