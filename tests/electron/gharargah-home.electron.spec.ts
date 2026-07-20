import { expect, test } from "@playwright/test"
import {
  expectLocatorVisible,
  expectSelectorVisible,
  expectLocatorContainsText,
  expectLocatorCount,
} from "../shell/assert.js"
import { hasPtySpawn, launchJet, execCommand } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("gharargah mission home", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("home greeting, project section, search, card opens terminal, home returns", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-gharargah-home]")
      await expectSelectorVisible(page, "[data-gharargah-shell='home']")
      await expectLocatorContainsText(page.locator("[data-gharargah-home]"), /Good (morning|afternoon|evening)/)

      const state = await page.evaluate(() => window.__gharargahAgent!.getState())
      expect(state.shellView).toBe("home")
      const workspaceName = state.workspaces[0]?.name ?? "sample-workspace"
      const sectionSel = `[data-gharargah-project-section][data-gharargah-project-name="${workspaceName}"]`

      const section = page.locator(sectionSel)
      await expectLocatorVisible(section)

      await section.getByRole("button", { name: "New terminal" }).click()
      await expect
        .poll(async () => page.evaluate(() => window.__gharargahAgent?.getState()?.shellView ?? null), {
          timeout: 20_000,
        })
        .toBe("terminal")
      await expectSelectorVisible(page, "[data-gharargah-shell='terminal']", { timeout: 20_000 })
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]", { timeout: 20_000 })
      const afterNew = await page.evaluate(() => window.__gharargahAgent!.getState())
      expect(afterNew.activeWorkspace).toBeTruthy()

      await page.locator("[data-gharargah-home-button]").click()
      await expectSelectorVisible(page, "[data-gharargah-home]")

      const cards = section.locator("[data-gharargah-terminal-card]")
      await expectLocatorVisible(cards.first())
      await expect
        .poll(async () => (await cards.first().textContent())?.trim().length ?? 0, { timeout: 10_000 })
        .toBeGreaterThan(0)

      const search = page.locator("[data-gharargah-home-search]")
      await search.fill("___no_such_project___")
      await expectLocatorCount(page.locator(sectionSel), 0)
      await search.fill(workspaceName.slice(0, Math.min(6, workspaceName.length)))
      await expectLocatorVisible(section)
      await expectLocatorVisible(cards.first())

      await cards.first().click()
      await expect
        .poll(async () => page.evaluate(() => window.__gharargahAgent?.getState()?.shellView ?? null), {
          timeout: 20_000,
        })
        .toBe("terminal")
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]")

      await execCommand(page, "gharargah.goHome")
      await expectSelectorVisible(page, "[data-gharargah-home]")
      const afterHome = await page.evaluate(() => window.__gharargahAgent!.getState())
      expect(afterHome.shellView).toBe("home")
    } finally {
      await app.close()
    }
  })

  test("product rename exposes Gharargah titlebar wordmark", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-gharargah-titlebar]")
      await expectLocatorContainsText(page.locator("[data-gharargah-titlebar]"), "Gharargah")
    } finally {
      await app.close()
    }
  })
})
