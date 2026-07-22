import { expect, test } from "@playwright/test"
import {
  expectLocatorVisible,
  expectSelectorVisible,
  expectLocatorContainsText,
  expectLocatorCount,
} from "../shell/assert.js"
import { hasPtySpawn, launchJet } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("project todos board", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("home summary opens TODOs tab; create persists across reload", async () => {
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

      // Open session modal on TODOs board via home summary.
      await section.locator("[data-gharargah-todo-summary-toggle]").click()
      const modal = page.locator("[data-gharargah-terminal-modal]")
      await expectLocatorVisible(modal)
      await expect
        .poll(async () => modal.getAttribute("data-gharargah-session-mode"))
        .toBe("todos")

      const board = modal.locator("[data-gharargah-todo-board]")
      await expectLocatorVisible(board)

      // Add card in Todo column.
      await board.locator('[data-gharargah-todo-column-add="todo"]').click()
      const composer = board.locator("[data-gharargah-todo-composer-text]")
      await expectLocatorVisible(composer)
      await composer.click()
      await composer.fill("Review architecture")
      await board.locator("[data-gharargah-todo-composer-submit]").click()

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

      await expectLocatorContainsText(board, "Review architecture")
      await expectLocatorCount(board.locator("[data-gharargah-todo-card]"), 1)
      await expect
        .poll(async () =>
          board.locator('[data-gharargah-todo-column="todo"]').getAttribute("data-todo-column-count"),
        )
        .toBe("1")

      // Move to Doing via menu.
      await board.locator("[data-gharargah-todo-item-menu]").click()
      await page.getByRole("menuitem", { name: /Move to Doing/i }).click()
      await expect
        .poll(async () =>
          board.locator('[data-gharargah-todo-column="doing"]').getAttribute("data-todo-column-count"),
        )
        .toBe("1")
      await expect
        .poll(async () =>
          board.locator('[data-gharargah-todo-column="todo"]').getAttribute("data-todo-column-count"),
        )
        .toBe("0")

      // Switch tabs still available.
      await modal.locator('[data-gharargah-session-mode-tab="terminal"]').click()
      await expect
        .poll(async () => modal.getAttribute("data-gharargah-session-mode"))
        .toBe("terminal")
      await modal.locator('[data-gharargah-session-mode-tab="todos"]').click()
      await expectLocatorVisible(board)
      await expectLocatorContainsText(board, "Review architecture")

      await modal.locator("[data-gharargah-terminal-modal-close]").click()
      await expect.poll(async () => modal.isVisible()).toBe(false)

      // Summary counter updated on home.
      await expect
        .poll(async () => summary.getAttribute("data-todo-count"), { timeout: 10_000 })
        .toBe("1")

      // Persist across full reload — reopen board.
      await page.reload()
      await expectSelectorVisible(page, "[data-gharargah-home]")
      const sectionReload = page.locator(
        `[data-gharargah-project-section][data-gharargah-project-name="${workspaceName}"]`,
      )
      const summaryReload = sectionReload.locator("[data-gharargah-todo-summary]")
      await expect
        .poll(async () => summaryReload.getAttribute("data-todo-count"))
        .toBe("1")
      await expectLocatorContainsText(summaryReload, /1 todos/)

      await sectionReload.locator("[data-gharargah-todo-summary-toggle]").click()
      const boardReload = page.locator("[data-gharargah-todo-board]")
      await expectLocatorVisible(boardReload)
      await expectLocatorContainsText(boardReload, "Review architecture")
      await expect
        .poll(async () =>
          boardReload.locator('[data-gharargah-todo-column="doing"]').getAttribute("data-todo-column-count"),
        )
        .toBe("1")
    } finally {
      await app.close()
    }
  })
})
