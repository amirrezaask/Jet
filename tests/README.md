# Playwright browser tests

Headless Chromium tests against `pnpm dev:web` (port **5174**). The dev server starts automatically via `playwright.config.ts`.

## Commands

```bash
pnpm test:web                  # all specs in tests/specs/ (default, headless)
pnpm test:screenshots          # pixel-regression specs (*.screenshot.spec.ts)
pnpm test:screenshots:update   # refresh golden PNGs
pnpm test:electron             # native shell (Electron only)
```

## Layout

| Path | Purpose |
|------|---------|
| `tests/specs/*.spec.ts` | Feature specs (boot, palette, explorer, editor, tab-drag, …) |
| `tests/specs/*.screenshot.spec.ts` | Optional pixel snapshots (separate project) |
| `tests/helpers/` | Shared boot, agent bridge, list assertions, drag helpers |
| `tests/electron/` | Electron-only native chrome |

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

- **`boot(page, opts)`** — navigate with optional `workspace`, `file`, `fontSize`, query params; waits for `__jetAgent`.
- **`agent(page)`** — typed wrapper around `window.__jetAgent` (`executeCommand`, `getState`, `openFile`, …).
- **`showExplorer(page)`** — runs `explorer.show` and waits for the explorer list panel.
- **`expectListRows` / `expectLayout` / `expectRowTextVisible`** — list/search anti-regression assertions (ported from the old JSON scenario runner).
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

## Electron-only paths

Browser specs cannot cover native traffic lights, folder dialogs, or LSP. Use `tests/electron/*.electron.spec.ts` for those.
