# AGENTS.md — Jet Editor

Guide for AI agents and contributors working in this repo.

## What Jet Is

**Jet** (Jasmin Extensible Text Editor) is a greenfield desktop code editor inspired by RAD Debugger / 4coder / Nameless Editor aesthetics, built as a modern Electron app.

**Core split:**


| Layer             | Owns                                                   |
| ----------------- | ------------------------------------------------------ |
| **CodeMirror 6**  | Text buffer, syntax, LSP client, keymaps inside editor |
| **Jet Workspace** | Files, open buffers, dirty state, commands, jump stack, tasks |
| **Jet Panels**    | Split tree — one view per panel (no tab bar)                  |
| **Jet UI / App**  | React shell, themes, explorer, location list, output        |
| **Electron main** | FS, search, LSP bridge, task spawn                            |


React holds **orchestration state** (panel tree, focus, palette). Editor document text lives in **CodeMirror**, not React state.

## Reference Material (read-only)

Sibling / parent dirs are **design references**, not dependencies:

- `.vscode/` — UX patterns
- `.4coder*`, `.raddebugger/` — RAD/imui panel mental model
- `Nameless_Editor/` — editor UX ideas

Do **not** copy large chunks wholesale; match Jet’s architecture.

---



## Monorepo Layout

```
jet/
├── apps/
│   └── jet-desktop/        Electron shell (main, preload, vite config)
├── fixtures/
│   └── sample-workspace/   Fixture project for Electron smoke tests
├── packages/
│   ├── jet-shared/         URIs, Emitter, git types, panel primitives
│   ├── jet-node-host/      Shared Node FS/git helpers
│   ├── jet-panels/         PanelTree — splits, tabs, resize, serde
│   ├── jet-workspace/      WorkspaceService, TabRegistry, commands, keymaps
│   ├── jet-codemirror/     createJetEditorView, theme, languages, LSP transport
│   ├── jet-lsp/            LanguageServerManager (renderer-side)
│   ├── jet-extension-host/ JetAPI + loadEditorRc
│   ├── jet-ui/             PanelDock, tabs, CommandPalette, themes
│   └── jet-app/            JetApp root React component + index.html
├── tests/
│   ├── electron/           Playwright Electron E2E specs
│   └── bench/              UX latency benchmarks
├── package.json            turbo scripts, postinstall electron rebuild
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```



### Package dependency direction

```
jet-shared  ←  jet-panels, jet-workspace
jet-workspace + jet-panels + jet-codemirror  ←  jet-ui
jet-ui + jet-workspace + jet-lsp + jet-extension-host  ←  jet-app
jet-app  ←  jet-desktop
```

Keep imports acyclic. Lower layers must not import React or Electron.

---



## Commands

```bash
pnpm install          # runs postinstall: pnpm rebuild electron
pnpm dev              # turbo → jet-desktop vite + electron
pnpm typecheck        # all packages (TypeScript 7)
pnpm test:electron    # Playwright Electron specs (headless via JET_E2E)
pnpm test:bench       # UX latency benchmarks (tests/bench/)
pnpm build            # production build (renderer + electron main/preload)
```

Run typecheck from repo root before finishing a task:

```bash
pnpm -r typecheck
```

Monorepo uses **TypeScript 7** (`^7.0.2` at root; `pnpm.overrides` in `pnpm-workspace.yaml` pins one version).

Then validate with **`pnpm test:electron`** (see Agent visual verification).

---



## Agent visual verification (MANDATORY)

**Non-negotiable for every agent:** any change that can affect what the user sees — UI, layout, theming, commands, keybindings, shell, panels, editor surface, palette, welcome, explorer views, error/status messages — MUST be verified with Playwright Electron specs before the task is reported done. Typecheck / lint / unit tests are necessary but NOT sufficient.

### Preferred: Electron Playwright specs (headless)

Specs live in `tests/electron/*.electron.spec.ts`. `launchJet()` sets `JET_E2E=1`, which hides the window unless `JET_HEADED=1` or `PWDEBUG=1`.

1. Run all Electron specs: `pnpm test:electron`
2. Add or extend a spec under `tests/electron/` — helpers in `tests/helpers/` and `tests/electron/_launch.ts`. See `tests/README.md`.
3. Perf-sensitive changes (startup, editor mount, palette, search, theme) → also `pnpm test:bench`
4. New feature → new spec with structural assertions (`expect`, `expectLayout`, scoped panel selectors). Do not rely on unrelated specs to cover new paths.
5. Run `pnpm test:electron` before declaring a broad UI change complete.

**Verification preference (strict):**

1. DOM/text assertions via Playwright `expect` on scoped selectors (palette open, row content, panel visibility).
2. `window.__jetAgent.getState()` — workspace path, palette flag, panel kinds, font size.
3. List helpers — `expectLayout`, `expectNoOverlap`, `expectRowTextVisible` on `[data-jet-list-panel="…"] [data-jet-list-item]`.
4. Benchmarks — `pnpm test:bench` for latency regressions (median vs `tests/bench/budgets.json`).

**Out of scope for automation (document explicitly if touched):** native OS folder/file dialogs, unimplemented git stage/revert chords.

### Anti-tautology rules for list/search UIs (MANDATORY)

Query echoes are worthless as proof. Asserting `export` in `body` after typing `export` passes when the input value contains `export` — even if the result list is empty. Every list/search spec MUST include:

