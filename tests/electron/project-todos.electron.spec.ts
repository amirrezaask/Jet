import { expect, test, type Locator, type Page } from "@playwright/test"
import {
  expectLocatorVisible,
  expectSelectorVisible,
  expectLocatorContainsText,
  expectLocatorCount,
} from "../shell/assert.js"
import {
  ensureSidebarLayout,
  execCommand,
  hasPtySpawn,
  launchJet,
  openNewAgentSession,
} from "./_launch.js"

const ptyAvailable = hasPtySpawn()

async function openTodosBoard(page: Page): Promise<{
  modal: Locator
  board: Locator
  projectId: string
}> {
  await openNewAgentSession(page)
  await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", {
    timeout: 20_000,
  })
  await execCommand(page, "dialog.showTodos")
  const modal = page.locator("[data-gharargah-terminal-modal]")
  await expect
    .poll(async () => modal.getAttribute("data-gharargah-session-mode"))
    .toBe("todos")
  const board = modal.locator("[data-gharargah-todo-board]")
  await expectLocatorVisible(board)
  const projectId =
    (await board.getAttribute("data-project-id"))?.trim() ?? ""
  expect(projectId).toBeTruthy()
  return { modal, board, projectId }
}

test.describe("project todos board", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("session TODOs tab create persists across reload", async () => {
    const { app, page } = await launchJet()
    try {
      await ensureSidebarLayout(page)
      await expectSelectorVisible(page, "[data-gharargah-mission-sidebar]")

      const { modal, board, projectId } = await openTodosBoard(page)

      await page.evaluate(pid => {
        const repo = window.__gharargahProjectTodos
        if (!repo) throw new Error("__gharargahProjectTodos missing")
        localStorage.removeItem("jet-project-todos-v1")
        localStorage.removeItem("jet-project-todo-ui-v1")
        repo._resetForTests(localStorage)
        void pid
      }, projectId)

      // Add card in Todo column.
      await board.locator('[data-gharargah-todo-column-add="todo"]').click()
      const composer = board.locator("[data-gharargah-todo-composer-text]")
      await expectLocatorVisible(composer)
      await composer.click()
      await composer.fill("Review architecture")
      await board.locator("[data-gharargah-todo-composer-submit]").click()

      await expect
        .poll(async () => {
          return page.evaluate(pid => {
            const repo = window.__gharargahProjectTodos
            return repo?.listProjectTodos(pid).length ?? -1
          }, projectId)
        }, { timeout: 10_000 })
        .toBe(1)

      await expectLocatorContainsText(board, "Review architecture")
      await expectLocatorCount(board.locator("[data-gharargah-todo-card]"), 1)
      await expect
        .poll(async () =>
          board
            .locator('[data-gharargah-todo-column="todo"]')
            .getAttribute("data-todo-column-count"),
        )
        .toBe("1")

      // Move to Doing via menu.
      await board.locator("[data-gharargah-todo-item-menu]").click()
      await page.getByRole("menuitem", { name: /Move to Doing/i }).click()
      await expect
        .poll(async () =>
          board
            .locator('[data-gharargah-todo-column="doing"]')
            .getAttribute("data-todo-column-count"),
        )
        .toBe("1")
      await expect
        .poll(async () =>
          board
            .locator('[data-gharargah-todo-column="todo"]')
            .getAttribute("data-todo-column-count"),
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

      // Session tools remain available; TODOs stays reachable as a command.
      await modal.locator('[data-gharargah-session-mode-tab="terminal"]').click()
      await expect
        .poll(async () => modal.getAttribute("data-gharargah-session-mode"))
        .toBe("terminal")
      await execCommand(page, "dialog.showTodos")
      await expectLocatorVisible(board)
      await expectLocatorContainsText(board, "Review architecture\nwith the team")

      await execCommand(page, "gharargah.goHome")
      await expect.poll(async () => modal.isVisible()).toBe(false)

      // Persist across full reload — remount board (lazy repo) then assert.
      await page.reload()
      await page.waitForFunction(() => window.__gharargahAgent != null, null, {
        timeout: 30_000,
      })
      await page.evaluate(() => window.__gharargahAgent!.waitForReady())
      await ensureSidebarLayout(page)

      const { board: boardReload } = await openTodosBoard(page)
      await expectLocatorContainsText(
        boardReload,
        "Review architecture\nwith the team",
      )
      await expect
        .poll(async () =>
          boardReload
            .locator('[data-gharargah-todo-column="doing"]')
            .getAttribute("data-todo-column-count"),
        )
        .toBe("1")
    } finally {
      await app.close()
    }
  })

  test("menu moves cards across columns", async () => {
    const { app, page } = await launchJet()
    try {
      await ensureSidebarLayout(page)
      await expectSelectorVisible(page, "[data-gharargah-mission-sidebar]")

      const { modal, board, projectId } = await openTodosBoard(page)

      await page.evaluate(pid => {
        const repo = window.__gharargahProjectTodos
        if (!repo) throw new Error("__gharargahProjectTodos missing")
        localStorage.removeItem("jet-project-todos-v1")
        localStorage.removeItem("jet-project-todo-ui-v1")
        repo._resetForTests(localStorage)
        if (!pid) throw new Error("project id missing")
        repo.createProjectTodo(pid, { text: "Alpha card", status: "todo" })
        repo.createProjectTodo(pid, { text: "Beta card", status: "todo" })
      }, projectId)

      await expectLocatorVisible(modal)
      await expectLocatorCount(board.locator("[data-gharargah-todo-card]"), 2)

      const todoColumn = board.locator('[data-gharargah-todo-column="todo"]')
      const doingColumn = board.locator('[data-gharargah-todo-column="doing"]')
      await expect
        .poll(async () => todoColumn.getAttribute("data-todo-column-count"))
        .toBe("2")

      const alpha = todoColumn.locator('[data-gharargah-todo-card]').filter({
        hasText: "Alpha card",
      })
      await expectLocatorVisible(alpha)
      await alpha.locator("[data-gharargah-todo-item-menu]").click()
      await page.getByRole("menuitem", { name: /Move to Doing/i }).click()

      await expect
        .poll(async () => doingColumn.getAttribute("data-todo-column-count"), {
          timeout: 10_000,
        })
        .toBe("1")
      await expect
        .poll(async () => todoColumn.getAttribute("data-todo-column-count"))
        .toBe("1")
      await expectLocatorContainsText(doingColumn, "Alpha card")
      await expectLocatorContainsText(todoColumn, "Beta card")

      await expect
        .poll(async () => {
          return page.evaluate(pid => {
            const repo = window.__gharargahProjectTodos
            const todo = repo?.listByStatus(pid, "todo").map(t => t.text) ?? []
            const doing = repo?.listByStatus(pid, "doing").map(t => t.text) ?? []
            return { todo, doing }
          }, projectId)
        })
        .toEqual({ todo: ["Beta card"], doing: ["Alpha card"] })
    } finally {
      await app.close()
    }
  })
})
