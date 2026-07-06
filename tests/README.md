# Playwright browser tests

Headless Chromium tests against `pnpm dev:web` (port **5174**). The dev server starts automatically via `playwright.config.ts`.

## Commands

```bash
pnpm test:web                  # all specs in tests/specs/ (default, headless)
pnpm test:screenshots          # pixel-regression specs (*.screenshot.spec.ts)
pnpm test:screenshots:update   # refresh golden PNGs
pnpm test:electron             # native shell (Electron only; builds jet-desktop first)
```

## Layout

| Path | Purpose |
|------|---------|
| `tests/specs/*.spec.ts` | Feature specs (boot, palette, explorer, editor, tab-drag, tab-switch, …) |
| `tests/specs/*.screenshot.spec.ts` | Optional pixel snapshots (separate project) |
| `tests/helpers/` | Shared boot, agent bridge, editor, overlays, list assertions, drag helpers |
| `tests/electron/` | Electron-only native chrome + LSP |

## Writing a spec

```typescript
import { test, expect } from "@playwright/test"
import { boot, SAMPLE } from "../helpers/boot.js"
import { agent } from "../helpers/agent.js"

test("my feature", async ({ page }) => {
  await boot(page, { workspace: SAMPLE, file: "src/index.ts" })
  await agent(page).executeCommand("ui.showCommandPalette")
  await expect(page.locator("body")).toContainText("Command palette")
})
```

### Helpers

- **`boot(page, opts)`** — navigate with optional `workspace`, `file`, `fontSize`, `query`, `extraFiles`; waits for `__jetAgent`.
- **`agent(page)`** — typed wrapper around `window.__jetAgent`:
  - `executeCommand`, `getState`, `openFile`, `openWorkspace`
  - `getEditorText`, `setEditorSelection`, `getCursorPosition`
  - `readFixtureFile`, `acceptConfirm`, `dismissConfirm`, `waitForListRows`
- **`focusEditor` / `typeInEditor` / `expectCursorLine`** — editor helpers (`tests/helpers/editor.ts`)
- **`expectEditorBuffer` / `switchTabExpectBuffer` / `expectActiveTabSuffix` / `expectEditorAndTabInSync`** — tab bar + CodeMirror doc sync (`tests/helpers/tabs.ts`); catches title/content drift when switching buffers.
- **`selectBufferFromList` / `expectMinOpenBuffers`** — buffer list overlay selection + open-buffer count gate.
- **`tests/specs/tab-switch.spec.ts`** — regression suite for tab bar clicks, rapid switching, buffer list, prev/next buffer commands, agent re-open, single CM instance, edit round-trip, tab bar active states.
- **`confirmDialog` / `expectOverlayOpen`** — overlay helpers (`tests/helpers/overlays.ts`)
- **`showExplorer(page)`** — runs `explorer.show` and waits for the explorer list panel.
- **`expectListRows` / `expectLayout` / `expectRowTextVisible`** — list/search anti-regression assertions.
- **`dispatchTabDrag` / `dispatchTabBarDrag`** — synthetic HTML5 drag for tab split/reorder tests.

### List/search assertions

When testing filtered lists (quick open, project search, palette), never assert the query string alone — assert rendered rows:

```typescript
await expectListRows(page, {
  panel: "locationlist",
  minItems: 2,
  needle: "src/index.ts",  // fixture-specific content
})
```

## Environment

| Variable | Effect |
|----------|--------|
| `JET_BASE_URL` | Override base URL (default `http://localhost:5174`) |
| `JET_E2E=1` | Set when launching Electron for e2e (`tests/electron/_launch.ts`) |

## Electron tests

`pnpm test:electron` builds `jet-desktop` then runs specs in `tests/electron/`.

| Spec | Requires |
|------|----------|
| `titlebar.electron.spec.ts` | macOS (traffic-light geometry) |
| `location-list.electron.spec.ts` | Electron shell — location list row readability |
| `lsp.electron.spec.ts` | `typescript-language-server` on PATH (auto-skipped if missing); includes nested project-root case (`fixtures/` workspace → `sample-workspace/` TS project) |
| `syntax-rust.electron.spec.ts` | Electron build |

Install LSP for local Electron LSP tests:

```bash
npm install -g typescript-language-server typescript
```

## CI

GitHub Actions workflow `.github/workflows/ci.yml` runs `pnpm -r typecheck`, `pnpm test:web`, and `pnpm test:electron` (macOS).
