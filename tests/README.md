# Playwright E2E tests

Shared UI specs live under `tests/electron/` (historical path). They run against the **Tauri** shell via `tauri-e2e`.

## Commands

```bash
pnpm test:tauri      # native Tauri channel suite + shared UI specs (tauri-e2e)
pnpm test:bench      # UX latency benchmarks in tests/bench/ (Tauri)
```

Worker count defaults to ~half of CPU cores (see `playwright.config.ts`). Override with `PLAYWRIGHT_WORKERS=N`.

Twelve flaky specs are skipped by default (`tests/electron/_flaky.ts`). Run `GHARARGAH_E2E_RUN_FLAKY=1 pnpm test:tauri` to include them. List + fix notes: `AGENTS.md` § Disabled flaky E2E specs.

### Headless by default

`pnpm test:tauri` builds the e2e binary and sets `GHARARGAH_E2E=1`. Headless parks the window
off-screen (not `hide()` — WKWebView throttles timers when fully hidden):

```bash
GHARARGAH_HEADED=1 pnpm test:tauri   # show Tauri window on-screen while debugging
```

True OS-headless Tauri is not available on macOS (WebKit needs a display).

## Layout

| Path | Role |
|------|------|
| `tests/electron/*.electron.spec.ts` | Shared UI specs (run via `tauri-e2e`) |
| `tests/electron/_launch.ts` | Shared launch helpers (`launchJet` → Tauri) |
| `tests/tauri/*.tauri.spec.ts` | Tauri-native channel / smoke specs |
| `tests/bench/*.bench.ts` | UX latency benchmarks with `budgets.json` |
| `tests/helpers/list.ts` | List panel layout assertions |
| `tests/helpers/location-list.ts` | Location list panel selectors |
| `tests/helpers/shell.ts` | Palette / explorer helpers |

## Fixture workspaces

- `fixtures/sample-workspace` — default TypeScript project for most specs (git repo)
- `fixtures/second-workspace` — second root for multi-root tests (git repo)

## Out of scope for automation

- Native OS folder/file dialogs (`showOpenFolderDialog`)
- Unimplemented git stage/revert chord commands
- Windows/Linux traffic-light geometry (macOS-only titlebar spec)
- Agents E2E (excluded from `tauri-e2e` via grepInvert)

## CI

GitHub Actions workflow `.github/workflows/ci.yml` runs `pnpm -r typecheck`, `pnpm test:tauri`, and `pnpm test:bench`.