1. **Row-count layout assertion** — `expectLayout` with `minItems >= 1` on `[data-jet-list-panel="…"] [data-jet-list-item]`.
2. **Positive result content** — `expect(locator).toContainText(...)` on the scoped panel with a needle that only appears in rendered rows (fixture filename, path segment, `:` line separator). Never assert the user-typed query alone.
3. **Negative empty-state assertion** — `not.toContainText("No results")` when a hit is expected.
4. **Spacing/overlap** — `expectNoOverlap` + `expectRowSpacing` when >=2 rows are expected.
5. **Row text visibility** — `expectRowTextVisible` on the scoped selector.

Scope every list assertion with the panel data attribute (`[data-jet-list-panel="locationlist"] [data-jet-list-item]`) so unrelated lists in the shell (tabs, sidebar) don't satisfy the assertion by accident.

### Native chrome & Electron IPC

Any change to title bar geometry, native menu, window frame, or Electron IPC (`fs:*`, `git:*`, `lsp:*`, `search:*`, `agents:*`) MUST have a sibling spec in `tests/electron/`. Run `pnpm test:electron`. Canonical example: `tests/electron/titlebar.electron.spec.ts` (macOS traffic-light clearance).

### Headed debugging

```bash
JET_HEADED=1 pnpm test:electron   # show BrowserWindow
PWDEBUG=1 pnpm test:electron      # Playwright inspector + headed
```

### Parallelism

Electron specs run in parallel (`fullyParallel: true`). Worker count defaults to half of CPU cores (min 2; capped at 4 on CI). Each launch gets an isolated `JET_E2E_USER_DATA` temp dir, so instances do not share state.

Override workers: `PLAYWRIGHT_WORKERS=6 pnpm test:electron`.

### Disabled flaky E2E specs

Twelve specs are temporarily skipped via `tests/electron/_flaky.ts` (`describeFlaky` / `skipFlakyTest`; re-enable with `JET_E2E_RUN_FLAKY=1`). Re-enable all for triage:

```bash
JET_E2E_RUN_FLAKY=1 pnpm test:electron
```

| Spec file | Test | Likely fix |
| --------- | ---- | ---------- |
| `agents-mock.electron.spec.ts` | mock agent turn | Stabilize composer tab activation before submit |
| `agents.electron.spec.ts` | real cursor-agent turn | Longer turn timeout; poll thread status after stream ends |
| `dirty-close-confirm.electron.spec.ts` | dismiss/accept close | Ensure `workspace.closeBuffer` targets focused dirty buffer |
| `editor-save.electron.spec.ts` | save persists to disk | Per-test temp copy of fixture file (avoid shared `index.ts` races) |
| `locationlist-commands.electron.spec.ts` | both | Use `getByLabel("Search project")`; wait for scan-ready |
| `lsp.electron.spec.ts` | go to definition | Place cursor on `greet` symbol reliably; wait for definition response |
| `open-file-overlay.electron.spec.ts` | open file overlay | Confirm overlay with `Meta+Enter`; retry `waitForEditor` |
| `search-show.electron.spec.ts` | search.show hits | Wait for FFF/rg index; assert scoped list rows |
| `switch-project.electron.spec.ts` | project switcher | Register `workspace.switchProject` command + overlay |
| `terminal.electron.spec.ts` | xterm row height | Wait for PTY output before measuring `.xterm-row` |
| `terminal.electron.spec.ts` | OSC title → tab label | Wire xterm title handler to tab registry label |
| `titlebar.electron.spec.ts` | View → Show Explorer | Radix menubar submenu open + click timing |

### Programmatic control (`window.__jetAgent`)

After `launchJet()`:

```javascript
await window.__jetAgent.waitForReady()
await window.__jetAgent.openWorkspace("fixtures/sample-workspace")
await window.__jetAgent.openFile("src/index.ts")
await window.__jetAgent.waitForEditor()
await window.__jetAgent.executeCommand("ui.showCommandPalette")
window.__jetAgent.getState()
window.__jetAgent.getPerfMeasures()  // User Timing measures (jet:*)
```

### Dev gotchas (Electron + Vite)

1. **Electron binary missing** — `path.txt` absent under `node_modules/.../electron/`
  Fix: `pnpm rebuild electron` or `node node_modules/.pnpm/electron@*/node_modules/electron/install.js`
2. **Vite** `root` **is** `packages/jet-app` but electron lives in `apps/jet-desktop`.
  Electron build **must** use explicit `outDir`:
   `package.json` `"main": "dist-electron/main.js"` is relative to `apps/jet-desktop`.
3. **Do not bundle** `ws` in main process — mark external in rollup or you get `bufferutil` resolve errors.
4. **Dev URL** — main process loads `process.env.VITE_DEV_SERVER_URL`, not hardcoded `:5173`.
5. **Stale dev processes** — if port conflict: `pkill -f Electron` then `pnpm dev`.
6. **Stray output** — old builds may land in `packages/jet-app/dist-electron/`; canonical output is `apps/jet-desktop/dist-electron/`. Both are gitignored where applicable.
7. **Tailwind v4 position utilities missing** — Vite root is `packages/jet-app`; classes like `absolute` / `fixed` / `inset-0` used only in sibling packages (`jet-ui`, …) were not generated until `@source` was added in `jet-ui/src/styles/globals.css`. Symptom: panels stack vertically (editor at bottom), palette full-width. After CSS changes, reload window if HMR does not pick up `@source`.

---



## Architecture Details



### Desktop CLI startup

Electron main resolves launch target from `process.argv` + `process.cwd()` via `@jet/node-host` `resolveLaunchTarget`:

- No args → open `cwd` as workspace
- Directory arg → open that directory
- File arg → open file; workspace = nearest project root (`.git`, `package.json`, `tsconfig.json`, `Cargo.toml`, `go.mod`, `.jet`)

