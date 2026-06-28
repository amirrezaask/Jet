# AGENTS.md — Jet Editor

Guide for AI agents and contributors working in this repo.

## What Jet Is

**Jet** (Jasmin Extensible Text Editor) is a greenfield desktop code editor inspired by RAD Debugger / 4coder / Nameless Editor aesthetics, built as a modern Electron app.

**Core split:**

| Layer | Owns |
|-------|------|
| **CodeMirror 6** | Text buffer, syntax, LSP client, keymaps inside editor |
| **Jet Workspace** | Files, tabs, dirty state, commands, keymap registry |
| **Jet Panels** | Infinite split tree, tab groups, drag/drop docking |
| **Jet UI / App** | React shell, themes, explorer, git, palette |
| **Electron main** | FS, git CLI, LSP process spawn + WebSocket bridge |

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

## Agent browser testing (no Electron required)

**Required for all agents:** after UI/shell/behavior changes, validate in the app using the **Cursor browser MCP** (`cursor-ide-browser`). Do not mark a task done on typecheck alone.

Use **`pnpm dev:web`** to run Jet in a normal browser with real FS/git backed by a Vite dev middleware (sandboxed to allowed roots).

### Browser MCP workflow (required)

1. **Start server** — `pnpm dev:web` (port **5174**). If port in use, reuse existing server or `pkill -f "jet-web.*vite"` then restart.
2. **Navigate** — `browser_navigate` to quick-start URL (below) or `/` for welcome view.
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
3. `browser_snapshot` — explorer + editor visible (explorer has `aria-label="Explorer"`)
4. `browser_cdp` / `Runtime.evaluate`: `await __jetAgent.waitForReady()` then `waitForEditor()` after openFile
5. `__jetAgent.getState()` — workspace path set, one editor tab per opened file
6. `browser_click` editor → `browser_type` — chars appear without extra focus click
7. Edit + save (Mod-s via `browser_press_key` or `executeCommand("workspace.saveFile")`) — persists under `fixtures/sample-workspace/`
8. Git tab — status visible (fixture is a git repo)
9. Close dirty tab — confirm dialog (may need user handoff in MCP; note if blocked)
10. Re-open workspace — default layout (explorer left, main right); no session file
11. **Known fail:** tab drag to split/move — not working yet; do not treat as regression if broken

For feature-specific work, add targeted MCP checks (e.g. `executeCommand("editor.find")` → search panel in snapshot; `executeCommand("ui.selectTheme.four_coder")` → theme message / CSS change).

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

2. **Vite `root` is `packages/jet-app`** but electron lives in `apps/jet-desktop`.  
   Electron build **must** use explicit `outDir`:

   ```ts
   path.resolve(__dirname, "dist-electron")  // in apps/jet-desktop/vite.config.ts
   ```

   `package.json` `"main": "dist-electron/main.js"` is relative to `apps/jet-desktop`.

3. **Do not bundle `ws`** in main process — mark external in rollup or you get `bufferutil` resolve errors.

4. **Dev URL** — main process loads `process.env.VITE_DEV_SERVER_URL`, not hardcoded `:5173`.

5. **Stale dev processes** — if port conflict: `pkill -f "jet-web.*vite"` or `pkill -f Electron` then `pnpm dev` / `pnpm dev:web`.

6. **Stray output** — old builds may land in `packages/jet-app/dist-electron/`; canonical output is `apps/jet-desktop/dist-electron/`. Both are gitignored where applicable.

---

## Architecture Details

### Electron IPC (`window.jet`)

Exposed via preload → `@jet/workspace` types (`JetElectronAPI`).

| Channel | Purpose |
|---------|---------|
| `fs:readFile`, `fs:writeFile`, `fs:readDir`, `fs:stat` | File URIs (`file://...`) |
| `fs:showOpenFolderDialog` | Native folder picker |
| `git:isRepo`, `git:status`, `git:diff` | Git CLI wrappers |
| `lsp:start`, `lsp:stop` | Spawn language server, WS bridge |

Main entry: `apps/jet-desktop/src/main/main.ts`  
Handlers: `fs.ts`, `git.ts`, `lsp-bridge.ts`

### Panel docking (`@jet/panels`)

- `PanelTree` — row/column splits, tab groups, 5-way drop (edges + center)
- `defaultLayout()` — initial row split; seeds Explorer + Git tabs (placement convenience only)
- Serializable via `toJSON()` / `fromJSON()`; `sanitizeKnownTabs()` strips orphan tab ids when needed
- UI: `PanelDock`, `TabRow`, `DropOverlay` in `@jet/ui`

**Panel model:** all leaf panels are equal — no "explorer panel" vs "editor panel". Tab kind differs (`explorer`, `editor`, `git`, …). `handleOpenFile` and view commands target **`focusedPanel`** (last clicked panel).

