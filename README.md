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
pnpm build        # Vite SPA + self-contained server + macOS DMG (on darwin)
                  # → dist/gharargah/gharargah
                  # → apps/gharargah-electron/dist/Gharargah-*.dmg (macOS)

./dist/gharargah/gharargah              # SPA + host API on http://127.0.0.1:4747
./dist/gharargah/gharargah /path/repo   # same, open workspace at path
./dist/gharargah/gharargah --open       # also open the default browser

# Dev (monorepo + tsx) — same servers, no bundle:
pnpm --filter @gharargah/host-server start   # API + SPA on :4747 when dist exists
pnpm --filter @gharargah/agent-server start  # optional agents on :4751
```

## Tests

```bash
pnpm -r typecheck
pnpm test:e2e     # Playwright against TS host (Chromium)
```

## Policy

No Rust crates, Cargo, or Tauri in this repo. Host + mocks are TypeScript under `apps/host-server`.
