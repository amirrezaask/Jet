# ACP architecture

ACP lives in `apps/server`. The desktop renderer calls `agents:*` host channels; `AgentsHost` owns the JSON thread store and an `AcpSupervisor`.

```text
renderer → agents:* RPC / events → AgentsHost
         → AcpSupervisor → ConnectionPool → ACP stdio provider process
                                      ↕
                           ACP notifications / requests
```

## Lifecycle

`AcpSupervisor` rejects overlapping turns for a thread (`turn_already_running`), tracks a cancellation watch channel, keeps an in-memory connection snapshot/trace, and dispatches a `TurnJob`.

`ConnectionPool` keys workers by `provider-id:workspace-path`. A worker owns one provider process and initialized JSON-RPC connection, initializes ACP v1 once, then serially receives jobs through a bounded Tokio channel (32). Sessions are created or loaded on that connection before each prompt. The host captures the application Tokio `Handle`; ACP work runs on that shared runtime even though the host starts a small blocking OS thread to bridge the synchronous host entry point.

The client currently advertises `session.config_options`, filesystem read/write, and `terminal` capabilities. It handles ACP `terminal/create|output|wait_for_exit|kill|release` via a per-connection `TerminalHandler` (bounded 256KB output, workspace cwd containment). It sends `session/cancel` on cancellation and returns `provider_unresponsive_after_cancel` if the peer has not answered within 15 seconds. `agents:forceStopProvider` drops the connection-pool worker; `agents:listAcpSessions` / `close_session` are capability-gated stubs; `agents:authenticate` is a no-op when auth is not required.

## Permission and filesystem bridge

`session/request_permission` becomes a pending supervisor oneshot request and an `agents:permissionRequest` event. The host resolver accepts `{requestId, optionId}` and forwards the selected provider option. The current renderer sends `{permissionId, decision}` instead, so its permission cards do not yet resolve live ACP requests. Absent or dropped resolution cancels the request. There is no production auto-approval path.

`FsHandler` canonicalizes the workspace root and requested paths before every read/write, rejects relative paths and symlink escapes, and permits new files only under an already-canonicalized parent inside that root. It handles ACP `fs/read_text_file` and `fs/write_text_file`. `TerminalHandler` owns short-lived PTYs for ACP terminal methods with the same workspace-root containment.

## Events and persistence

The live path streams text snapshots into legacy `messages`, writes the ACP session id, stores a transient activity label, and persists permission timeline entries. Thread JSON files under `<workspace>/.gharargah/agents/threads/` are authoritative. ACP-added fields are:

| Field | Current meaning |
|---|---|
| `timeline` | Additive normalized-item array; currently permission items are persisted by the live supervisor callback. |
| `pendingPermissions` | Permission payloads awaiting `agents:resolvePermission`. |
| `usage` | Reserved persisted field; not populated by the live ACP update handler. |
| `plan` | Reserved persisted field; not populated by the live ACP update handler. |
| `acpSequence` | Reserved sequence field; permission callback currently writes `0`; sequenced structured deltas are not live. |

`EventPipeline` provides monotonic sequence assignment and text coalescing, and `ProtocolTrace` provides bounded, redacted trace storage, but neither is currently connected to the `ConnectionPool` notification path. The supervisor inspector trace currently records only turn start/finish/error metadata.

## Test peer

`gharargah-mock-acp` is a separate stdio ACP v1 binary. `GHARARGAH_AGENT_MOCK=1` routes normal agent turns through it; `GHARARGAH_AGENT_MOCK_LEGACY=1` additionally selects the old in-process fake stream. See `acp-mock-scenarios.md`.