Forwarded to renderer via `jet:getLaunchConfig` IPC; macOS `open-file` and second-instance reuse `jet:launch`.

### Electron IPC (`window.jet`)

Exposed via preload → `@jet/workspace` types (`JetElectronAPI`).


| Channel                                                | Purpose                          |
| ------------------------------------------------------ | -------------------------------- |
| `fs:readFile`, `fs:writeFile`, `fs:readDir`, `fs:stat` | File URIs (`file://...`)         |
| `fs:showOpenFolderDialog`                              | Native folder picker             |
| `git:isRepo`, `git:status`, `git:diff`                 | Git CLI wrappers                 |
| `lsp:start`, `lsp:stop`                                | Spawn language server, WS bridge |


Main entry: `apps/jet-desktop/src/main/main.ts`  
Handlers: `fs.ts`, `git.ts`, `lsp-bridge.ts`

### Panel docking (`@jet/panels`)

- `PanelTree` — row/column splits, tab groups, 5-way drop (edges + center)
- `editorOnlyLayout()` / `defaultLayout()` — single full-width editor panel (no sidebar split by default)
- `workspaceLayout()` — row split: sidebar left (~22%) + main editor right (~78%); used when splitting for explorer/git on demand
- Serializable via `toJSON()` / `fromJSON()`; `sanitizeKnownTabs()` strips orphan tab ids when needed
- UI: `PanelDock`, `TabRow`, `DropOverlay` in `@jet/ui`
- `resolveEditorPanel()` in `App.tsx` — new/open editor tabs route to main editor panel (not sidebar)

**Panel model:** all leaf panels are equal — no "explorer panel" vs "editor panel". Tab kind differs (`explorer`, `editor`, `git`, …). View commands can target `focusedPanel`; editor open/new file targets main editor panel.

**Known gaps:**

- **Tab drag/drop** — same-panel reorder works; cross-panel move / edge-split mostly works but needs polish (drop hit targets, registry sync). OK for now; not P0 blocker.
- Split resize works (pointer capture + 12px hit slop); may feel laggy during layout animation



### Workspace (`@jet/workspace`)

- `WorkspaceService` — root folder, file cache, dirty tracking, open editor tabs
- `TabRegistry` — maps `TabId` → tab kind + label + dirty flag
- Tab kinds: `editor`, `explorer`, `git`, `terminal` (stub), `search` (shell), `problems` (stub), `agent-explorer`, `agent-chat`



### Editor surface (`@jet/codemirror` + `EditorTabHost`)

- `createJetEditorView()` — imperative CM6 mount; **never** put doc text in React state
- `viewByTab` Map in `EditorTabHost.tsx`; use `getEditorView(tabId)` for active editor access
- `executeCommand` passed via ref — layout/tab events must not remount editor
- Autofocus on active editor tab in focused panel; `tabSelect` on editor tabs calls `view.focus()`
- `applyUserKeymaps()` — Compartment-based bridge from `KeymapService` → CM keymap
- `motionCursor` — Fleury bracket cursor + exp-smooth animation; reduced-motion snap
- `isLargeFile()` — skips LSP for huge files
- Languages loaded lazily via Shiki/lang packages in `languages.ts`



### Commands & palette

Registered in `packages/jet-app/src/App.tsx`:


| Command                 | Default key           |
| ----------------------- | --------------------- |
| `ui.showCommandPalette` | Mod-p                 |
| `ui.toggleColorScheme`  | — (palette: Toggle Color Scheme) |
| `workspace.openFolder`  | Cmd-k Cmd-o (native dialog) |
| `workspace.cd`          | — (palette: Change Directory) |
| `workspace.openFile`    | Mod-o                 |
| `workspace.saveFile`    | Mod-s                 |
| `workspace.newFile`     | Mod-n                 |
| `editor.find`           | Mod-f                 |
| `editor.replace`        | Mod-h                 |
| `editor.gotoLine`       | Mod-g                 |
| `workspace.quickOpen`   | Mod-Shift-o           |
| `layout.closeTab`       | Mod-w                 |
| `git.showChanges`       | Mod-Shift-g           |
| `explorer.show`         | Mod-Shift-e           |
| `search.show`           | Mod-Shift-f           |
| `problems.show`         | —                     |
| `terminal.show`         | —                     |
| `agents.show`           | — (palette: Show Agents) |
| `agent.new`             | — (palette: New Agent) |
| `agent.archive`         | Cmd-Backspace (agent chat focused) |
| `agent.unarchive`       | Cmd-Shift-Backspace (agent chat focused) |


`CommandRegistry.execute()` receives `getActiveEditorView: () => unknown` — cast to `EditorView` in handlers that need `view.state.doc`.

### Extension host (`@jet/extension-host`)

- `createJetAPI()` — commands, keymaps, editor extensions, workspace, ui
- `loadEditorRc(path, jet)` — dynamic import of `.jet/editorrc.ts` on folder open
- `registerExtensions()` — CodeMirror extensions applied via `extensionCompartment` in `EditorTabHost`



### LSP

- Main: spawns `typescript-language-server --stdio`, bridges stdio ↔ WebSocket
- Renderer: `@codemirror/lsp-client` via custom `simpleWebSocketTransport` in `jet-codemirror`
- `LanguageServerManager.ensureServerForFile()` — TS/JS only for now
- Requires `typescript-language-server` on **PATH** (TS/JS)
- Requires `rust-analyzer` on **PATH** for Rust (optional)
- Project search uses `@ff-labs/fff-node` (FFF) when available; falls back to `rg` (ripgrep) on **PATH**
- `findProjectRoot()` uses `pathToFileUri` from `@jet/shared`



