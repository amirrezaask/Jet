# YAADE

**Mission Control for AI coding agents.**

YAADE is a web app for running and watching CLI coding agents across your projects. Pick a repo, launch Codex / Claude / Cursor / OpenCode / Grok in a real PTY, keep sessions alive, and jump back in when they need you.

No chat wrapper. No fake agent API. Agents are the same CLIs you already use — just hosted in one place.

---

## What it does

### Home — project mission control
- Browse projects as a catalog, not a file tree
- See live session cards per project (status, agent, last activity)
- Start a blank shell or an agent session in a few clicks
- Persist multi-root project lists across reloads

### Terminal sessions
- Full PTY terminals (via `node-pty`) in modal workspaces
- Multiple terminal tabs per session
- Reopen any past session from its home card
- Escape / go-home returns you to Mission Control without killing the session

### Agent CLIs (PTY)
Launch the real binary in the project directory:

| Agent    | Binary         |
| -------- | -------------- |
| Codex    | `codex`        |
| Claude   | `claude`       |
| OpenCode | `opencode`     |
| Cursor   | `cursor-agent` |
| Grok     | `grok`         |

Resume support for providers that expose a session id (Codex, Claude, Cursor).

### Session workspace
Inside a session modal you get more than a dumb terminal:
- Terminal tabs + session switcher
- Optional Monaco editor pane (open / edit files without leaving the session)
- Project todos
- Git / explorer dialogs when you need them

### Notifications
- In-app notification center for agent stop / activity hooks
- Provider ingest endpoint for Codex / Claude Stop events
- Bell + timeline so background agents can ping you when they finish

### Appearance
- Dark / light color schemes
- Bundled themes + theme picker
- Zoom and shell settings, persisted locally

### Keyboard-first shell
Useful defaults (macOS `Mod` = ⌘):

| Action            | Shortcut      |
| ----------------- | ------------- |
| New session       | `Mod-n`       |
| Switch session    | `Mod-k`       |
| Quick open        | `Mod-p`       |
| Command palette   | `Mod-Shift-p` |
| Settings          | `Mod-,`       |
| Toggle sidebar    | `Mod-b`       |
| Go home           | `Mod-Shift-h` / `Esc` |
| Show terminal     | `Ctrl-\``     |

---

## Architecture

TypeScript only — **no Rust, no Tauri**.

| Layer | Role |
| ----- | ---- |
| Vite SPA (`@gharargah/app` + `@gharargah/ui`) | Mission Control UI, session modals, themes |
| `@gharargah/host-server` | Effect host — FS, PTY, git, search, LSP, notifications |
| `@gharargah/node-host` | Node implementations (PTY, FS, git, …) |
| Optional Electron shell | Thin `BrowserWindow` that loads the same SPA |

Renderer talks to the host over HTTP RPC (`/api/v1/rpc`) + WebSocket (`/ws`).

```
Browser / Electron
        │  HTTP + WS
        ▼
  host-server (:4747)
        │
        ▼
  node-host (PTY, FS, git, LSP, …)
```

---

## Quick start

```bash
pnpm install
pnpm dev          # host-server + Vite
```

Open the Vite URL (proxies `/api` and `/ws` to the host).

### Desktop (optional)

```bash
pnpm electron:dev   # same backends, Electron window
pnpm build && pnpm electron
```

### Production binary

```bash
pnpm build
./dist/yaade/yaade              # SPA + host on http://127.0.0.1:4747
./dist/yaade/yaade /path/repo   # open a workspace
./dist/yaade/yaade --open       # also open the browser
```

On macOS, `pnpm build` also produces a DMG under `apps/gharargah-electron/dist/`.

---

## Develop

```bash
pnpm -r typecheck
pnpm test           # unit tests across packages
pnpm test:e2e       # Playwright against TS host (Chromium)
pnpm test:bench     # UX latency budgets
```

Headed E2E:

```bash
GHARARGAH_HEADED=1 pnpm test:e2e
```

---

## Monorepo map

```
apps/
  gharargah/            Vite frontend shell
  gharargah-electron/   Thin Electron main
  host-server/          Effect host (HTTP/WS + PTY)
packages/
  gharargah-app/        React app wiring
  gharargah-ui/         Home, modals, overlays, themes
  gharargah-node-host/  Node FS / git / PTY / LSP bridge
  gharargah-host-client/Effect client + Promise shim
  gharargah-rpc/        Shared IPC schemas
  gharargah-shared/     URIs, theme types, primitives
  gharargah-workspace/  Workspace + tab registry
  gharargah-monaco/     Monaco editor host (session modal)
  gharargah-agents/     Agent CLI id helpers
tests/
  electron/             Shared Playwright UI specs
```

---

## Policy

Host IPC and desktop shell are TypeScript. Do not add Rust crates, Cargo, or Tauri to this repo.
