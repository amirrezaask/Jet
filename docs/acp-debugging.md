# ACP debugging

## Inspector channels (Effect agent-server WS)

RPC methods on `ws://127.0.0.1:4751/agents`:

| Method | Argument | Result |
|---|---|---|
| `agents:getAcpTrace` | `{ providerId?, workspaceRootPath? }` or provider id string | Redacted protocol-trace entries (bounded) |
| `agents:getConnectionState` | `{ providerId?, workspaceRootPath?, connectionKey? }` | `AgentConnectionState` from ACP pool |
| `agents:forceStopProvider` | `{ connectionKey?, providerId?, workspaceRootPath? }` | `{ ok, stopped: string[] }` |
| `agents:listAcpSessions` | same filters | `{ sessions: [{ connectionKey, sessionId }] }` |
| `agents:closeAcpSession` / `agents:deleteAcpSession` | `{ sessionId, … }` | `{ ok: true }` or `null` |
| `agents:logoutProvider` | filters | `{ ok: true }` or `null` |
| `agents:resolvePermission` | `{ permissionId, decision, optionId? }` | Resolves pending ACP permission |

`getAcpTrace` records redacted JSON-RPC in/out on each pooled `AcpClient` (not the old Rust lifecycle-only stub).

## Run mock scenarios

```sh
GHARARGAH_AGENT_MOCK=1 \
GHARARGAH_AGENT_MOCK_SCENARIO=permission_allow \
pnpm dev
```

Choose a mock agent thread and send a prompt. Permission cards use `{ permissionId, decision }` via `agents:resolvePermission`.

Standalone mock peer:

```sh
./apps/host-server/mocks/bin/gharargah-mock-acp \
  --scenario slow_stream --latency-ms 50 --chunk-size 8 --strict --trace
```

See `acp-mock-scenarios.md`. Use `GHARARGAH_MOCK_ACP_BIN` to override the mock path.

## Cancellation and stop behavior

`agents:interruptTurn` aborts the turn `AbortController`, calls adapter `interrupt`, and ACP `session/cancel`. After **15s** the client `forceKill`s the provider process if still alive.

`agents:forceStopProvider` immediately SIGKILLs matching pooled clients.

## Architecture

See [`acp-architecture.md`](./acp-architecture.md) and [`agents-effect-architecture.md`](./agents-effect-architecture.md). Rust `AcpSupervisor` is gone.