### UI tabs


| Tab      | Status                                                     |
| -------- | ---------------------------------------------------------- |
| Explorer | shadcn Sidebar + Collapsible file tree                 |
| Git      | `@pierre/diffs` patch view + git status list (lazy-loaded) |
| Editor   | CodeMirror host + in-buffer find                           |
| Search   | Project ripgrep search + in-buffer find                    |
| Problems | LSP/CM lint diagnostics list + jump                        |
| Terminal | xterm + node-pty (Electron); browser stub                  |
| Agent explorer | Sidebar thread list per workspace root; archive section |
| Agent chat | T3-style composer, streaming timeline, provider/model picker |



### Agents (`@jet/agents` + Electron main)

- **Storage:** `.jet/agents/state.json` per workspace root (threads, messages, provider/model selection)
- **Transport:** `window.jet.agents` IPC in Electron; `POST /__jet/agents/*` in browser dev middleware
- **Drivers (Electron):** cursor → claude → codex (`apps/jet-desktop/src/main/agent-drivers/`); probes PATH + `cursor-agent models` for model list
- **Browser dev:** mock async turns only (`packages/jet-node-host/src/dev-agent-turn.ts`); no real CLI
- **Env:** `JET_AGENT_MOCK=1` forces mock driver in Electron (also always mock in browser)
- **Push updates:** `agents:threadUpdated` IPC in Electron; browser polls `readThread` during turns
- **Key files:** `packages/jet-agents/`, `packages/jet-ui/src/agents/`, `apps/jet-desktop/src/main/agents.ts`, `packages/jet-app/src/tabs/agent-*.tab.ts`
- **Tests:** `tests/electron/agents.electron.spec.ts` (real `cursor-agent`, skipped when CLI absent); `tests/electron/agents-mock.electron.spec.ts` (`JET_AGENT_MOCK=1`)

Manual Electron smoke: `pnpm dev` → `agent.new` → send prompt → interrupt via stop button → archive via explorer context menu or `agent.archive`.




### Theming

- `defaultJetTheme` + CSS vars via `applyJetThemeCss()`
- Tailwind v4 + custom RAD-ish tokens in `jet-ui/src/styles/globals.css`
- `@source` **in globals.css** — must scan all workspace packages so position/layout utilities emit for `jet-ui` components
- Bundled themes in `jet-ui/src/theme/bundled.ts` (default, 4coder, Catppuccin Mocha, One Dark, Gruvbox Dark, Nord)
- Dark/light Vercel theme via `ui.toggleColorScheme` / `ui.setColorScheme.dark|light`; persisted in `localStorage` (`jet-color-scheme`)
- Shell UI: shadcn/ui primitives in `packages/jet-ui/src/components/ui/`
- Command palette — `createPortal` to `document.body`; inline styles for centering (layout-critical)

---



## Coding Conventions

1. **Minimal scope** — smallest correct diff; no drive-by refactors
2. **Match existing style** — ESM `.js` extensions in TS imports, strict TS, no `@types/node` in `jet-shared`
3. **URI discipline** — use `pathToFileUri` / `fileUriToPath` from `@jet/shared`; avoid `process.platform` in shared packages
4. **Panel mutations** — clone tree → mutate → `commitTree()` pattern in App (immutable-ish updates)
5. **Exports** — packages expose `./src/index.ts` directly (no build step for libs); Vite bundles app
6. **Do not edit** the planning doc at `.cursor/plans/jet_editor_plan_*.plan.md`
7. **Commits** — only when user asks



### TypeScript

- Each package has `"typecheck": "tsc --noEmit"`
- Packages `extends` root `tsconfig.base.json`; no project references (composite disabled)
- `@jet/app` depends on `@jet/shared` explicitly when importing shared types

---



## What Works Today (smoke test)

1. `pnpm dev` → editor shell with workspace from cwd/CLI args
2. **Open Folder** / `workspace.cd` / query URL / `__jetAgent.openWorkspace()` / desktop CLI (`jet .`, `jet path/to/file`) → FS + optional `.jet/editorrc.ts`
3. Default layout on first open — **editor only** (no explorer/git until `explorer.show` / `git.showChanges`)
4. Explorer tree — on demand via Mod-Shift-e; click file → editor tab
5. Edit + **Mod-s** save (click editor tab first if needed)
6. **Mod-p** command palette — centered screen modal
7. Location list (`locationlist.show`) — search + problems unified panel
8. Output panel + `task.run` (Electron; browser stub)
9. Jump stack — `navigation.jumpBack` / `jumpForward` (Alt-j / Alt-Shift-j)
10. Buffer list — `workspace.bufferList` (Cmd-Shift-b)
11. Panel split resize — drag gutter between panels
12. No tab bar — one file per editor panel; quick-open (Cmd-p) switches buffer

---



## Prioritized Next Work

Design references (read-only): `.4coder/`, `.4coder_fleury/`, `.raddebugger/`, `Nameless_Editor/`. Jet aspires to **RAD/Nameless shell polish** + **4coder/Fleury editor identity** on CodeMirror 6 + Electron — not a port.

Parity work is grouped by **tier** (Shell / Editor / Workspace / 4coder-specific) inside each phase.


| Tier                | Scope                                                     |
| ------------------- | --------------------------------------------------------- |
| **Shell**           | Panels, chrome, palette, themes, status bar, layout       |
| **Editor**          | Buffer UX — find, goto, multi-cursor, guides              |
| **Workspace**       | Project tools — search, git, terminal, quick-open         |
| **4coder-specific** | Dual cursor+mark, virtual whitespace, code index, C layer |




