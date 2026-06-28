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
├── apps/jet-desktop/       Electron shell (main, preload, vite config)
├── packages/
│   ├── jet-shared/         URIs, Emitter, git types, panel primitives
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
jet-app  ←  jet-desktop
```

Keep imports acyclic. Lower layers must not import React or Electron.

---

## Commands

```bash
pnpm install          # runs postinstall: pnpm rebuild electron
pnpm dev              # turbo → jet-desktop vite + electron
pnpm typecheck        # all packages
pnpm build            # production build (renderer + electron main/preload)
```

Run typecheck from repo root before finishing a task:

```bash
pnpm -r typecheck
```

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

5. **Stale dev processes** — if port conflict: `pkill -f Electron` then `pnpm dev`.

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

- `PanelTree` — row/column splits, tab groups, 5-way drop (edges + tab bar)
- `defaultLayout()` — explorer-friendly split (left panel + editor area)
- Serializable via `toJSON()` / `fromJSON()`
- UI: `PanelDock`, `TabRow`, `DropOverlay` in `@jet/ui`

**Known gap:** split resize in `App.tsx` still passes hardcoded viewport `{ width: 1200, height: 800 }`. `PanelDock` measures real viewport via `ResizeObserver` but does not pass it to `splitResized` events yet.

### Workspace (`@jet/workspace`)

- `WorkspaceService` — root folder, file cache, dirty tracking, open editor tabs
- `TabRegistry` — maps `TabId` → tab kind + label + dirty flag
- Tab kinds: `editor`, `explorer`, `git`, `terminal` (stub), `search`, `problems` (types only)

### Editor surface (`@jet/codemirror` + `EditorTabHost`)

- `createJetEditorView()` — imperative CM6 mount; **never** put doc text in React state
- `viewByTab` Map in `EditorTabHost.tsx`; use `getEditorView(tabId)` for active editor access
- `applyUserKeymaps()` — Compartment-based bridge from `KeymapService` → CM keymap
- `motionCursor` — animated cursor with reduced-motion respect
- `isLargeFile()` — skips LSP for huge files
- Languages loaded lazily via Shiki/lang packages in `languages.ts`

### Commands & palette

Registered in `packages/jet-app/src/App.tsx`:

| Command | Default key |
|---------|-------------|
| `ui.showCommandPalette` | Mod-p |
| `workspace.openFolder` | Mod-o |
| `workspace.saveFile` | Mod-s |
| `layout.closeTab` | Mod-w |
| `git.showChanges` | Mod-Shift-g |
| `explorer.show` | Mod-Shift-e |

`CommandRegistry.execute()` receives `getActiveEditorView: () => unknown` — cast to `EditorView` in handlers that need `view.state.doc`.

### Extension host (`@jet/extension-host`)

- `createJetAPI()` — commands, keymaps, editor extensions, workspace, ui
- `loadEditorRc(path, jet)` — dynamic import of `.jet/editorrc.ts` on folder open
- **Gap:** `registerExtensions()` stores extensions in a ref but they are **not yet applied** to new editor views

### LSP

- Main: spawns `typescript-language-server --stdio`, bridges stdio ↔ WebSocket
- Renderer: `@codemirror/lsp-client` via custom `simpleWebSocketTransport` in `jet-codemirror`
- `LanguageServerManager.ensureServerForFile()` — TS/JS only for now
- Requires `typescript-language-server` on **PATH**
- **Gap:** `findProjectRoot()` in `jet-lsp` uses fragile URI construction; should use `pathToFileUri` from `@jet/shared`

### UI tabs

| Tab | Status |
|-----|--------|
| Explorer | `@headless-tree/react` file tree |
| Git | `@pierre/diffs` patch view + git status list |
| Editor | CodeMirror host |
| Terminal | Stub (“coming soon”) |

### Theming

- `defaultJetTheme` + CSS vars via `applyJetThemeCss()`
- Tailwind v4 + custom RAD-ish tokens in `jet-ui/src/styles/globals.css`
- Bundled theme stubs in `jet-ui/src/theme/bundled.ts`

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

1. `pnpm dev` → Electron window
2. **Open Folder** → FS + optional `.jet/editorrc.ts`
3. Explorer → click file → editor tab
4. Edit + **Mod-s** save
5. **Mod-p** command palette
6. Git tab (if repo)
7. Drag tabs / split panels (resize imperfect)

---

## Prioritized Next Work

### P0 — Stability & correctness

- [ ] Pass real viewport from `PanelDock` into `splitResized` handler (remove 1200×800 hack)
- [ ] Wire `extensionExtensions` ref into `createJetEditorView` (extension host extensions)
- [ ] Fix `findProjectRoot()` URI building in `jet-lsp`
- [ ] Re-apply keymaps when extension host registers new bindings (re-run `applyUserKeymaps` on open editors)
- [ ] Clean up / delete stale `packages/jet-app/dist-electron/` if present
- [ ] Move `pnpm.onlyBuiltDependencies` to `.npmrc` (pnpm 9+ warns package.json field ignored)

### P1 — Core editor features

- [ ] Session persistence — save/restore `PanelTree` snapshot + open tabs to `.jet/session.json`
- [ ] Terminal tab — node-pty in main + xterm in renderer
- [ ] Untitled / new file flow
- [ ] Tab dirty indicator polish + confirm on close with unsaved changes
- [ ] `when` clauses in `KeymapService` (context keys: editor focused, palette open, etc.)

### P2 — UX & polish

- [ ] More bundled themes + theme picker command
- [ ] Search tab + problems tab (types exist, no UI)
- [ ] Status bar items (LSP status, line/col, encoding)
- [ ] Welcome view when no folder open
- [ ] Reduce main bundle / lazy-load Shiki langs further

### P3 — Platform & distribution

- [ ] electron-builder config + signed builds (macOS / Windows / Linux)
- [ ] LSP crash recovery (`lsp.onCrashed` currently no-op in preload)
- [ ] Additional language servers (rust-analyzer, etc.)
- [ ] Watch mode / file change reload from disk
- [ ] README for humans (optional unless requested)

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
6. Smoke test in `pnpm dev`

---

## Agent Anti-patterns

- Putting editor document text in React `useState`
- Importing Electron in renderer packages (use `window.jet`)
- Bundling native Node modules (`ws`, `node-pty`) in electron main vite build without `external`
- Setting vite electron outDir relative to `jet-app` root (breaks `package.json` main)
- Adding Tauri — project chose **Electron**
- Large shadcn default styling — keep RAD/custom theme direction
