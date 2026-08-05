import { expect, test } from "@playwright/test"
import {
  launchJet,
  waitForMux,
  waitForProjectPage,
} from "./_launch.js"

async function locationHref(page: {
  evaluate: <R>(fn: () => R | Promise<R>) => Promise<R>
}): Promise<string> {
  return page.evaluate(() => location.href)
}

test.describe("session routing", () => {
  test("create session adds ?s= and back returns to project page", async () => {
    const { app, page } = await launchJet({ projectPage: true })
    try {
      await waitForProjectPage(page)
      await page.locator("[data-yaade-new-session]").click()
      await page.locator("[data-yaade-new-session-dialog]").waitFor({
        state: "visible",
        timeout: 5_000,
      })
      await page.locator("[data-yaade-create-session]").click()
      await page.locator("[data-yaade-mux]").waitFor({
        state: "visible",
        timeout: 30_000,
      })
      await waitForMux(page)

      await expect
        .poll(async () => new URL(await locationHref(page)).searchParams.get("s"), {
          timeout: 10_000,
        })
        .toMatch(/^ses-/)

      const state = await page.evaluate(() => window.__yaadeAgent!.getState())
      expect(state.route).toBe("session")
      expect(state.sessionId).toMatch(/^ses-/)

      await page.locator("[data-yaade-session-back]").click()
      await waitForProjectPage(page)
      await expect
        .poll(async () => new URL(await locationHref(page)).searchParams.get("s"), {
          timeout: 10_000,
        })
        .toBeNull()
    } finally {
      await app.close()
    }
  })

  test("reload restores the open session layout", async () => {
    const { app, page } = await launchJet({ projectPage: true })
    try {
      await waitForProjectPage(page)
      const sessionId = await page.evaluate(async () => {
        const created = await window.__yaadeAgent!.createProjectSession?.({
          title: "Reload me",
        })
        return created?.id ?? null
      })
      expect(sessionId).toBeTruthy()
      await waitForMux(page)

      await page.reload()
      await waitForMux(page)
      const state = await page.evaluate(() => window.__yaadeAgent!.getState())
      expect(state.sessionId).toBe(sessionId)
      await page.locator("[data-yaade-terminal-panel]").waitFor({
        state: "visible",
        timeout: 15_000,
      })
    } finally {
      await app.close()
    }
  })
})