### P0 — Stability & correctness

**Done**

- [x] Pass real viewport from `PanelDock` into `splitResized` handler
- [x] Wire extension host extensions into `createJetEditorView`
- [x] Fix `findProjectRoot()` URI building in `jet-lsp`
- [x] Re-apply keymaps when extension host registers new bindings
- [x] Clean up stale `packages/jet-app/dist-electron/`
- [x] Move `pnpm.onlyBuiltDependencies` to `.npmrc`
- [x] Query-param bootstrap runs once; `openEditorTab` dedupes by URI
- [x] Explorer tree expands root on workspace open
- [x] Editor input stability — `executeCommand` ref, autofocus, no remount on layout change
- [x] Session tree sanitize — `sanitizeKnownTabs()` on `PanelTree.fromJSON` (legacy; session restore removed)
- [x] **Shell:** tab drag/drop polish — same-panel edge-split, cross-panel insert index, `TabRegistry.setPanel` on drag
- [x] **Shell:** dirty-tab close confirm — `tabClose`, `closeAllTabs`, `panelClose` (product); MCP `window.confirm` may need user handoff
- [x] **Shell:** default row layout — sidebar left, main editor right (`workspaceLayout`)
- [x] **Shell:** editor open/new file routes to main panel (`resolveEditorPanel`)
- [x] **Shell:** command palette centered (`createPortal` + fixed overlay)
- [x] **Shell:** Tailwind `@source` — position utilities for panel dock / palette

**Remaining (Shell tier)**

- [x] **Shell:** tab drag/drop automated Electron test (removed with tab bar — buffer list covers switcher)



### P1 — Core editor & shell features

**Done**

- [x] Terminal tab stub + `terminal.show` command
- [x] Untitled / new file flow (`workspace.newFile`, save-promote; Mod-n when workspace open)
- [x] Tab dirty indicator + confirm on close with unsaved changes
- [x] `when` clauses in KeymapService — `editorFocus`, `paletteOpen`, `workspaceOpen`, tab-kind focus keys
- [x] **Editor:** in-buffer find (`editor.find` / Mod-f)
- [x] **Editor:** find/replace (`editor.replace` / Mod-h, CM search panel)
- [x] **Editor:** goto-line (`editor.gotoLine` / Mod-g, modal)



### P2 — UX & polish

**Done**

- [x] Tab bar reorder within panel (`insertIndex` + same-panel drag)
- [x] `panelClose` handler in `App.tsx` + panel close button
- [x] `__jetAgent.waitForEditor()` — poll until `.cm-editor` mounted
- [x] Bundled themes + theme picker commands (`ui.selectTheme.*`)
- [x] Search tab shell + problems tab stub
- [x] Status bar (LSP status, line/col, encoding)
- [x] Welcome view when no folder open
- [x] GitTab lazy import; PaletteOverlay
- [x] Tab row overflow menu
- [x] Playwright Electron smoke tests wired to `pnpm test:electron` + `__jetAgent`
- [x] **Shell:** Vercel dark/light theme + `ui.toggleColorScheme`
- [x] **Shell:** welcome view, status bar (L/C, LSP, message)
- [x] Reduce main bundle — lazy Search/Problems tabs; Vite `manualChunks` for git-diff/shiki
- [x] **Shell:** status bar — workspace path + git branch
- [x] **Shell:** more bundled themes (One Dark, Gruvbox Dark, Nord — 6 total)
- [x] **Editor:** bracket matching + search panel theming
- [x] **Editor:** Fleury-style indent guide columns (`@replit/codemirror-indentation-markers`)
- [x] **Workspace:** project search tab (ripgrep) + result navigation

**Remaining**

- (none in P2 tier)



### P1½ — VS Code keybinding parity (in progress)

**Done**

- [x] Tier 1 editor commands — comment, line ops, indent, undo/redo, smart select, multi-cursor CM commands
- [x] Tier 2 layout — tab cycle, close all, focus sidebar/editor, split, zoom, overlays
- [x] Tier 3 LSP — format, rename, references, parameter hints, document outline (Electron; browser shows message)
- [x] Tier 4 list nav — PageUp/Down/Home/End scroll on explorer/git/search/problems
- [x] Git chord placeholders — message stubs (not bound to `undo`)

**Remaining**

- [ ] Git chord implementations (stage/revert selected ranges from editor selection)
- [ ] List panel item focus (arrow-key selection), not just scroll



### P3 — Platform, workspace & distribution

**Workspace tier**

- [x] Quick-open files (`workspace.quickOpen` / Mod-Shift-o)
- [x] Full git panel (stage, commit, branch checkout)
- [x] Terminal PTY (Electron `node-pty` + xterm; browser stub)
- [x] Problems panel — diagnostics list + jump to source (CM lint aggregation)
- [x] Watch mode / file change reload from disk (Electron `fs.watch`; dirty-tab confirm)

**Platform**

- [x] electron-builder config + pack scripts (`pack:mac` / `pack:win` / `pack:linux`; unsigned)
- [x] LSP crash recovery (`lsp.onCrashed` + auto-retry on editor focus)
- [x] Additional language servers (rust-analyzer descriptor registry)



### P4 — Reference editor identity (long-term)

**Editor tier**

- [x] Multi-cursor — partial: `addCursorAbove/Below`, `selectNextOccurrence`, Alt+click, `rectangularSelection` (Shift+Alt+drag column)

**4coder-specific tier**

- [ ] Expand `.jet/editorrc.ts` API toward Nameless-level extensibility



### Out of scope (documented gaps)

- Nameless-level command registry (~50+ commands), vim mode, tree-sitter tag index
- Full parity port of any single reference editor

