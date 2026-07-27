# ACP architecture (Effect)

> **Migrated (2026-07):** ACP no longer lives in Rust `apps/server`. The live control plane is the Node Effect **agent-server**. This doc supersedes the old `AgentsHost` / `AcpSupervisor` description.

```
renderer → window.gharargah.agents (host-client)
        → WS ws://127.0.0.1:4751/agents
        → apps/agent-server OrchestrationEngine
        → AcpProviderAdapter → AcpClientPool → @gharargah/effect-acp (stdio JSON-RPC)
```

FS / PTY / git / LSP / search live in TypeScript `apps/host-server`. Any `agents:*` invoke on the host returns:

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

## Process lifecycle

`pnpm dev` (`apps/gharargah/scripts/dev-web.mjs`) starts:

1. **host-server** — TS HTTP/WS host on `:4747`
2. **agent-server** — Effect control plane on `:4751`
3. **Vite** — SPA (proxies API to host)

See [`agents-effect-architecture.md`](./agents-effect-architecture.md) and [`acp-support-matrix.md`](./acp-support-matrix.md).
