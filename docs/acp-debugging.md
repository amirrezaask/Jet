# ACP debugging

## Inspector channels

The host RPC dispatcher exposes:

| Channel | Argument | Result |
|---|---|---|
| `agents:getAcpTrace` | Provider id, default `cursor-acp` | `{ providerId, entries }` |
| `agents:getConnectionState` | Provider id, default `cursor-acp` | `ProviderConnectionSnapshot` |
| `agents:resolvePermission` | `{ requestId, optionId }` | Resolves the pending ACP permission request. |

`getConnectionState` reports the supervisor's in-memory snapshot (`not_started`, `starting`, `ready`, or `degraded` in the current flow), timestamps, restart count, pid, and last error. Some declared states are reserved and are not yet transitioned by the live worker.

`getAcpTrace` is a lifecycle trace today: turn start, successful finish, and error. It is not raw JSON-RPC traffic; the bounded/redacted `ProtocolTrace` utility is not wired to the active connection.

## Run mock scenarios

For a full host-path test:

```sh
GHARARGAH_AGENT_MOCK=1 \
GHARARGAH_AGENT_MOCK_SCENARIO=permission_allow \
pnpm dev
```

Choose a mock agent thread and send a prompt. To resolve a pending request through the host today, invoke `agents:resolvePermission` with its raw `requestId` and one of the provider option ids, normally `allow_once` or `reject_once`. The shipped renderer sends a different `{permissionId, decision}` shape, so its permission card currently demonstrates the request but cannot complete this bridge.

To run the peer independently:

```sh
cargo run -p jet --bin gharargah-mock-acp -- \
  --scenario slow_stream --latency-ms 50 --chunk-size 8 --strict --trace
```

See `acp-mock-scenarios.md` for all scenarios and flags. Use `GHARARGAH_MOCK_ACP_BIN` when the host should use a particular built binary.

## Cancellation and stop behavior

`agents:interruptTurn` sets the host cancel watch and calls `AcpSupervisor::cancel_turn`. The connection sends ACP `session/cancel` once while the prompt request is in flight.

- A cooperative provider returns `StopReason::Cancelled`; the current thread UI still renders this as an interrupted/error message.
- If no prompt response arrives within 15 seconds after cancellation, the turn fails with `provider_unresponsive_after_cancel`.
- This is an honest timeout, not a fabricated cancelled result.
- There is no public per-provider force-kill RPC. Host shutdown cancels active turns and drops pooled worker senders; it does not synchronously kill a stuck provider process. To recover a truly stuck desktop session, restart the host/app and retain the error plus inspector state for diagnosis.

The pool serializes jobs per provider/workspace. A second prompt for the same thread is rejected with `turn_already_running`; it is not queued.