---



## Reference parity snapshot

Quick comparison vs `.4coder`, Fleury, Nameless (not a task list — see phases above).


| Feature                          | 4coder  | Fleury  | Nameless   | Jet today                              |
| -------------------------------- | ------- | ------- | ---------- | -------------------------------------- |
| Tab drag/drop + reorder          | ✓       | ✓       | ✓          | removed (no tab bar)                   |
| Buffer list                      | —       | ✓       | ✓          | ✓ Cmd-Shift-b                          |
| Jump stack                       | ✓       | —       | ✓          | ✓ Alt-j                                |
| Location list panel              | partial | ✓       | ✓          | ✓ search/problems/refs feeds           |
| Output / tasks                   | build   | ✓       | ✓          | ✓ minimal task runner                  |
| Git / terminal                   | —       | ✓       | ✓          | removed                                |
| Fleury chrome                    | —       | ✓       | ✓          | brace guides + token highlight         |
| LSP (TS/JS)                      | ✗       | partial | ✓          | ✓ Electron + rust-analyzer             |
| Multi-cursor, macros, kill ring  | ✓       | —       | ✓          | partial (no macros/kill ring)          |
| Extension / custom layer         | C hooks | C++     | Rust setup | `.jet/editorrc.ts`                     |


---



## Key Files (start here)


| File                                              | Why                                                 |
| ------------------------------------------------- | --------------------------------------------------- |
| `packages/jet-app/src/App.tsx`                    | Shell wiring: commands, layout, LSP, extension host |
| `packages/jet-ui/src/dock/PanelDock.tsx`          | Docking UI + viewport measure                       |
| `packages/jet-panels/src/tree.ts`                 | Split/tab model                                     |
| `packages/jet-ui/src/tabs/EditorTabHost.tsx`      | CM mount lifecycle                                  |
| `packages/jet-codemirror/src/createEditorView.ts` | Editor extensions + LSP attach                      |
| `apps/jet-desktop/vite.config.ts`                 | Critical electron/vite paths                        |
| `apps/jet-desktop/src/main/main.ts`               | Electron bootstrap                                  |
| `packages/jet-extension-host/src/index.ts`        | Extension API surface                               |


---



## Adding a Feature (checklist)

1. Decide layer — shared / panels / workspace / codemirror / ui / app / electron
2. Add types to `@jet/shared` or `@jet/workspace` if cross-cutting
3. Register command + keybinding if user-facing
4. If new tab kind: extend `TabKind`, `TabRegistry`, `TabBody`, default registration in `App.tsx`
5. Run `pnpm -r typecheck`
6. **Electron Playwright** — `pnpm test:electron` (+ `pnpm test:bench` when perf-sensitive); cover changed behavior

---



## Agent Anti-patterns

- Shipping UI/UX changes without **`pnpm test:electron`** validation
- Putting editor document text in React `useState`
- Importing Electron in renderer packages (use `window.jet`)
- Bundling native Node modules (`ws`, `node-pty`) in electron main vite build without `external`
- Setting vite electron outDir relative to `jet-app` root (breaks `package.json` main)
- Adding Tauri — project chose **Electron**
- Large shadcn default styling — keep RAD/custom theme direction

## Open Backlog (updated 2026-07-05)

Deferred items from shadcn-integration audit session. Each is scoped as a stand-alone task; pick top-down.

### Recently closed (2026-07-05)
- [x] **StatusBar tooltip `sideOffset`** — added `sideOffset={6}` to workspace tooltip + LSP popover in `packages/jet-ui/src/status/StatusBar.tsx`.
- [x] **LocationList row vs Explorer row hover/focus drift** — LocationList row now uses `sidebar-accent` tokens matching `sidebarMenuButtonVariants` (`packages/jet-ui/src/panels/LocationListPanel.tsx:193`).
- [x] **Toast + confirm dialog unification** — `showJetToast(msg, { variant, description })` maps to `sonner`'s `error`/`warning`/`info`/`success`; `ConfirmDialogHost` accepts shared `JetVariant` string (destructive/warning) alongside legacy `destructive?: boolean`.
- [x] **CdOverlay rewrite to shadcn `Command`** — completion list now uses `Command`/`CommandList`/`CommandItem` with `shouldFilter={false}`, manual value + a11y `aria-controls`/`aria-activedescendant` on `Input`. Alt-Backspace segment delete, Tab/Enter apply completion, Cmd-Enter confirms — preserved. `ScrollArea` dropped in favor of `CommandList` scroll region.
- [x] **`EditorContextMenu.tsx` root/trigger** — verified `EditorTabHost.tsx:415` already wraps content in `<ContextMenu>` root + `<ContextMenuTrigger asChild>` around the host `<div>`. External `showEditorContextMenuAt(x, y)` dispatches synthetic `contextmenu` on trigger — Radix opens via native event so focus-trap + z-index are correct. No change needed; backlog note was stale.
- [x] **`JetApp` unused imports** — removed unused `JetTheme` type import and stale `currentTree` local in `packages/jet-app/src/App.tsx`.

