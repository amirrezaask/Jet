# ACP architecture (Effect)

> **Migrated (2026-07):** ACP no longer lives in Rust `apps/server`. The live control plane is the Node Effect **agent-server**. This doc supersedes the old `AgentsHost` / `AcpSupervisor` description.

```
renderer → window.gharargah.agents (host-client)
        → WS ws://127.0.0.1:4751/agents
        → apps/agent-server OrchestrationEngine
        → AcpProviderAdapter → AcpClientPool → @gharargah/effect-acp (stdio JSON-RPC)
```

Rust `jet` still owns FS / PTY / git / LSP / search. Any `agents:*` invoke on jet returns:

`agents:* moved to Effect agent-server …`

## Key modules

| Layer | Path |
|-------|------|
| WS RPC | `apps/agent-server/src/rpc/server.ts` |
| Orchestration | `apps/agent-server/src/orchestration/engine.ts` |
| ACP adapter | `apps/agent-server/src/provider/acp-adapter.ts` |
| ACP pool + inspector | `apps/agent-server/src/provider/acp-pool.ts` |
| MCP loopback | `apps/agent-server/src/provider/mcp-bridge.ts` |
| ACP client | `packages/gharargah-effect-acp/src/client.ts` |
| Shared types | `packages/gharargah-agents/` |

## Desktop lifecycle

Tauri (`apps/gharargah/src-tauri/src/main.rs`) spawns:

1. **agent-server** — `node apps/agent-server/scripts/run.mjs` with login-shell PATH
2. **jet** sidecar — HTTP UI host

Dev (`pnpm dev` / `dev-web.mjs`) also starts agent-server via tsx.

See [`agents-effect-architecture.md`](./agents-effect-architecture.md) and [`acp-support-matrix.md`](./acp-support-matrix.md).
