import { expect, test, type Locator, type Page } from "@playwright/test"
import {
  expectLocatorVisible,
  expectSelectorVisible,
  expectLocatorContainsText,
  expectLocatorCount,
} from "../shell/assert.js"
import { hasPtySpawn, launchJet } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

/** Pointer drag for @dnd-kit (needs >8px travel to activate). */
async function dragLocatorTo(page: Page, source: Locator, target: Locator) {
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error("dragLocatorTo: missing bounding box")
  const startX = from.x + Math.min(24, from.width / 2)
  const startY = from.y + from.height / 2
  const endX = to.x + to.width / 2
  const endY = to.y + Math.min(48, to.height / 3)
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 12, startY + 4, { steps: 4 })
  await page.mouse.move(endX, endY, { steps: 16 })
  await page.mouse.up()
}

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

      // Editing is intentionally multiline: Enter inserts a newline and Mod+Enter saves.
      await board.locator("[data-gharargah-todo-text]").evaluate(element => {
        element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
      })
      const editField = board.locator("[data-gharargah-todo-edit-input]")
      await expectLocatorVisible(editField)
      await expect.poll(() => editField.evaluate(element => element.tagName)).toBe("TEXTAREA")
      await editField.fill("Review architecture")
      await editField.press("End")
      await editField.press("Enter")
      await page.keyboard.type("with the team")
      await expect
        .poll(() => editField.evaluate(element => (element as HTMLTextAreaElement).value))
        .toBe("Review architecture\nwith the team")
      await expectLocatorVisible(editField)
      await editField.press("Control+Enter")
      await expectLocatorCount(board.locator("[data-gharargah-todo-edit-input]"), 0)
      await expectLocatorContainsText(board, "Review architecture\nwith the team")

      // Switch tabs still available.
      await modal.locator('[data-gharargah-session-mode-tab="terminal"]').click()
      await expect
        .poll(async () => modal.getAttribute("data-gharargah-session-mode"))
        .toBe("terminal")
      await modal.locator('[data-gharargah-session-mode-tab="todos"]').click()
      await expectLocatorVisible(board)
      await expectLocatorContainsText(board, "Review architecture\nwith the team")

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
      await expectLocatorContainsText(boardReload, "Review architecture\nwith the team")
      await expect
        .poll(async () =>
          boardReload.locator('[data-gharargah-todo-column="doing"]').getAttribute("data-todo-column-count"),
        )
        .toBe("1")
    } finally {
      await app.close()
    }
  })

  test("drag card reorders within column and moves across states", async () => {
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
        const sectionEl = document.querySelector("[data-gharargah-project-section]")
        const projectId = sectionEl?.getAttribute("data-gharargah-project-id") ?? ""
        if (!projectId) throw new Error("project id missing")
        repo.createProjectTodo(projectId, { text: "Alpha card", status: "todo" })
        repo.createProjectTodo(projectId, { text: "Beta card", status: "todo" })
        repo.createProjectTodo(projectId, { text: "Gamma card", status: "todo" })
      })

      await section.locator("[data-gharargah-todo-summary-toggle]").click()
      const modal = page.locator("[data-gharargah-terminal-modal]")
      await expectLocatorVisible(modal)
      await expect
        .poll(async () => modal.getAttribute("data-gharargah-session-mode"))
        .toBe("todos")

      const board = modal.locator("[data-gharargah-todo-board]")
      await expectLocatorVisible(board)
      await expectLocatorCount(board.locator("[data-gharargah-todo-card]"), 3)

      const todoColumn = board.locator('[data-gharargah-todo-column="todo"]')
      const doingColumn = board.locator('[data-gharargah-todo-column="doing"]')
      await expect
        .poll(async () => todoColumn.getAttribute("data-todo-column-count"))
        .toBe("3")

      // Reorder within Todo: drag Alpha below Beta (to end of list after Beta).
      const alpha = todoColumn.locator('[data-gharargah-todo-card][data-todo-id]').filter({
        hasText: "Alpha card",
      })
      const beta = todoColumn.locator('[data-gharargah-todo-card]').filter({
        hasText: "Beta card",
      })
      const gamma = todoColumn.locator('[data-gharargah-todo-card]').filter({
        hasText: "Gamma card",
      })
      await expectLocatorVisible(alpha)
      await dragLocatorTo(page, alpha, gamma)

      await expect
        .poll(async () => {
          return page.evaluate(() => {
            const repo = window.__gharargahProjectTodos
            const sectionEl = document.querySelector("[data-gharargah-project-section]")
            const projectId = sectionEl?.getAttribute("data-gharargah-project-id") ?? ""
            return repo?.listByStatus(projectId, "todo").map(t => t.text) ?? []
          })
        }, { timeout: 10_000 })
        .toEqual(["Beta card", "Gamma card", "Alpha card"])

      // Move Alpha → Doing via drag onto empty Doing column.
      const alphaAfter = todoColumn.locator('[data-gharargah-todo-card]').filter({
        hasText: "Alpha card",
      })
      await dragLocatorTo(page, alphaAfter, doingColumn)

      await expect
        .poll(async () => doingColumn.getAttribute("data-todo-column-count"), {
          timeout: 10_000,
        })
        .toBe("1")
      await expect
        .poll(async () => todoColumn.getAttribute("data-todo-column-count"))
        .toBe("2")
      await expectLocatorContainsText(doingColumn, "Alpha card")

      await expect
        .poll(async () => {
          return page.evaluate(() => {
            const repo = window.__gharargahProjectTodos
            const sectionEl = document.querySelector("[data-gharargah-project-section]")
            const projectId = sectionEl?.getAttribute("data-gharargah-project-id") ?? ""
            const doing = repo?.listByStatus(projectId, "todo").map(t => t.text) ?? []
            const moved = repo?.listByStatus(projectId, "doing").map(t => t.text) ?? []
            return { todo: doing, doing: moved }
          })
        })
        .toEqual({ todo: ["Beta card", "Gamma card"], doing: ["Alpha card"] })
    } finally {
      await app.close()
    }
  })
})