### Syntax highlighting for Rust (Electron only)
- **Symptom:** User reports Rust files render with zero syntax colors when opening real repos (`loki/`) in the **Electron desktop app**. Fixture-based `.rs` files under `fixtures/sample-workspace` are covered by `tests/electron/syntax-rust.electron.spec.ts`.
- **Investigated:** `@lezer/rust` styleTags map `t.definitionKeyword`/`t.moduleKeyword`/`t.modifier`/`t.integer`/`t.lineComment`/`t.paren` etc. All inherit from parent tags (`keyword`, `number`, `comment`, `bracket`) — theme should still color via inheritance. `packages/jet-codemirror/src/theme.ts` covers `t.keyword`, `t.controlKeyword+t.modifier`, `t.number`, `t.comment`, `t.operator`, `t.punctuation`, `t.string`. `t.bracket` is NOT mapped — but that only affects `{}`, `()`, `[]`.
- **Repro path:** Only reproduces in Electron dev with real user workspace. Browser scenario runner cannot reproduce.
- **Hypothesis to test next:** (a) `import("@codemirror/lang-rust")` dynamic import fails silently under Electron production/hot-reload → `loadLanguage` never resolves, view boots with no language extension. (b) `@replit/codemirror-indentation-markers` or another plugin's CSS is overriding token colors. (c) Race between `attachView` calling `reconfigureLanguage` and initial `createJetEditorView` when session cache hits.
- **Suggested attack:** open a Rust file in Electron, run `getComputedStyle` on `.cm-line span` in devtools to check whether spans get `.ͼNN` classes at all. If not → language load failed. If classes present but color=inherit → CSS override.
- **Also add** explicit tag mappings even though inheritance should cover: `t.bracket`, `t.self`, `t.character`, `t.macroName`, `t.meta` in `packages/jet-codemirror/src/theme.ts` — defense in depth.

### Indent-marker colors don't toggle theme (Task #14)
- `packages/jet-codemirror/src/createEditorView.ts:88-113` — `indentationMarkers({colors:{light,dark,...}})` is baked in at view creation. `@replit/codemirror-indentation-markers` doesn't take reactive colors.
- **Fix:** wrap in a Compartment; on theme change, reconfigure with fresh colors object. OR patch the plugin to read from CSS var `var(--jet-indent-marker)`.
- Currently both light/dark values equal `theme.colors.border` for the ACTIVE theme, so single-view works; only broken across theme toggle without view rebuild.

### Dead `Sidebar` wrapper in `ui/sidebar.tsx` (Task #7)
- File is 730 LOC of shadcn boilerplate; only `SidebarProvider` + `SidebarTrigger` + `SidebarMenu*` + `useSidebar` are imported by app code. `Sidebar`, `SidebarInset`, `SidebarRail`, `SidebarInput`, `SidebarHeader`, `SidebarFooter`, `SidebarSeparator` are dead exports.
- **Deferred, not urgent:** Vite tree-shakes them from the ship bundle. Delete only if source dead-code hygiene matters.

### Autocomplete popup MUST use shadcn `ContextMenu` (High — hard rule)
- **Rule:** no custom components allowed. Autocomplete popup MUST be built from `@/components/ui/context-menu.tsx` (`ContextMenu` / `ContextMenuContent` / `ContextMenuItem` / `ContextMenuGroup` / `ContextMenuLabel`). Not a raw CM tooltip, not a custom portal, not a `Popover`+`Command` hybrid.
- **Current state:** `packages/jet-codemirror/src/completion-context-menu.ts:11-25` still DOM-patches shadcn class strings (`CONTEXT_MENU_SURFACE_CLASS`, `CONTEXT_MENU_ITEM_SURFACE_CLASS`) onto CodeMirror's native `.cm-tooltip-autocomplete` after mount via `classList.add()` + `dataset.slot = "context-menu-content"`. Fake shadcn — no Radix root, no focus scope, no `ContextMenuPortal`, no keyboard-role parity, breaks if shadcn class strings drift.
- **Also delete:** `packages/jet-codemirror/src/menu-surface.ts` (`CONTEXT_MENU_SURFACE_CLASS`, `CONTEXT_MENU_ITEM_SURFACE_CLASS`) and its re-export in `packages/jet-codemirror/src/index.ts:45`. Class-string sharing is the anti-pattern this rule bans.
- **Fix plan:**
  1. Replace CodeMirror's default `autocomplete` tooltip renderer. Register a completion source that emits Jet's own state; suppress the native tooltip via `tooltips: { position: "absolute" }` or by overriding `completionConfig({ tooltipClass })` and rendering an empty tooltip.
  2. In `EditorTabHost.tsx`, mount a `<ContextMenu open={completionOpen}>` with `<ContextMenuContent>` portalled to `document.body`. Position via `EditorView.requestMeasure` → caret coords, forwarded as CSS vars.
  3. Bridge keymap: `ArrowUp`/`ArrowDown`/`Enter`/`Escape`/`Tab` — intercept in a CM keymap prec `Prec.highest`, dispatch to a React state store (or ref), so shadcn `ContextMenuItem` selection follows. Enter → `applyCompletion(view, item)` from `@codemirror/autocomplete`.
  4. Preserve `completionDetail` in a right-aligned span using existing `ContextMenuShortcut`.
- **Acceptance:** grep for `.cm-tooltip-autocomplete` in `packages/jet-codemirror/src/` returns only the theme-side hide rule; no `classList.add`, no `dataset.slot` patching. Visual scenario asserts `role="menu"` present in a11y snapshot when completion open.

### Explorer virtualization for large repos (Medium)
- `packages/jet-ui/src/tabs/ExplorerTab.tsx` — renders every visible file synchronously. `@tanstack/react-virtual` is already a dep (see `packages/jet-ui/package.json`).
- **Fix:** virtualize `SidebarMenu` children. Preserve `data-jet-list-item` on rendered rows so visual scenarios still find them by selector.

### Explorer `focusExplorerPanel` uses DOM `querySelector` (Low)
- `packages/jet-ui/src/explorer/ExplorerPanel.tsx:7-18` — imperative DOM query on `[data-jet-explorer-panel]` + `[data-sidebar="trigger"]`. Brittle to selector rename.
- **Fix:** expose a ref-based focus API via `useSidebar()` context or a ref forwarded from `ExplorerPanel`.

