# ACP provider compatibility

Profiles in `apps/server/src/host/acp/profiles.rs` define executable name, arguments, timeouts, restart metadata, and known quirks. Product routing uses the same profiles via `AgentsHost` → `AcpSupervisor` → `ConnectionPool` for every agent with an ACP driver (`*:acp`).

| Profile | Command | Product status | Profile note |
|---|---|---|---|
| `cursor-acp` | `cursor-agent acp` | Wired (default ACP for Cursor) | Permission requests can arrive during a tool update. |
| `codex-acp` | `codex acp` | Wired (ACP driver on Codex agent) | Tool updates can omit a title. |
| `claude-acp` | `claude --acp` | Wired (ACP driver on Claude agent) | Authentication may require interactive completion; use in-app auth banner. |
| `opencode-acp` | `opencode acp` | Wired (ACP driver on OpenCode agent) | Session configuration can be unavailable. |
| `mock-strict` | `gharargah-mock-acp --scenario echo --strict` | Verified in automated ACP tests | Rejects malformed protocol messages. |
| `mock-compat` | `gharargah-mock-acp --scenario echo` | Mock launch profile | Compatibility-shaped updates. |
| `mock-chaos` | `gharargah-mock-acp --scenario chaos_malformed --strict` | Mock fault profile | Malformed traffic; `--fault disconnect` optional. |

`GHARARGAH_MOCK_ACP_BIN` overrides the mock executable for all `mock-*` profiles. Non-mock profiles resolve their executable name from `PATH`. With `GHARARGAH_AGENT_MOCK=1`, every ACP agent id launches the mock binary through the normal pool path.

CLI (`*:cli`) drivers remain as fallback when the user picks them explicitly.

## Opt-in provider smoke

Do not put real provider credentials in normal test runs. With a provider CLI installed and already authenticated, choose its **ACP** driver in the desktop app, send a single harmless prompt in a disposable workspace, and inspect:

1. `agents:getConnectionState` reports `ready` after the turn (provider id = profile id, e.g. `codex-acp`).
2. The persisted thread has an `acpSessionId` and matching `acpProvider`.
3. A second prompt reuses the connection and attempts `session/load` / `session/resume` only if the provider advertised it.
4. Interrupting a long response either receives `Cancelled` or reports `provider_unresponsive_after_cancel` after the 15-second grace period.
5. Auth-required providers: connection banner shows authenticating → pick method → `agents:authenticate` → retry prompt.
6. Force-stop from ACP inspector kills the provider process and bumps connection generation.

Acceptance for smoke: (1)–(4). Auth, terminal timeline rows, plans/usage/commands, and image attach are covered by mock matrix + E2E, not required on every real CLI.
