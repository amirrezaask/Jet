import { expect, test } from "@playwright/test"
import {
  expectLocatorVisible,
  expectSelectorVisible,
  expectLocatorContainsText,
  expectLocatorCount,
} from "../shell/assert.js"
import { hasPtySpawn, launchJet } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("project todos on home", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("drawer create persists after close + reopen; counter updates", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-gharargah-home]")

      const state = await page.evaluate(() => window.__gharargahAgent!.getState())
      const workspaceName = state.workspaces[0]?.name ?? "sample-workspace"
      const section = page.locator(
        `[data-gharargah-project-section][data-gharargah-project-name="${workspaceName}"]`,
      )
      await expectLocatorVisible(section)

      await page.evaluate(() => {
        const repo = window.__gharargahProjectTodos
        if (!repo) throw new Error("__gharargahProjectTodos missing")
        localStorage.removeItem("jet-project-todos-v1")
        localStorage.removeItem("jet-project-todo-ui-v1")
        repo._resetForTests(localStorage)
      })

      const summary = section.locator("[data-gharargah-todo-summary]")
      await expectLocatorVisible(summary)
      await expect
        .poll(async () => summary.getAttribute("data-todo-count"))
        .toBe("0")
      await expectLocatorCount(section.locator("[data-gharargah-todo-card]"), 0)

      // Open empty drawer (auto-opens composer when total === 0).
      await section.locator("[data-gharargah-todo-summary-toggle]").click()
      const drawer = page.locator("[data-gharargah-todo-drawer]")
      await expectLocatorVisible(drawer)

      const composer = drawer.locator("[data-gharargah-todo-composer-text]")
      await expectLocatorVisible(composer)
      await composer.click()
      await composer.fill("Review architecture")
      await expect
        .poll(async () =>
          composer.evaluate(el => (el as HTMLInputElement).value),
        )
        .toBe("Review architecture")
      await drawer.locator("[data-gharargah-todo-composer-submit]").click()

      // Prefer live repo count — surfaces create/key failures before UI assertions.
      await expect
        .poll(async () => {
          return page.evaluate(() => {
            const repo = window.__gharargahProjectTodos
            const sectionEl = document.querySelector(
              "[data-gharargah-project-section]",
            )
            const projectId =
              sectionEl?.getAttribute("data-gharargah-project-id") ?? ""
            return repo?.listProjectTodos(projectId).length ?? -1
          })
        }, { timeout: 10_000 })
        .toBe(1)

      await expect
        .poll(async () => summary.getAttribute("data-todo-count"), { timeout: 10_000 })
        .toBe("1")
      await expectLocatorContainsText(summary, /1 todos/)
      await expectLocatorContainsText(drawer, "Review architecture")
      await expectLocatorCount(drawer.locator("[data-gharargah-todo-item]"), 1)

      // Escape must not dismiss the drawer — only the X button.
      await page.keyboard.press("Escape")
      await expectLocatorVisible(drawer)

      await drawer.locator("[data-gharargah-todo-drawer-close]").click()
      await expect.poll(async () => drawer.isVisible()).toBe(false)

      // Reopen — stored todo + counter must remain.
      await section.locator("[data-gharargah-todo-summary-toggle]").click()
      await expectLocatorVisible(drawer)
      await expect
        .poll(async () => drawer.getAttribute("data-todo-count"))
        .toBe("1")
      await expectLocatorContainsText(drawer, "Review architecture")
      await expectLocatorCount(drawer.locator("[data-gharargah-todo-item]"), 1)
      await expect
        .poll(async () => summary.getAttribute("data-todo-count"))
        .toBe("1")

      // Add second todo, close via X, reopen again.
      await drawer.locator("[data-gharargah-todo-drawer-add]").click()
      const composer2 = drawer.locator("[data-gharargah-todo-composer-text]")
      await expectLocatorVisible(composer2)
      await composer2.fill("Ship todos feature")
      await drawer.locator("[data-gharargah-todo-composer-submit]").click()

      await expect
        .poll(async () => summary.getAttribute("data-todo-count"), { timeout: 10_000 })
        .toBe("2")
      await expectLocatorContainsText(drawer, "Ship todos feature")

      await drawer.locator("[data-gharargah-todo-drawer-close]").click()
      await expect.poll(async () => drawer.isVisible()).toBe(false)
      await section.locator("[data-gharargah-todo-summary-toggle]").click()
      await expectLocatorVisible(drawer)
      await expectLocatorContainsText(drawer, "Review architecture")
      await expectLocatorContainsText(drawer, "Ship todos feature")
      await expect
        .poll(async () => summary.getAttribute("data-todo-count"))
        .toBe("2")

      // Persist across full reload.
      await page.reload()
      await expectSelectorVisible(page, "[data-gharargah-home]")
      const sectionReload = page.locator(
        `[data-gharargah-project-section][data-gharargah-project-name="${workspaceName}"]`,
      )
      const summaryReload = sectionReload.locator("[data-gharargah-todo-summary]")
      await expect
        .poll(async () => summaryReload.getAttribute("data-todo-count"))
        .toBe("2")
      await expectLocatorContainsText(summaryReload, /2 todos/)

      await sectionReload.locator("[data-gharargah-todo-summary-toggle]").click()
      const drawerReload = page.locator("[data-gharargah-todo-drawer]")
      await expectLocatorVisible(drawerReload)
      await expectLocatorContainsText(drawerReload, "Review architecture")
      await expectLocatorContainsText(drawerReload, "Ship todos feature")
    } finally {
      await app.close()
    }
  })
})
