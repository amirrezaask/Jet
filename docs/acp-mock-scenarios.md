# Mock ACP scenarios

`gharargah-mock-acp` is a deterministic ACP v1 stdio peer. Run it directly after building the server package:

```sh
cargo run -p jet --bin gharargah-mock-acp -- --scenario echo --strict --trace
```

The host normally locates the sibling mock binary. Set `GHARARGAH_MOCK_ACP_BIN=/absolute/path/to/gharargah-mock-acp` to override it.

## Host environment

| Variable | Effect |
|---|---|
| `GHARARGAH_AGENT_MOCK=1` | Routes agent turns through the real mock ACP process. |
| `GHARARGAH_AGENT_MOCK_LEGACY=1` | Together with `GHARARGAH_AGENT_MOCK=1`, uses the old in-process fake text stream instead. |
| `GHARARGAH_AGENT_MOCK_SCENARIO=<name>` | Scenario passed by the host to the strict mock process; default `echo`. |
| `GHARARGAH_MOCK_ACP_BIN=<path>` | Overrides mock executable discovery. |

## CLI flags

| Flag | Default | Meaning |
|---|---:|---|
| `--scenario <name>` | `echo` | Select behavior below. |
| `--seed <n>` | `1` | Seed for deterministic jitter. |
| `--latency-ms <n>` | `0` | Delay applied between mock actions. |
| `--jitter-ms <n>` | `0` | Additional seeded delay. |
| `--chunk-size <n>` | `12` | UTF-8-safe stream chunk size. |
| `--fault malformed\|disconnect` | — | Inject malformed JSON or a prompt failure. |
| `--trace` | false | Print ACP traffic to stderr. |
| `--capabilities load_session` | — | Advertise selected capability overrides. |
| `--provider-profile <name>` | `mock` | Label in mock agent metadata. |
| `--exit-after <n>` | `0` | Exit after `n` prompt turns; zero is unlimited. |
| `--stderr-noise <n>` | `0` | Emit harmless startup stderr lines. |
| `--strict` | false | Reject unknown scenarios and non-v1 initialization. |

Without `--strict`, an unknown scenario warns on stderr and falls back to `echo`.

## Scenarios

| Scenario | Behavior |
|---|---|
| `echo` | One `AgentMessageChunk`: `Mock agent reply: <prompt>`. |
| `thought_then_answer` | Emits an `AgentThoughtChunk`, then the echo answer. |
| `tool_lifecycle` | Emits one tool call through pending, in-progress, and completed states, then answers. |
| `permission_allow` | Sends an in-progress tool update and asks permission; answers only if `allow_once` is selected, otherwise stops with refusal. |
| `permission_tool_race` | Same wire ordering as `permission_allow`; exists to exercise tool-update/permission-request concurrency. |
| `permission_allow_always` | Like `permission_allow`, but also offers `allow_always` / “Always allow”. |
| `plan_update` | Emits a two-entry plan, then answers. |
| `cancel_coop` | Emits a thought and waits up to 60 seconds for `session/cancel`; acknowledges it with `Cancelled`. |
| `slow_stream` | Streams the echo response in configurable chunks; stops cleanly on cancel. |
| `usage_meter` | Emits usage `128 / 4096`, then answers. |
| `config_model` | Returns selectable model config options `mock-auto` and `mock-fast` from `session/new`. |
| `slash_commands` | Emits `/mock` and `/reset` available commands, then answers. |
| `chaos_malformed` | Writes intentionally malformed JSON after init, then fails the prompt (`internal_error`). |
| `load_session` | Advertises load support and emits a replay message during `session/load`, then answers. |
| `fs_roundtrip` | Treats prompt text as a path, requests `fs/read_text_file`, and emits the contents. |
| `terminal_roundtrip` | Creates a client terminal (`/bin/echo hi`), waits for exit, reads output, releases, then emits `Mock terminal: …`. |
| `multi_session` | Currently follows echo behavior; useful for exercising multiple sessions over one connection. |
| `ask_question` | Sends `cursor/ask_question`; answers with selected option in the echo text. |
| `create_plan` | Sends `cursor/create_plan` with markdown + todos, then answers. |
| `update_todos` | Emits `cursor/update_todos` notification, then answers. |
| `elicitation` | Sends `elicitation/create` (form mode); continues after accept/decline/cancel. |
| `auth_required` | Advertises `mock-token` auth at initialize; host must authenticate before prompts succeed. |
| `image_prompt` | Counts image content blocks in the prompt and echoes `images=N <prompt>`. |

`--fault malformed` is equivalent to the malformed part of `chaos_malformed`; `--fault disconnect` makes answer generation fail. `--capabilities load_session` can advertise loading outside `load_session`.

## Required test coverage

Every `Scenario::ALL` entry MUST have:

1. **Supervisor/protocol** — `apps/server/tests/mock_acp_scenario_matrix.rs` (`matrix_<scenario>` + `every_mock_scenario_has_a_matrix_entry` drift guard).
2. **Host/UI e2e** — `tests/electron/acp-mock-scenarios.electron.spec.ts` (`scenario:<name>` + name-list guard).

Adding a scenario without both tests fails CI. Run:

```sh
cargo test --manifest-path apps/server/Cargo.toml --test mock_acp_scenario_matrix
pnpm exec playwright test tests/electron/acp-mock-scenarios.electron.spec.ts --project=web-e2e
```
