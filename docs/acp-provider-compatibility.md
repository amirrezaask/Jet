# ACP provider compatibility

Profiles live in Effect [`apps/agent-server/src/provider/acp-adapter.ts`](../apps/agent-server/src/provider/acp-adapter.ts) (`ACP_PROFILES`). Product routing: `OrchestrationEngine` → `createAdapter(driverId)` → `AcpProviderAdapter` / native adapters. Rust `host/acp/profiles.rs` is **removed**.

| Profile | Command | Product status | Profile note |
|---|---|---|---|
| `cursor:acp` | `cursor-agent acp` | Default Cursor | Permission during tool update; parameterized model picker. |
| `codex:acp` | `codex acp` | ACP alternate for Codex | Primary product driver is `codex:app-server`. |
| `claude:acp` | `claude --acp` | ACP alternate for Claude | Primary is `claude:sdk`. |
| `opencode:acp` | `opencode acp` | ACP alternate | Primary is `opencode:sdk` (SSE streaming). |
| `grok:acp` | `grok agent stdio` | Default Grok | Matches t3code spawn; auth via Grok CLI / `XAI_API_KEY`. |
| mock | `gharargah-mock-acp --scenario …` | `GHARARGAH_AGENT_MOCK=1` | All ACP agents launch mock via pool. |

`GHARARGAH_MOCK_ACP_BIN` overrides the mock executable. Non-mock profiles resolve from `PATH` (login-shell PATH injected by Tauri into jet + agent-server).

Catalog `*:cli` drivers are **not** implemented — `createAdapter` throws rather than silently remapping to Cursor ACP.

## Durability notes (t3code parity)

- SQLite `agent_events` + command receipts + provider sessions under `.gharargah/agents/events.sqlite3`.
- Connection keys: `{driverId}:{instance}:{workspace}`.
- Idle ACP processes reaped after 30 minutes (5m sweep).
- Host MCP loopback injected on `session/new|load|resume` (`gharargah_ping`, `gharargah_workspace_root`).
- Checkpoints store `gitStashMessage`; revert trims transcript and `git stash apply` when possible.

## Opt-in provider smoke

With a provider CLI installed and authenticated, pick its primary driver, send one prompt in a disposable workspace:

1. `agents:getConnectionState` shows `connected` (or `authenticating` until auth).
2. Thread has `acpSessionId` for ACP drivers.
3. Second prompt prefers `session/resume` when history exists, else `session/load`.
4. Interrupt either cancels cleanly or force-kills after 15s grace.
5. Force-stop from ACP inspector kills the provider process.

See [`acp-support-matrix.md`](./acp-support-matrix.md).
