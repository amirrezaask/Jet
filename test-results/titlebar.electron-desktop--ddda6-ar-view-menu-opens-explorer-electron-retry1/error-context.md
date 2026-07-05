# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/electron/titlebar.electron.spec.ts >> desktop shell >> titlebar view menu opens explorer
- Location: tests/electron/titlebar.electron.spec.ts:47:7

# Error details

```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByText('Show Explorer', { exact: true })

```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test"
  2  | import { launchJet } from "./_launch.js"
  3  | 
  4  | test.describe("desktop shell", () => {
  5  |   test.skip(process.platform !== "darwin", "traffic lights are macOS-only")
  6  | 
  7  |   test("titlebar menubar clears the traffic-light zone", async () => {
  8  |     const { app, page } = await launchJet()
  9  |     const TRAFFIC_LIGHT_ZONE_PX = 78
  10 |     try {
  11 |       const bar = page.locator("[data-jet-titlebar]")
  12 |       await expect(bar).toBeVisible({ timeout: 10_000 })
  13 | 
  14 |       const geom = await page.evaluate(zone => {
  15 |         const bar = document.querySelector<HTMLElement>("[data-jet-titlebar]")
  16 |         if (!bar) return null
  17 |         const spacer = document.querySelector<HTMLElement>("[data-jet-traffic-light-spacer]")
  18 |         const menuItems = Array.from(
  19 |           document.querySelectorAll<HTMLElement>(
  20 |             "[data-jet-titlebar] [role='menubar'] > *, [data-jet-titlebar] button, [data-jet-titlebar] [role='menuitem']",
  21 |           ),
  22 |         )
  23 |         const menuLefts = menuItems
  24 |           .map(el => el.getBoundingClientRect().left)
  25 |           .filter(l => Number.isFinite(l))
  26 |         return {
  27 |           barLeft: bar.getBoundingClientRect().left,
  28 |           spacerRight: spacer?.getBoundingClientRect().right ?? null,
  29 |           minMenuLeft: menuLefts.length ? Math.min(...menuLefts) : null,
  30 |           zone,
  31 |         }
  32 |       }, TRAFFIC_LIGHT_ZONE_PX)
  33 | 
  34 |       expect(geom, "titlebar element must exist in Electron shell").not.toBeNull()
  35 |       expect(geom!.spacerRight, "traffic-light spacer must render").not.toBeNull()
  36 |       expect(geom!.spacerRight!).toBeGreaterThanOrEqual(TRAFFIC_LIGHT_ZONE_PX)
  37 |       expect(geom!.minMenuLeft, "at least one menu trigger must render").not.toBeNull()
  38 |       expect(
  39 |         geom!.minMenuLeft!,
  40 |         `first menu item left=${geom!.minMenuLeft} overlaps traffic-light zone (${TRAFFIC_LIGHT_ZONE_PX}px)`,
  41 |       ).toBeGreaterThanOrEqual(TRAFFIC_LIGHT_ZONE_PX)
  42 |     } finally {
  43 |       await app.close()
  44 |     }
  45 |   })
  46 | 
  47 |   test("titlebar view menu opens explorer", async () => {
  48 |     const { app, page } = await launchJet()
  49 |     try {
  50 |       const bar = page.locator("[data-jet-titlebar]")
  51 |       await expect(bar).toBeVisible({ timeout: 10_000 })
  52 |       await bar.getByText("View", { exact: true }).click()
  53 |       await page.waitForTimeout(200)
> 54 |       await page.getByText("Show Explorer", { exact: true }).click()
     |                                                              ^ TimeoutError: locator.click: Timeout 30000ms exceeded.
  55 |       await page.waitForTimeout(600)
  56 |       await expect(page.locator('[data-jet-list-panel="explorer"]')).toBeVisible()
  57 |     } finally {
  58 |       await app.close()
  59 |     }
  60 |   })
  61 | })
  62 | 
  63 | 
```