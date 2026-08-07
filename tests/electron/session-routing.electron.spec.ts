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
  test("worktrees Main opens embedded mux; switch via menu only", async () => {
    const { app, page } = await launchJet({ projectPage: true })
    try {
      await waitForProjectPage(page)
      await page.locator("[data-yaade-worktree-switcher]").click()
      await page.locator("[data-yaade-worktree-switcher-menu]").waitFor({
        state: "visible",
        timeout: 5_000,
      })
      await page.locator("[data-yaade-worktree-main]").click()
      await page.locator("[data-yaade-mux]").waitFor({
        state: "visible",
        timeout: 30_000,
      })
      await waitForMux(page)

      // Project chrome stays; no Workspace tab; mux is in-page.
      await expect
        .poll(
          async () => page.locator("[data-yaade-shell='project']").count(),
          { timeout: 5_000 },
        )
        .toBe(1)
      await expect
        .poll(async () => page.locator("[data-yaade-mux]").count(), {
          timeout: 5_000,
        })
        .toBe(1)
      await expect
        .poll(
          async () =>
            page.locator("[data-yaade-project-tab='workspace']").count(),
          { timeout: 3_000 },
        )
        .toBe(0)
      await expect
        .poll(
          async () =>
            page.locator("[data-yaade-project-panel='worktree']").evaluate(el => {
              return !el.classList.contains("invisible")
            }),
          { timeout: 5_000 },
        )
        .toBe(true)

      await expect
        .poll(async () => new URL(await locationHref(page)).searchParams.get("s"), {
          timeout: 10_000,
        })
        .toMatch(/^ses-/)

      const state = await page.evaluate(() => window.__yaadeAgent!.getState())
      expect(state.route).toBe("session")
      expect(state.sessionId).toMatch(/^ses-/)

      // Overview is still reachable without a Workspace tab.
      await page.locator("[data-yaade-project-tab='overview']").click()
      await expect
        .poll(
          async () =>
            page.locator("[data-yaade-project-panel='overview']").evaluate(el => {
              return !el.classList.contains("invisible")
            }),
          { timeout: 5_000 },
        )
        .toBe(true)

      // Worktrees menu returns to the tiling view for Main.
      await page.locator("[data-yaade-worktree-switcher]").click()
      await page.locator("[data-yaade-worktree-main]").click()
      await expect
        .poll(
          async () =>
            page.locator("[data-yaade-project-panel='worktree']").evaluate(el => {
              return !el.classList.contains("invisible")
            }),
          { timeout: 5_000 },
        )
        .toBe(true)

      await page.evaluate(async () => {
        await window.__yaadeAgent!.backToProject?.()
      })
      await waitForProjectPage(page)
      await expect
        .poll(async () => new URL(await locationHref(page)).searchParams.get("s"), {
          timeout: 10_000,
        })
        .toBeNull()
      await expect
        .poll(async () => page.locator("[data-yaade-mux]").count(), {
          timeout: 5_000,
        })
        .toBe(0)
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
      await page.evaluate(() => window.__yaadeAgent!.executeCommand("terminal.new"))
      await page.locator("[data-yaade-terminal-panel]").waitFor({
        state: "visible",
        timeout: 15_000,
      })

      await page.reload()
      await waitForMux(page)
      const state = await page.evaluate(() => window.__yaadeAgent!.getState())
      expect(state.sessionId).toBe(sessionId)
      await page.locator("[data-yaade-terminal-panel]").waitFor({
        state: "visible",
        timeout: 15_000,
      })
      await expect
        .poll(
          async () => page.locator("[data-yaade-shell='project']").count(),
          { timeout: 5_000 },
        )
        .toBe(1)
    } finally {
      await app.close()
    }
  })
})
