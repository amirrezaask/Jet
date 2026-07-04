# Agent visual verification

Scripted UI scenarios for `jet-web`. Playwright drives a headless Chromium against the running dev server, injects keys/text/commands via the `__jetAgent` bridge, and captures PNGs at scripted checkpoints. Designed for agent-in-the-loop feature building.

## Quick start

Terminal A — dev server:

```sh
pnpm dev:web
```

Terminal B — run a scenario:

```sh
pnpm visual tests/visual/scenarios/open_editor.json
```

Stdout prints one JSON line:

```json
{"scenario":"open_editor.json","screenshots":["/abs/path/test-results/agent-shots/open_editor.png"],"frames":0,"exit":0}
```

Run every scenario:

```sh
pnpm visual:all
```

## Environment

| Env | Effect |
|-----|--------|
| `JET_BASE_URL` | Override base URL (default `http://localhost:5174`) |

## Scenario format

```json
{
  "window": { "width": 1280, "height": 800 },
  "workspace": "fixtures/sample-workspace",
  "files": ["src/index.ts"],
  "steps": [
    { "wait": { "ms": 300, "animations_idle": true } },
    { "command": "ui.showCommandPalette" },
    { "screenshot": "test-results/agent-shots/palette.png" },
    { "key": "Escape" },
    { "text": "hello" },
    { "assert_state": { "paletteOpen": false } },
    { "exit": 0 }
  ]
}
```

### Step types

| Step | Description |
|------|-------------|
| `{ "wait_frames": N }` | Sleep N × 16ms |
| `{ "wait": { "frames": N, "ms": M, "animations_idle": true } }` | Combined wait |
| `{ "key": "Meta+Shift+P" }` | Playwright `keyboard.press` chord |
| `{ "text": "hello" }` | Type text |
| `{ "command": "id", "args": {} }` | Run registered command via `__jetAgent.executeCommand` |
| `{ "open_workspace": "path" }` | Load workspace via bridge |
| `{ "open_file": "src/x.ts" }` | Open file via bridge |
| `{ "screenshot": "path.png" }` | Save PNG (relative → repo root) |
| `{ "a11y_snapshot": "path.yaml", "selector": "body" }` | Save Playwright aria snapshot (YAML). Preferred for agents — greppable, diffable, no pixel noise. |
| `{ "dom_dump": "path.html", "selector": ".cm-editor" }` | Dump `outerHTML` of a subtree for CSS/structure debugging |
| `{ "assert_state": { key: value } }` | Compare `__jetAgent.getState()` fields |
| `{ "assert_a11y_contains": ["needle"], "selector": "body" }` | Fail if aria snapshot missing any needle (case-insensitive substring) |
| `{ "exit": 0 }` | End scenario with exit code |

### Which output do I use?

- **`a11y_snapshot` + `assert_a11y_contains`** — default. Text, diffable, cheap for agents to read. Verifies "palette opened", "editor visible", "N options listed", "focused element is X".
- **`assert_state`** — for programmatic state on the `__jetAgent` bridge (workspace path, tab kinds, palette open flag).
- **`screenshot`** — fallback / human sign-off. Use when the change is genuinely pixel-level: theme colors, layout dimensions, cursor animation, icons, motion. Do **not** rely on screenshots for structural checks — a11y snapshot is faster to diff.
- **`dom_dump`** — last resort for CSS class / computed-tree debugging (e.g. Tailwind purge regressions).

Key names: Playwright `KeyboardEvent.key` values (`A`, `Enter`, `Escape`, `ArrowDown`, `F5`). Chords with `+`: `Meta+Shift+P`.

Available command ids: see `packages/jet-app/src/app-commands.ts` — e.g. `ui.showCommandPalette`, `workspace.quickOpen`, `workspace.saveFile`, `editor.gotoLine`, `editor.find`.

## Bundled scenarios

| File | Captures |
|------|----------|
| `scenarios/welcome.json` | Welcome view (no workspace) |
| `scenarios/open_editor.json` | Editor with sample workspace |
| `scenarios/command_palette.json` | Palette open + closed |
| `scenarios/quick_open.json` | Quick open with filter typed |

## Agent workflow

1. Change the UI.
2. `pnpm dev:web` (leave running).
3. `pnpm visual tests/visual/scenarios/<scenario>.json` or `pnpm visual:all`.
4. Read PNGs listed in stdout JSON.
5. If frame is blank / palette not open: increase `wait` `ms`, or add `animations_idle: true`.

## Implementation notes

- Runner is `tests/visual/runner.ts`, standalone `tsx` script.
- Uses `@playwright/test` browser API, not the Playwright test runner — cleaner one-JSON-line contract for agents.
- Screenshots written relative to repo root; absolute paths passed through as-is.
- `assert_state` compares JSON-stringified equality against `__jetAgent.getState()` fields.
- No auto-start of `pnpm dev:web` — keep the dev server running in a separate terminal so scenario turnaround is a few seconds.