**Known gaps:**
- **Tab drag/drop broken** — pointer-based drag overlay mounts but drop does not move/split tabs reliably (browser + manual test). Fix in `TabRow.tsx`, `PanelDock.tsx`, `DropOverlay.tsx`; verify `tabMoved` → `PanelTree.moveTab()`.
- Tab reorder within a tab bar — same-panel `insertIndex` UI wired; cross-panel still broken
- Split resize works (pointer capture + 12px hit slop); may feel laggy during Framer layout animation

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
- `motionCursor` — animated cursor with reduced-motion respect
- `isLargeFile()` — skips LSP for huge files
- Languages loaded lazily via Shiki/lang packages in `languages.ts`

### Commands & palette

Registered in `packages/jet-app/src/App.tsx`:

| Command | Default key |
|---------|-------------|
| `ui.showCommandPalette` | Mod-p |
| `ui.selectTheme` | — (palette: Theme: …) |
| `workspace.openFolder` | Mod-o |
| `workspace.saveFile` | Mod-s |
| `workspace.newFile` | Mod-n |
| `editor.find` | Mod-f |
| `layout.closeTab` | Mod-w |
| `git.showChanges` | Mod-Shift-g |
| `explorer.show` | Mod-Shift-e |
| `search.show` | Mod-Shift-f |
| `problems.show` | — |
| `terminal.show` | — |

`CommandRegistry.execute()` receives `getActiveEditorView: () => unknown` — cast to `EditorView` in handlers that need `view.state.doc`.

### Extension host (`@jet/extension-host`)

- `createJetAPI()` — commands, keymaps, editor extensions, workspace, ui
- `loadEditorRc(path, jet)` — dynamic import of `.jet/editorrc.ts` on folder open
- `registerExtensions()` — CodeMirror extensions applied via `extensionCompartment` in `EditorTabHost`

### LSP

- Main: spawns `typescript-language-server --stdio`, bridges stdio ↔ WebSocket
- Renderer: `@codemirror/lsp-client` via custom `simpleWebSocketTransport` in `jet-codemirror`
- `LanguageServerManager.ensureServerForFile()` — TS/JS only for now
- Requires `typescript-language-server` on **PATH**
- `findProjectRoot()` uses `pathToFileUri` from `@jet/shared`

### UI tabs

| Tab | Status |
|-----|--------|
| Explorer | `@headless-tree/react` file tree |
| Git | `@pierre/diffs` patch view + git status list (lazy-loaded) |
| Editor | CodeMirror host + in-buffer find |
| Search | Shell tab; project search planned |
| Problems | Stub tab; LSP diagnostics planned |
| Terminal | Stub UI + `terminal.show` command (node-pty planned for Electron) |

### Theming

- `defaultJetTheme` + CSS vars via `applyJetThemeCss()`
- Tailwind v4 + custom RAD-ish tokens in `jet-ui/src/styles/globals.css`
- Bundled themes in `jet-ui/src/theme/bundled.ts` (default, 4coder, Catppuccin Mocha)
- Theme picker via `ui.selectTheme.*` commands; persisted in `localStorage`

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

1. `pnpm dev` / `pnpm dev:web` → window loads
2. **Open Folder** / query URL / `__jetAgent.openWorkspace()` → FS + optional `.jet/editorrc.ts`
3. Explorer tree — root expands; click file → editor tab in **focused panel**
4. Edit + **Mod-s** save (click editor tab first if needed)
5. **Mod-p** command palette
6. Git tab (if repo)
7. Panel split **resize** — drag gutter between panels
8. Reload workspace — default layout (no session persistence)

**Not working:** tab drag/drop to move tabs or create splits (overlay may appear; drop has no effect).

---

## Prioritized Next Work

### P0 — Stability & correctness (done)

- [x] Pass real viewport from `PanelDock` into `splitResized` handler
- [x] Wire extension host extensions into `createJetEditorView`
- [x] Fix `findProjectRoot()` URI building in `jet-lsp`
- [x] Re-apply keymaps when extension host registers new bindings
- [x] Clean up stale `packages/jet-app/dist-electron/`
- [x] Move `pnpm.onlyBuiltDependencies` to `.npmrc`
- [x] Query-param bootstrap runs once; `openEditorTab` dedupes by URI
- [x] Explorer tree expands root on workspace open
- [x] Editor input stability — `executeCommand` ref, autofocus, no remount on layout change
- [x] Session tree sanitize — orphan tab ids stripped on load/save
- [x] Symmetric panels — no `explorerPanelRef`/`editorPanelRef`; routing via `focusedPanel`

### P0 — Still broken (fix next)

- [ ] **Tab drag/drop** — move tab to another panel / split at edge. Pointer drag attempted in `PanelDock`/`TabRow`/`DropOverlay`; drop zones show but `tabMoved` does not apply layout change. Debug: window `pointerup` vs overlay `onPointerUp` ordering, `handlePanelEvent` + `TabRegistry` panel mapping after `moveTab`, registry `panelForTab` sync.

### P1 — Core editor features

