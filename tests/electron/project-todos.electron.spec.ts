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
  await expectSelectorVisible(page, "[data-yaade-terminal-modal]", {
    timeout: 20_000,
  })
  await execCommand(page, "dialog.showTodos")
  const modal = page.locator("[data-yaade-terminal-modal]")
  await expect
    .poll(async () => modal.getAttribute("data-yaade-session-mode"))
    .toBe("todos")
  const board = modal.locator("[data-yaade-todo-board]")
  await expectLocatorVisible(board)
  const projectId =
    (await board.getAttribute("data-project-id"))?.trim() ?? ""
  expect(projectId).toBeTruthy()
  return { modal, board, projectId }
}

test.describe.skip("project todos board", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("session TODOs tab create persists across reload", async () => {
    const { app, page } = await launchJet()
    try {
      await ensureSidebarLayout(page)
      await expectSelectorVisible(page, "[data-yaade-mission-sidebar]")

      const { modal, board, projectId } = await openTodosBoard(page)

      await page.evaluate(pid => {
        const repo = window.__yaadeProjectTodos
        if (!repo) throw new Error("__yaadeProjectTodos missing")
        localStorage.removeItem("jet-project-todos-v1")
        localStorage.removeItem("jet-project-todo-ui-v1")
        repo._resetForTests(localStorage)
        void pid
      }, projectId)

      // Add card in Todo column.
      await board.locator('[data-yaade-todo-column-add="todo"]').click()
      const composer = board.locator("[data-yaade-todo-composer-text]")
      await expectLocatorVisible(composer)
      await composer.click()
      await composer.fill("Review architecture")
      await board.locator("[data-yaade-todo-composer-submit]").click()

      await expect
        .poll(async () => {
          return page.evaluate(pid => {
            const repo = window.__yaadeProjectTodos
            return repo?.listProjectTodos(pid).length ?? -1
          }, projectId)
        }, { timeout: 10_000 })
        .toBe(1)

      await expectLocatorContainsText(board, "Review architecture")
      await expectLocatorCount(board.locator("[data-yaade-todo-card]"), 1)
      await expect
        .poll(async () =>
          board
            .locator('[data-yaade-todo-column="todo"]')
            .getAttribute("data-todo-column-count"),
        )
        .toBe("1")

      // Move to Doing via menu.
      await board.locator("[data-yaade-todo-item-menu]").click()
      await page.getByRole("menuitem", { name: /Move to Doing/i }).click()
      await expect
        .poll(async () =>
          board
            .locator('[data-yaade-todo-column="doing"]')
            .getAttribute("data-todo-column-count"),
        )
        .toBe("1")
      await expect
        .poll(async () =>
          board
            .locator('[data-yaade-todo-column="todo"]')
            .getAttribute("data-todo-column-count"),
        )
        .toBe("0")

      // Editing is intentionally multiline: Enter inserts a newline and Mod+Enter saves.
      await board.locator("[data-yaade-todo-text]").evaluate(element => {
        element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
      })
      const editField = board.locator("[data-yaade-todo-edit-input]")
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
      await expectLocatorCount(board.locator("[data-yaade-todo-edit-input]"), 0)
      await expectLocatorContainsText(board, "Review architecture\nwith the team")

      // Session tools remain available; TODOs stays reachable as a command.
      await modal.locator('[data-yaade-session-mode-tab="terminal"]').click()
      await expect
        .poll(async () => modal.getAttribute("data-yaade-session-mode"))
        .toBe("terminal")
      await execCommand(page, "dialog.showTodos")
      await expectLocatorVisible(board)
      await expectLocatorContainsText(board, "Review architecture\nwith the team")

      await execCommand(page, "yaade.goHome")
      await expect.poll(async () => modal.isVisible()).toBe(false)

      // Persist across full reload — remount board (lazy repo) then assert.
      await page.reload()
      await page.waitForFunction(() => window.__yaadeAgent != null, null, {
        timeout: 30_000,
      })
      await page.evaluate(() => window.__yaadeAgent!.waitForReady())
      await ensureSidebarLayout(page)

      const { board: boardReload } = await openTodosBoard(page)
      await expectLocatorContainsText(
        boardReload,
        "Review architecture\nwith the team",
      )
      await expect
        .poll(async () =>
          boardReload
            .locator('[data-yaade-todo-column="doing"]')
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
      await expectSelectorVisible(page, "[data-yaade-mission-sidebar]")

      const { modal, board, projectId } = await openTodosBoard(page)

      await page.evaluate(pid => {
        const repo = window.__yaadeProjectTodos
        if (!repo) throw new Error("__yaadeProjectTodos missing")
        localStorage.removeItem("jet-project-todos-v1")
        localStorage.removeItem("jet-project-todo-ui-v1")
        repo._resetForTests(localStorage)
        if (!pid) throw new Error("project id missing")
        repo.createProjectTodo(pid, { text: "Alpha card", status: "todo" })
        repo.createProjectTodo(pid, { text: "Beta card", status: "todo" })
      }, projectId)

      await expectLocatorVisible(modal)
      await expectLocatorCount(board.locator("[data-yaade-todo-card]"), 2)

      const todoColumn = board.locator('[data-yaade-todo-column="todo"]')
      const doingColumn = board.locator('[data-yaade-todo-column="doing"]')
      await expect
        .poll(async () => todoColumn.getAttribute("data-todo-column-count"))
        .toBe("2")

      const alpha = todoColumn.locator('[data-yaade-todo-card]').filter({
        hasText: "Alpha card",
      })
      await expectLocatorVisible(alpha)
      await alpha.locator("[data-yaade-todo-item-menu]").click()
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
            const repo = window.__yaadeProjectTodos
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
