# YAADE

Mission Control webapp: project home and terminal sessions (agent CLIs via PTY).

**Stack (TypeScript only — no Rust / no Tauri):**

| Process | Role |
| --- | --- |
| Vite SPA (`@gharargah/app`) | UI |
| `@gharargah/host-server` | FS / PTY / git / search / LSP over HTTP+WS (`:4747`) |

## Dev

```bash
pnpm install
pnpm dev          # host-server + Vite
```

Open the Vite URL (proxies `/api` and `/ws` to the host).

## Build / run without Vite

```bash
pnpm build        # Vite SPA + self-contained server + macOS DMG (on darwin)
                  # → dist/yaade/yaade
                  # → apps/gharargah-electron/dist/YAADE-*.dmg (macOS)

./dist/yaade/yaade              # SPA + host API on http://127.0.0.1:4747
./dist/yaade/yaade /path/repo   # same, open workspace at path
./dist/yaade/yaade --open       # also open the default browser

# Dev (monorepo + tsx) — same servers, no bundle:
pnpm --filter @gharargah/host-server start   # API + SPA on :4747 when dist exists
```

## Tests

```bash
pnpm -r typecheck
pnpm test:e2e     # Playwright against TS host (Chromium)
```

## Policy

No Rust crates, Cargo, or Tauri in this repo. Host + mocks are TypeScript under `apps/host-server`.
