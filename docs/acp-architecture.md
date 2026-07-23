# ACP architecture

ACP lives in `apps/server`. The desktop renderer calls `agents:*` host channels; `AgentsHost` owns the JSON thread store and an `AcpSupervisor`.

```text
renderer → agents:* RPC / events → AgentsHost
         → AcpSupervisor → ConnectionPool → ACP stdio provider process
                                      ↕
                           ACP notifications / requests
                                         ↓
                              session_id → SessionRuntime
```

## Lifecycle

`AcpSupervisor` rejects overlapping turns for a thread (`turn_already_running`), tracks a cancellation watch channel, keeps an in-memory connection snapshot/trace, and dispatches a `TurnJob`.

`ConnectionPool` keys workers by `provider-id:workspace-path`. A worker owns one provider process and initialized JSON-RPC connection (ACP v1 once). Turns for **different sessions run concurrently** on that connection; turns inside one session are exclusive (`TurnAlreadyRunning`). Every inbound notification/request is routed by ACP `session_id` into a `SessionRuntime` — there is no connection-global “current turn” handler.

Session restore:

- Prefer `session/resume` when advertised and local timeline already exists.
- Else `session/load` with routing + capture registered **before** the request (replay is kept).
- Never silently replace a missing/unloadable session with `session/new`; typed errors: `session_restore_unsupported`, `session_load_failed`, `session_resume_failed`.

`agents:forceStopProvider` signals shutdown, cancels turns, settles pending permissions, drops the worker (SDK `ChildGuard` kills the process group), and bumps connection generation. Ignored cancel after the grace window marks the connection degraded and force-stops.

Auth / list / close / delete / logout are capability-gated and implemented on the live connection (not stubs).

## Permission and filesystem bridge

`session/request_permission` creates a pending oneshot, emits a sequenced timeline permission item with **full option objects** `{id, kind, label}`, and waits for `agents:resolvePermission` with an exact `optionId` (or a decision mapped only against advertised options). Unknown options cancel/reject — never invent approval IDs.

`FsHandler` / `TerminalHandler` resolve paths against the **session** cwd/root set.

## Events and persistence

Each `SessionRuntime` owns a monotonic `Arc<AtomicU64>` sequence allocator seeded from `thread.acpSequence` (never reset per turn). Tool calls reduce by `toolCallId`; thoughts/plans use stable stream ids. The host merges timeline items by id (`created` vs `updated` in `agents:structuredDelta`) and emits full `threadUpdated` mainly at turn boundaries.

| Field | Meaning |
|---|---|
| `timeline` | Normalized items; tool/permission/plan/usage/thought/text |
| `pendingPermissions` | Full option objects awaiting resolve |
| `usage` / `plan` | Updated from ACP notifications |
| `acpSequence` | Last applied structured sequence |
| `connection` | UI connection status mapped from `ProviderConnectionSnapshot` |

## Test peer

`gharargah-mock-acp` + `apps/server/tests/mock_acp_scenario_matrix.rs` + `acp_phase14_runtime.rs`.
