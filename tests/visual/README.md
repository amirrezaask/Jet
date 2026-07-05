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
| `{ "assert_a11y_not_contains": ["needle"], "selector": "body" }` | Fail if aria snapshot contains any needle |
| `{ "assert_layout": { "selector": "[data-jet-list-item]", "min_items": 3, "min_unique_tops": 3, "min_row_height": 18 } }` | Fail if list rows overlap (unique `getBoundingClientRect().top` values) or row height too small |
| `{ "assert_no_overlap": { "selector": "[data-jet-list-item]", "min_items": 2, "tolerance_px": 0 } }` | Fail if any visible list rows share vertical + horizontal pixel overlap |
| `{ "assert_no_clipping": { "selector": "[data-jet-list-item]", "container_selector": "[data-jet-list-panel='explorer']" } }` | Fail if row text overflows without ellipsis or extends past container bounds |
| `{ "assert_row_spacing": { "selector": "[data-jet-list-item]", "min_items": 2, "max_gap_px": 2 } }` | Fail if consecutive rows have excessive vertical gap (catches virtualizer estimate drift) |
| `{ "assert_row_text_visible": { "selector": "[data-jet-list-item]", "min_items": 2, "min_glyph_height_px": 12, "text_selector": "span" } }` | Fail if row's inner text is invisible (0 opacity, transparent color, `display:none`, zero-height span, or overflowing row bounds). Catches "row DOM present but content clipped/hidden" bugs where selection highlight shows but no readable text. |
| `{ "click_selector": "[data-jet-list-item][aria-label=\"packages\"]", "nth": 0 }` | Click element matching CSS selector (optional `nth` for disambiguation) |
| `{ "wheel_scroll": { "selector": "[data-jet-list-panel=\"locationlist\"] ul", "delta_y": 800 } }` | Programmatic scroll on a container (for virtualized list regression) |
| `{ "exit": 0 }` | End scenario with exit code |

### Which output do I use?

- **`a11y_snapshot` + `assert_a11y_contains`** — default. Text, diffable, cheap for agents to read. Verifies "palette opened", "editor visible", "N options listed", "focused element is X".
- **`assert_state`** — for programmatic state on the `__jetAgent` bridge (workspace path, tab kinds, palette open flag).
- **`screenshot`** — fallback / human sign-off. Use when the change is genuinely pixel-level: theme colors, layout dimensions, cursor animation, icons, motion. Do **not** rely on screenshots for structural checks — a11y snapshot is faster to diff.
- **`dom_dump`** — last resort for CSS class / computed-tree debugging (e.g. Tailwind purge regressions).

### Anti-tautology rule (list/search scenarios)

Do NOT assert only the user-typed query. The input value contains it whether or not results rendered — a green run proves nothing. Every list/search scenario MUST include:

1. `assert_layout` with `min_items >= 1` on `[data-jet-list-panel="…"] [data-jet-list-item]`.
2. `assert_a11y_contains` with a needle that only appears in rendered rows (fixture filename, `:` line separator, etc.), scoped to the panel selector.
3. `assert_a11y_not_contains: ["No results"]` when a hit is expected.
4. `assert_no_overlap` + `assert_row_spacing` when >=2 rows expected.
5. `assert_row_text_visible` — catches "row exists in DOM but text is clipped/invisible" (e.g. `overflow-hidden` on a 36px row with `p-2` padding + two 14px line-height spans → text pushed out of visible area, only selection highlight is drawn).

`project_search.json` and `quick_open.json` are the canonical templates.

### Electron-only checks

Traffic lights, native menu, folder dialogs, and Electron main IPC are invisible to the browser runner. Add specs to `tests/electron/*.electron.spec.ts` (Playwright `_electron.launch`) and run `pnpm test:electron`. Do NOT try to verify traffic-light overlap via `?titlebar=1` — that renders the React component without the underlying window.

Key names: Playwright `KeyboardEvent.key` values (`A`, `Enter`, `Escape`, `ArrowDown`, `F5`). Chords with `+`: `Meta+Shift+P`.

Available command ids: see `packages/jet-app/src/app-commands.ts` — e.g. `ui.showCommandPalette`, `workspace.quickOpen`, `workspace.saveFile`, `editor.gotoLine`, `editor.find`.

## Bundled scenarios

| File | Captures |
|------|----------|
| `scenarios/welcome.json` | Welcome view (no workspace) |
| `scenarios/open_editor.json` | Editor with sample workspace |
| `scenarios/command_palette.json` | Palette open + closed |
| `scenarios/quick_open.json` | Quick open with filter typed |
| `scenarios/vercel_dark_shell.json` | Dark Vercel shell + editor |
| `scenarios/vercel_light_toggle.json` | Dark/light color scheme toggle |
| `scenarios/goto_line_dialog.json` | Go to line shadcn dialog |
| `scenarios/explorer_location_list.json` | Explorer + location list panels |
| `scenarios/explorer_jet_repo_layout.json` | Full repo explorer — row spacing layout check |
| `scenarios/explorer_with_editor.json` | Explorer splits left; editor stays visible |
| `scenarios/palette_no_preselect.json` | Palette opens with no pre-selection; filter + run command |
| `scenarios/zoom.json` | Zoom in/out via command |
| `scenarios/zoom_keybindings.json` | Zoom in/out via Cmd+= / Cmd+- |
| `scenarios/buffer_list.json` | Buffer list overlay |
| `scenarios/editor_find.json` | In-buffer find panel |
| `scenarios/explorer_deep_expand.json` | Explorer nested expand + overlap/layout checks |
| `scenarios/explorer_narrow.json` | Explorer in narrow viewport + overlap check |
| `scenarios/explorer_search_results.json` | Location list project search results + spacing |
| `scenarios/search_scroll.json` | Virtualized search list after scroll + spacing |

Run all scenarios via Playwright: `pnpm test:visual`

### Screenshot golden tests (explorer)

Pixel-diff against committed baselines — catches overlap/layout regressions a11y checks miss:

```sh
pnpm test:visual:screenshots          # compare to tests/visual/golden/...
pnpm test:visual:screenshots:update   # refresh baselines after intentional UI change
```

Golden files: `tests/visual/golden/explorer-screenshot.spec.ts/*.png`

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