### Custom decoration follow-ups (Task #4 tail)
- macOS shipped with `hiddenInset` + `JetTitleBar` component. Verified via `?titlebar=1` browser query + `tests/visual/scenarios/titlebar.json`.
- **Not yet done:** Windows/Linux custom decoration (title bar drag region + min/max/close buttons via shadcn Button + custom SVG icons). Would use `titleBarStyle:'hidden'` on those platforms and `WindowControls` sub-component. Currently they fall back to Electron native menu + native window frame.
- **Not yet done:** wire `checkbox`/`radio` states in menubar (e.g. "Toggle Color Scheme" should be a `CheckboxItem` showing current scheme). Currently a plain `Item`.
- **Not yet done:** window title (center label) currently derives from workspace + file; if `activeEditorFile.isDirty`, uses `•` marker. Consider dedicated dirty-badge component.

### Pass 2 (2026-07-05) — shadcn re-audit findings

Global rule to apply everywhere below: **no custom components**. Every interactive widget must resolve to a primitive in `packages/jet-ui/src/components/ui/`. Raw `<button>` / `<input>` / class-string patching count as custom.

#### `LocationListPanel` row = raw `<button>` (High)
- `packages/jet-ui/src/panels/LocationListPanel.tsx:190-202` — virtualized row is a raw `<button type="button">` with hand-rolled `hover:bg-sidebar-accent` classes replicating `sidebarMenuButtonVariants`. Duplicates shadcn behavior without importing it.
- **Fix:** render row through `SidebarMenuButton asChild size="sm"` from `ui/sidebar.tsx`, or wrap it in a shared `<ListRow>` primitive that composes `SidebarMenuButton`. Keep virtualization by rendering the button inside the absolute-positioned wrapper unchanged. Preserve `data-jet-list-item` on the rendered element.

#### `StatusBar` LSP trigger = raw `<button>` (Medium)
- `packages/jet-ui/src/status/StatusBar.tsx:141-150` — `PopoverTrigger asChild` wraps a raw `<button>` with bespoke focus ring classes. Should use shadcn `Button variant="ghost" size="sm"` (or a new `variant="statusZone"`) to inherit ring/focus tokens.
- **Fix:** replace with `<Button variant="ghost" size="sm" className="jet-status-zone jet-mono-data …">` — retains status-zone typography via className, drops hand-rolled `focus-visible:ring-2 ring-ring` (Button already has it).

#### `ExplorerTab` file row = raw `<button>` inside `SidebarMenuSubButton asChild` (Low)
- `packages/jet-ui/src/tabs/ExplorerTab.tsx:72-81` — the file rendering inside `SidebarMenuSubButton asChild` uses a raw `<button type="button">`. This is technically fine (`asChild` requires exactly one child element), but the class `shrink-0` alone is not enough — `SidebarMenuSubButton` styles apply via `asChild`. Verify that `size="sm"` variant fires; if not, drop `asChild` and let `SidebarMenuSubButton` render its own element.
- **Investigate:** whether `asChild` on sub-button still applies `sidebarMenuSubButtonVariants` classes to the child — if the child has to spell them out, we lost the shadcn variant contract.

#### Explorer `focusExplorerPanel` DOM `querySelector` (still open, restated)
- Same as prior backlog. `packages/jet-ui/src/explorer/ExplorerPanel.tsx:7-18`. Fix by exposing a ref or a `useSidebar()`-published handle.

#### `App.tsx` list-navigation DOM `querySelector` (Medium)
- `packages/jet-app/src/App.tsx:640-642` — `document.querySelector('[data-jet-list-panel=…]')` + `querySelectorAll('[data-jet-list-item]')` for keyboard nav. Mirrors the explorer-panel anti-pattern.
- **Fix:** publish a list-registry from `WorkspaceService` (or a new `ListRegistry` in `@jet/workspace`) mapping panel kind → ref to focused-item state. Keyboard command reads from the registry, not the DOM.

#### `main.tsx` bootstraps dark class imperatively (Low)
- `packages/jet-app/src/main.tsx:7` — `document.documentElement.classList.add("dark")` runs unconditionally, before the theme-scheme service reads `localStorage["jet-color-scheme"]`. Race: flash of dark on light-scheme startup.
- **Fix:** move to a synchronous inline script in `packages/jet-app/index.html` (before React mounts) that reads `localStorage` and sets the class. Standard shadcn/Tailwind theme-flash-prevention.

#### `motion-cursor.ts` `querySelector` on synthetic DOM (Info, no action)
- `packages/jet-codemirror/src/motion-cursor.ts:262-265` — reads its own inserted bracket-cursor children by class. Not shadcn territory; internal DOM owned by the plugin. Leave as-is.

#### Dead exports beyond `Sidebar` (Low — hygiene)
- Full audit of `packages/jet-ui/src/components/ui/*.tsx` for unused named exports would tighten source but is tree-shaken at build. Only worth doing if we tighten `no-unused-exports` lint. Skip until then.

#### Shared `<ListRow>` primitive (Medium — enables above fixes)
- LocationList, Search results, Problems, Explorer files, Git changes all render a similar row: label + subtitle + optional shortcut/kbd. Right now each panel spells out its own classes. Extract one shared component in `packages/jet-ui/src/components/ListRow.tsx` that wraps `SidebarMenuButton asChild` with a `label`/`subtitle`/`trailing` slot. Feeds all above high/medium items with a single fix.

