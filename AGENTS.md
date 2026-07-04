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
│   ├── jet-desktop/        Electron shell (main, preload, vite config)
│   └── jet-web/            Browser dev server for agent testing
├── fixtures/
│   └── sample-workspace/   Fixture project for browser smoke tests
├── packages/
│   ├── jet-shared/         URIs, Emitter, git types, panel primitives
│   ├── jet-node-host/      Shared Node FS/git + dev middleware
│   ├── jet-browser/        Browser window.jet client + __jetAgent bridge
│   ├── jet-panels/         PanelTree — splits, tabs, resize, serde
│   ├── jet-workspace/      WorkspaceService, TabRegistry, commands, keymaps
│   ├── jet-codemirror/     createJetEditorView, theme, languages, LSP transport
│   ├── jet-lsp/            LanguageServerManager (renderer-side)
│   ├── jet-extension-host/ JetAPI + loadEditorRc
│   ├── jet-ui/             PanelDock, tabs, CommandPalette, themes
│   └── jet-app/            JetApp root React component + index.html
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
jet-app  ←  jet-desktop, jet-web
```

Keep imports acyclic. Lower layers must not import React or Electron.

---



## Commands

```bash
pnpm install          # runs postinstall: pnpm rebuild electron
pnpm dev              # turbo → jet-desktop vite + electron
pnpm dev:web          # browser dev server on :5174 (agent-testable)
pnpm typecheck        # all packages
pnpm test:web         # Playwright smoke (starts dev:web on :5174)
pnpm build            # production build (renderer + electron main/preload)
```

Run typecheck from repo root before finishing a task:

```bash
pnpm -r typecheck
```

Then validate with **browser MCP** on `pnpm dev:web` (see Agent browser testing).

---



## Agent visual verification (MANDATORY)

**Non-negotiable for every agent:** any change that can affect what the user sees — UI, layout, theming, commands, keybindings, shell, panels, editor surface, palette, welcome, git/explorer views, error/status messages — MUST be visually verified before the task is reported done. Typecheck / lint / unit tests are necessary but NOT sufficient. A task closed on "types pass" without a screenshot review is a regression waiting to ship.

### Preferred: scenario runner

JSON-scripted, headless, agent-friendly. **Prefer a11y snapshots + `assert_a11y_contains` for verification. Screenshots are fallback for genuinely pixel-level checks.**

1. Start dev server once: `pnpm dev:web` (port **5174**).
2. Add or reuse a scenario under `tests/visual/scenarios/*.json` — schema in `tests/visual/README.md`.
3. Run it: `pnpm visual tests/visual/scenarios/<name>.json` — stdout emits one JSON line with `screenshots`, `a11y_snapshots`, `dom_dumps` arrays.
4. Read the `.a11y.yaml` outputs under `test-results/agent-shots/`. They are Playwright aria snapshots — diffable text, no pixel noise. Grep them or eyeball them.
5. Fall back to PNGs only when the change is pixel-level: theme colors, layout dimensions, motion, icons, cursor animation. Do NOT open PNGs for structural checks the a11y snapshot already covers.
6. New feature → new scenario. Assert structure with `assert_a11y_contains` and state with `assert_state`. Do not rely on the existing set to cover new code paths.
7. Run `pnpm visual:all` before declaring a broad UI change complete. All scenarios must exit 0.

Step vocabulary: `wait` / `wait_frames`, `key`, `text`, `command` (id from `packages/jet-app/src/app-commands.ts`), `open_workspace`, `open_file`, `a11y_snapshot`, `assert_a11y_contains`, `assert_state`, `screenshot`, `dom_dump`, `exit`. Full reference: `tests/visual/README.md`.

**Verification output preference (strict):**

1. `assert_a11y_contains` — structural/text assertions (palette open, N options listed, focused element).
2. `assert_state` — bridge state (workspace path, tab kinds, palette open flag).
3. `a11y_snapshot` — record aria tree so a reviewer can diff.
4. `screenshot` — only when pixels are the point (theme change, layout regression, motion).
5. `dom_dump` — CSS/computed-tree debugging (e.g. Tailwind purge regressions).

**Rule:** if the runner cannot express the check (native folder dialog, LSP-only path), state that explicitly and fall back to the browser MCP flow below. Do NOT silently skip visual verification.

### Fallback: browser MCP

When a scenario cannot express the check, validate live via the **Cursor browser MCP** (`cursor-ide-browser`).

Use `pnpm dev:web` to run Jet in a normal browser with real FS/git backed by a Vite dev middleware (sandboxed to allowed roots).

### Browser MCP workflow (required)

1. **Start server** — `pnpm dev:web` (port **5174**). If port in use, reuse existing server or `pkill -f "jet-web.*vite"` then restart.
2. **Navigate** — `browser_navigate` to quick-start URL (below) or `/` for empty panel shell.
3. **Lock** — `browser_lock` after navigate, before interactions.
4. **Inspect** — `browser_snapshot` for a11y tree; `browser_take_screenshot` when visual check needed.
5. **Interact** — `browser_click`, `browser_type`, `browser_press_key` for user flows.
6. **Programmatic** — `browser_cdp` with `Runtime.evaluate` for `window.__jetAgent` (see below).
7. **Unlock** — `browser_unlock` when finished.

Prefer MCP browser tools over asking the user to test manually. Use `browser_cdp` for assertions; avoid CDP `Input.*` (use dedicated browser tools for clicks/keys).

### Quick start URL

```
http://localhost:5174/?workspace=fixtures/sample-workspace&file=src/index.ts
```



### Programmatic control (`window.__jetAgent`)

After page load:

```javascript
await window.__jetAgent.waitForReady()
await window.__jetAgent.openWorkspace("fixtures/sample-workspace")
await window.__jetAgent.openFile("src/index.ts")
await window.__jetAgent.waitForEditor()
await window.__jetAgent.executeCommand("ui.showCommandPalette")
window.__jetAgent.getState()
```

Use via `browser_cdp` → `Runtime.evaluate` with `awaitPromise: true` for async calls.

### Agent smoke checklist (run via browser MCP)

1. `pnpm dev:web` — server on port **5174**
2. `browser_navigate` → quick-start URL
3. `browser_snapshot` — editor visible (`.cm-editor`); explorer **not** shown by default (use `explorer.show` / Mod-Shift-e)
4. `browser_cdp` / `Runtime.evaluate`: `await __jetAgent.waitForReady()` then `waitForEditor()` after openFile
5. `__jetAgent.getState()` — workspace path set, one editor tab per opened file
6. `browser_click` editor → `browser_type` — chars appear without extra focus click
7. Edit + save (Mod-s via `browser_press_key` or `executeCommand("workspace.saveFile")`) — persists under `fixtures/sample-workspace/`
8. Git tab — status visible (fixture is a git repo)
9. Close dirty tab — confirm dialog (may need user handoff in MCP; note if blocked)
10. Cold start with no workspace query — empty panel (no auto-reopen of last folder)
11. Command palette — `executeCommand("ui.showCommandPalette")` → centered modal (not trapped in panel)
12. New file / open file — editor tab lands in **right** main panel, not stacked below sidebar

For feature-specific work, add targeted MCP checks (e.g. `executeCommand("editor.find")` → search panel in snapshot; `executeCommand("ui.toggleColorScheme")` → light/dark shell + editor colors).

### Browser mode limitations

- No native folder dialog — use URL query params or `__jetAgent.openWorkspace()`
- No LSP (TypeScript completions) — Electron only
- FS access sandboxed to `JET_DEV_ROOTS` (default: `fixtures/` + repo root)
- Dev-only — not a production web deployment



### Allowed roots env

```bash
JET_DEV_ROOTS="/path/a:/path/b" pnpm dev:web
```

(Path separator is OS-native; on macOS/Linux use `:` between entries.)

### Dev gotchas (Electron + Vite)

1. **Electron binary missing** — `path.txt` absent under `node_modules/.../electron/`
  Fix: `pnpm rebuild electron` or `node node_modules/.pnpm/electron@*/node_modules/electron/install.js`
2. **Vite** `root` **is** `packages/jet-app` but electron lives in `apps/jet-desktop`.
  Electron build **must** use explicit `outDir`:
   `package.json` `"main": "dist-electron/main.js"` is relative to `apps/jet-desktop`.
3. **Do not bundle** `ws` in main process — mark external in rollup or you get `bufferutil` resolve errors.
4. **Dev URL** — main process loads `process.env.VITE_DEV_SERVER_URL`, not hardcoded `:5173`.
5. **Stale dev processes** — if port conflict: `pkill -f "jet-web.*vite"` or `pkill -f Electron` then `pnpm dev` / `pnpm dev:web`.
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
- Tab kinds: `editor`, `explorer`, `git`, `terminal` (stub), `search` (shell), `problems` (stub)



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
- Project search requires `rg` (ripgrep) on **PATH**
- `findProjectRoot()` uses `pathToFileUri` from `@jet/shared`



### UI tabs


| Tab      | Status                                                     |
| -------- | ---------------------------------------------------------- |
| Explorer | `@headless-tree/react` file tree                           |
| Git      | `@pierre/diffs` patch view + git status list (lazy-loaded) |
| Editor   | CodeMirror host + in-buffer find                           |
| Search   | Project ripgrep search + in-buffer find                    |
| Problems | LSP/CM lint diagnostics list + jump                        |
| Terminal | xterm + node-pty (Electron); browser stub                  |




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

1. `pnpm dev` / `pnpm dev:web` → blank editor shell (single panel, no WelcomeView)
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

- [ ] **Shell:** tab drag/drop automated browser test (manual OK)



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
- [x] Playwright smoke tests wired to `pnpm dev:web` + `__jetAgent`
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
6. **Browser MCP smoke test** — `pnpm dev:web` + checklist above; cover changed behavior

---



## Agent Anti-patterns

- Shipping UI/UX changes without **browser MCP** validation on `pnpm dev:web`
- Putting editor document text in React `useState`
- Importing Electron in renderer packages (use `window.jet`)
- Bundling native Node modules (`ws`, `node-pty`) in electron main vite build without `external`
- Setting vite electron outDir relative to `jet-app` root (breaks `package.json` main)
- Adding Tauri — project chose **Electron**
- Large shadcn default styling — keep RAD/custom theme direction

