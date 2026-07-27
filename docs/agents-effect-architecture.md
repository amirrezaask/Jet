# Effect agents control plane

Gharargah agents run in a **Node Effect runtime** (`apps/agent-server`), not in Rust.

## Layout

- `apps/agent-server` — orchestration (`Context.Tag` / `Layer`), providers, SQLite SoT, WS RPC
- `packages/gharargah-effect-acp` — ACP JSON-RPC stdio client (Gharargah-owned)
- `packages/gharargah-agents` — shared types + `ProviderRuntimeEvent` / commands + branded provider ids

## Architecture (t3-inspired, our code)

```
UI → host-client agents.* → WS agent-server
  → OrchestrationService (Effect Layer) → OrchestrationEngine
  → ProviderAdapter (ACP pool / Codex app-server / Claude Agent SDK / OpenCode SDK / Grok)
  → ProviderRuntimeEvent → thread projections (SQLite + JSON compat)
```

## Model discovery

`agents:refreshAgents` / `agents:refreshProviders` probe providers (60s TTL cache):

| Agent | Discovery |
|-------|-----------|
| Codex | `codex app-server` → `model/list` (paginated) |
| Cursor | `cursor-agent models` CLI (+ session `cursor/list_available_models`) |
| OpenCode | `opencode models` CLI |
| Claude | built-in sonnet/opus/haiku (+ effort config) |
| Grok | `auto` until session `models` state arrives |

Live model switch: `updateThreadSettings({model})` → ACP `session/set_model` (fallback `session/set_config_option`).
Session bind parses `session/new|load` modes / configOptions / availableModels onto the thread.

## Env

| Var | Meaning |
|-----|---------|
| `GHARARGAH_AGENT_RUNTIME` | `effect` (default) |
| `GHARARGAH_AGENT_HOST` | default `127.0.0.1` |
| `GHARARGAH_AGENT_PORT` | default `4751` |
| `GHARARGAH_AGENT_WS_URL` | override WS URL (E2E injects via `window.__GHARARGAH_AGENT_WS_URL__`) |
| `GHARARGAH_AGENT_MOCK=1` | mock ACP / deterministic native streams |
| `GHARARGAH_AGENT_MOCK_SCENARIO` | mock-acp scenario name |
| `GHARARGAH_MOCK_ACP_BIN` | path to `gharargah-mock-acp` |
| `GHARARGAH_CLAUDE_HOME` | Claude HOME isolation for instance |
| `GHARARGAH_AGENT_METRICS=1` | NDJSON turn metrics on stderr |
| `GHARARGAH_AGENT_METRICS_FILE` | NDJSON turn metrics file path |

## Dev / smoke

`pnpm dev` starts Rust host (FS/PTY/LSP), Vite, and agent-server sidecar.

```bash
pnpm --filter @gharargah/agent-server start
curl -s http://127.0.0.1:4751/health
# New session → Cursor / Codex (with GHARARGAH_AGENT_MOCK=1) streams in the Agent tab
```

E2E (`launchWeb` / `launchJet`) always spawns agent-server on a free port, waits `/health`, and injects the WS URL before UI boot.

## Drivers

| Agent | Primary driver | Notes |
|-------|----------------|-------|
| Cursor / Grok | ACP | pooled clients; idle reap 30m / tick 5m; host MCP loopback; resume preferred |
| Codex | app-server | streams until `turn/completed`; mock line-rpc in E2E |
| Claude | `@anthropic-ai/claude-agent-sdk` `query()` | mock binary / echo in E2E |
| OpenCode | `@opencode-ai/sdk` | `promptAsync` + SSE; mock echo in E2E |

## Desktop

Tauri spawns agent-server via `apps/agent-server/scripts/run.mjs` (Node + tsx) with the same login-shell `PATH` as the jet sidecar. Override entry with `GHARARGAH_AGENT_SERVER_ENTRY`. Agent-server also enriches a GUI-stripped `PATH` at boot (`shell-env.ts`) before emitting `agents:shellEnvReady`.

## Prior art

Design invariants (command receipts, approval blocking, ACP replay idle, idle reap timings, MCP bridge) take inspiration from `.t3code`. Implementation is Gharargah-authored — no wholesale package vendor.
