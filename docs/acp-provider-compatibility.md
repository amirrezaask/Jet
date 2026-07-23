# ACP provider compatibility

Profiles in `apps/server/src/host/acp/profiles.rs` define executable name, arguments, timeouts, restart metadata, and known quirks. They are launch profiles, not proof that the named provider works with every implemented ACP surface.

| Profile | Command | Status | Profile note |
|---|---|---|---|
| `cursor-acp` | `cursor-agent acp` | Verified by the app ACP route; provider-specific live smoke remains opt-in | Permission requests can arrive during a tool update. |
| `codex-acp` | `codex acp` | Launch-profile-only | Tool updates can omit a title. |
| `claude-acp` | `claude --acp` | Launch-profile-only | Authentication may require interactive completion; host auth flow is not implemented. |
| `opencode-acp` | `opencode acp` | Launch-profile-only | Session configuration can be unavailable. |
| `mock-strict` | `gharargah-mock-acp --scenario echo --strict` | Verified in automated ACP tests | Rejects malformed protocol messages. |
| `mock-compat` | `gharargah-mock-acp --scenario echo` | Mock launch profile; not a separately asserted compatibility contract | Described as compatibility-shaped updates. |
| `mock-chaos` | `gharargah-mock-acp --scenario chaos_malformed --strict` | Mock fault profile | Simulates malformed traffic; process disconnect behavior is selectable with `--fault disconnect`. |

`GHARARGAH_MOCK_ACP_BIN` overrides the mock executable for all `mock-*` profiles. Non-mock profiles resolve their executable name from `PATH`.

## Opt-in provider smoke

Do not put real provider credentials in normal test runs. With a provider CLI installed and already authenticated, choose its ACP driver in the desktop app, send a single harmless prompt in a disposable workspace, and inspect:

1. `agents:getConnectionState` reports `ready` after the turn.
2. The persisted thread has an `acpSessionId`.
3. A second prompt reuses the connection and attempts `session/load` only if the provider advertised it.
4. Interrupting a long response either receives `Cancelled` or reports `provider_unresponsive_after_cancel` after the 15-second grace period.

Authentication, terminal callbacks, structured plans/usage/commands, and unsaved-buffer filesystem behavior are not provider-smoke acceptance criteria because they are not implemented end-to-end.
