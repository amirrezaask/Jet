# Jet / Gharargah

Mission Control webapp: project home, terminal sessions, optional agent chat.

**Stack (TypeScript only — no Rust / no Tauri):**

| Process | Role |
| --- | --- |
| Vite SPA (`@gharargah/app`) | UI |
| `@gharargah/host-server` | FS / PTY / git / search / LSP over HTTP+WS (`:4747`) |
| `@gharargah/agent-server` | Agent control plane (`:4751`) |

## Dev

```bash
pnpm install
pnpm dev          # host-server + agent-server + Vite
```

Open the Vite URL (proxies `/api` and `/ws` to the host).

## Build / run without Vite

```bash
pnpm build        # Vite SPA + Electron runtime + macOS DMG
                  # → apps/gharargah-electron/dist/Gharargah-*.dmg
pnpm --filter @gharargah/host-server start   # serves API + SPA on :4747 (web-only)
pnpm --filter @gharargah/agent-server start  # optional agents on :4751
```

## Tests

```bash
pnpm -r typecheck
pnpm test:e2e     # Playwright against TS host (Chromium)
```

## Policy

No Rust crates, Cargo, or Tauri in this repo. Host + mocks are TypeScript under `apps/host-server`.
