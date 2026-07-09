# Playwright Electron tests

Native Electron tests in `tests/electron/`. Builds `jet-desktop` before running.

## Commands

```bash
pnpm test:electron   # all specs in tests/electron/
pnpm test:bench      # UX latency benchmarks in tests/bench/
```

### Headless by default

E2E and benchmarks run with `JET_E2E=1`, which hides the `BrowserWindow` unless headed:

```bash
JET_HEADED=1 pnpm test:electron   # show windows while debugging
PWDEBUG=1 pnpm test:electron        # Playwright debug + headed
```

## Layout

| Path | Role |
|------|------|
| `tests/electron/*.electron.spec.ts` | Electron app specs |
| `tests/electron/_launch.ts` | Shared launch helpers (`launchJet`, `openFixtureFile`, …) |
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

## CI

GitHub Actions workflow `.github/workflows/ci.yml` runs `pnpm -r typecheck`, `pnpm test:electron`, and `pnpm test:bench` (macOS).
