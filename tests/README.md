# Playwright Electron tests

Native Electron tests in `tests/electron/`. Builds `jet-desktop` before running.

## Commands

```bash
pnpm test:electron   # all specs in tests/electron/
```

## Layout

| Path | Role |
|------|------|
| `tests/electron/*.electron.spec.ts` | Electron app specs |
| `tests/electron/_launch.ts` | Shared launch helpers (`launchJet`, `openFixtureFile`, …) |
| `tests/helpers/list.js` | List panel layout assertions |
| `tests/helpers/location-list.js` | Location list panel selectors |

## Fixture workspace

`fixtures/sample-workspace` — small TypeScript project used as the default workspace in most specs.

## CI

GitHub Actions workflow `.github/workflows/ci.yml` runs `pnpm -r typecheck` and `pnpm test:electron` (macOS).