- [ ] ~~Session persistence~~ — removed; layout resets on each workspace open
- [x] Terminal tab stub + `terminal.show` command
- [x] Untitled / new file flow (`workspace.newFile`, save-promote; Mod-n when workspace open)
- [x] Tab dirty indicator + confirm on close with unsaved changes
- [x] `when` clauses in KeymapService — `editorFocus`, `paletteOpen`, `workspaceOpen`, tab-kind focus keys

### P2 — UX & polish

- [x] Tab bar reorder within panel (`insertIndex` + same-panel drag)
- [x] `panelClose` handler in `App.tsx` + panel close button
- [x] `__jetAgent.waitForEditor()` — poll until `.cm-editor` mounted
- [x] Bundled themes + theme picker commands (`ui.selectTheme.*`)
- [x] Search tab shell + in-buffer find (`editor.find` / Mod-f); problems tab stub
- [x] Status bar (LSP status, line/col, encoding)
- [x] Welcome view when no folder open
- [x] GitTab lazy import; PaletteOverlay lazy (motion/react)
- [x] Tab row overflow menu
- [x] Playwright smoke tests wired to `pnpm dev:web` + `__jetAgent`
- [ ] Reduce main bundle / lazy-load Shiki langs further (CM langs already lazy)

### P3 — Platform & distribution

- [ ] electron-builder config + signed builds (macOS / Windows / Linux)
- [ ] LSP crash recovery (`lsp.onCrashed` currently no-op in preload)
- [ ] Additional language servers (rust-analyzer, etc.)
- [ ] Watch mode / file change reload from disk
- [ ] README for humans (optional unless requested)

---

## Reference parity targets

Design references (read-only sibling dirs): `.4coder/`, `.4coder_fleury/`, `.raddebugger/`, `Nameless_Editor/`.

Jet aspires to **RAD/Nameless shell polish** + **4coder/Fleury editor identity**, implemented on CodeMirror 6 + Electron — not a port of any reference.

### Parity tiers

| Tier | Scope | Examples |
|------|-------|----------|
| **Shell** | Panels, chrome, config | Status bar, theme picker, welcome view, palette, session layout (deferred) |
| **Editor** | Buffer UX | Find/replace, goto-line, multi-cursor, brace guides, semantic nav |
| **Workspace** | Project tools | Quick-open, project search, location list, full git, terminal PTY |
| **4coder-specific** | Long-term | Dual cursor+mark mode, virtual whitespace, C custom layer, code index |

### Feature matrix (selected)

| Feature | 4coder | Fleury | Nameless | Jet | Target |
|---------|--------|--------|----------|-----|--------|
| Tab drag/drop + reorder | ✓ | ✓ | ✓ | broken / partial reorder | P0 drag; reorder done |
| In-buffer find | ✓ | ✓ | ✓ | ✓ Mod-f | — |
| Project search + location list | ✓ | ✓ | ✓ | shell only | P3 |
| Status bar (path, L/C, git, LSP) | partial | ✓ | ✓ | L/C + LSP + message | path/git branch P3 |
| Theme picker + bundled themes | ✓ | ✓ | ✓ | ✓ 3 themes | more themes P3 |
| Quick-open files | ✓ | ✓ | ✓ | ✗ | P3 |
| Terminal PTY | CLI | — | ✓ | stub | P3 |
| Full git panel | — | — | ✓ | status+diff | P3 |
| Brace guides / Fleury chrome | — | ✓ | ✓ | ✗ | P4 |
| Session layout persist | — | — | ✓ | removed | revisit P3 |
| LSP (TS/JS) | ✗ | partial | ✓ | ✓ Electron | more servers P3 |
| Multi-cursor, macros, kill ring | ✓ | — | ✓ | ✗ | P4 |
| Extension / custom layer | C hooks | C++ | Rust setup | `.jet/editorrc.ts` | expand API |

### Out of scope (documented gaps)

- P0 cross-panel tab drag/drop (still broken)
- Project ripgrep search, real problems/diagnostics panel
- 4coder dual-cursor mode, programmable virtual whitespace, semantic index
- Nameless-level command registry (~50+ commands), vim mode, tree-sitter tag index

---

## Key Files (start here)

| File | Why |
|------|-----|
| `packages/jet-app/src/App.tsx` | Shell wiring: commands, layout, LSP, extension host |
| `packages/jet-ui/src/dock/PanelDock.tsx` | Docking UI + viewport measure |
| `packages/jet-panels/src/tree.ts` | Split/tab model |
| `packages/jet-ui/src/tabs/EditorTabHost.tsx` | CM mount lifecycle |
| `packages/jet-codemirror/src/createEditorView.ts` | Editor extensions + LSP attach |
| `apps/jet-desktop/vite.config.ts` | Critical electron/vite paths |
| `apps/jet-desktop/src/main/main.ts` | Electron bootstrap |
| `packages/jet-extension-host/src/index.ts` | Extension API surface |

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
