import { expect, test } from "@playwright/test"
import {
  expectLocatorVisible,
  expectSelectorVisible,
  expectLocatorContainsText,
  expectLocatorCount,
} from "../shell/assert.js"
import { hasPtySpawn, launchJet, execCommand } from "./_launch.js"
import { expectListRows } from "../helpers/list.js"

const ptyAvailable = hasPtySpawn()

test.describe("gharargah mission home", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("home greeting, project section, search, card opens terminal modal, home returns", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-gharargah-home]")
      await expectSelectorVisible(page, "[data-gharargah-shell='home']")
      await expectLocatorCount(page.locator("[data-gharargah-home-metrics]"), 0)
      await expectLocatorCount(page.locator("[data-gharargah-home-new-agent]"), 0)
      await expectLocatorCount(page.getByRole("button", { name: "New agent" }), 0)
      await expectLocatorContainsText(page.locator("[data-gharargah-home]"), /Here.?s what.?s running today/)
      await expect
        .poll(async () => {
          return page.locator("[data-gharargah-home] > div").evaluate(el => {
            const width = el.getBoundingClientRect().width
            return width / window.innerWidth
          })
        })
        .toBeGreaterThan(0.95)
      await expectLocatorContainsText(page.locator("[data-gharargah-home]"), /Good (morning|afternoon|evening)/)

      const state = await page.evaluate(() => window.__gharargahAgent!.getState())
      expect(state.shellView).toBe("home")
      const workspaceName = state.workspaces[0]?.name ?? "sample-workspace"
      const sectionSel = `[data-gharargah-project-section][data-gharargah-project-name="${workspaceName}"]`

      const section = page.locator(sectionSel)
      await expectLocatorVisible(section)

      await section.getByRole("button", { name: "New session" }).click()
      const sessionMenu = page.locator('[data-slot="dropdown-menu-content"]')
      await expectLocatorVisible(sessionMenu)
      await expectLocatorVisible(sessionMenu.getByRole("menuitem", { name: "Terminal" }))
      await expectLocatorVisible(sessionMenu.getByRole("menuitem", { name: "Codex" }))
      await expectLocatorVisible(sessionMenu.getByRole("menuitem", { name: "Claude" }))
      await expectLocatorVisible(sessionMenu.getByRole("menuitem", { name: "Cursor Agent" }))
      await sessionMenu.locator('[data-slot="dropdown-menu-item"]', { hasText: "Terminal" }).click()
      await expect
        .poll(async () => page.evaluate(() => window.__gharargahAgent?.getState()?.shellView ?? null), {
          timeout: 20_000,
        })
        .toBe("home")
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", { timeout: 20_000 })
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]", { timeout: 20_000 })
      await expectSelectorVisible(page, "[data-gharargah-home]")
      const afterNew = await page.evaluate(() => window.__gharargahAgent!.getState())
      expect(afterNew.activeWorkspace).toBeTruthy()

      await page.keyboard.press("Escape")
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0)
      await expectSelectorVisible(page, "[data-gharargah-home]")

      // Open-in-app dropdown beside New session on the project row.
      await section.getByRole("button", { name: "Open project in external app" }).click()
      const openInAppMenu = page.locator("[data-gharargah-open-in-app-menu]")
      await expectLocatorVisible(openInAppMenu)
      for (const label of [
        "VS Code",
        "Cursor",
        "Emacs",
        "Sublime Text",
        "Zed",
        "Finder",
        "Terminal",
        "Kitty",
        "Ghostty",
        "Xcode",
        "IntelliJ IDEA",
      ]) {
        await expectLocatorVisible(openInAppMenu.getByRole("menuitem", { name: label }))
      }
      // Stub host so selecting an item closes the menu without launching apps.
      await page.evaluate(() => {
        const api = window.gharargah
        if (!api) return
        api.shell = {
          openInApp: async () => ({ ok: true }),
        }
      })
      await openInAppMenu.getByRole("menuitem", { name: "VS Code" }).click()
      await expect.poll(async () => openInAppMenu.isVisible(), { timeout: 10_000 }).toBe(false)

      const cards = section.locator("[data-gharargah-terminal-card]:not([data-gharargah-new-session])")
      await expectLocatorVisible(cards.first())
      await expectLocatorVisible(cards.first().locator("[data-gharargah-status-badge]"))
      await expectLocatorContainsText(cards.first().locator("[data-gharargah-status-badge]"), /Running|Idle|Failed/)
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
        .toBe("home")
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]")

      await execCommand(page, "gharargah.goHome")
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0)
      await expectSelectorVisible(page, "[data-gharargah-home]")
      const afterHome = await page.evaluate(() => window.__gharargahAgent!.getState())
      expect(afterHome.shellView).toBe("home")
    } finally {
      await app.close()
    }
  })

  test("project and terminal card context menus, modal close, git branch, Cmd+p terminal list", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-gharargah-home]")
      const workspaceName = await page.evaluate(
        () => window.__gharargahAgent!.listWorkspaces()[0]?.name ?? "sample-workspace",
      )
      const section = page.locator(
        `[data-gharargah-project-section][data-gharargah-project-name="${workspaceName}"]`,
      )
      await expectLocatorVisible(section)

      await section.locator("h2").click({ button: "right" })
      const projectMenu = page.locator("[data-gharargah-project-menu]")
      await expectLocatorVisible(projectMenu)
      await expectLocatorVisible(projectMenu.getByRole("menuitem", { name: "Remove Project" }))
      await page.keyboard.press("Escape")
      // Menu may linger in the portal tree; move on via New session.

      await section.getByRole("button", { name: "New session" }).click()
      const sessionMenu = page.locator('[data-slot="dropdown-menu-content"]')
      await expectLocatorVisible(sessionMenu)
      await sessionMenu.locator('[data-slot="dropdown-menu-item"]', { hasText: "Terminal" }).click()
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", { timeout: 20_000 })
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal-close]")
      await expect
        .poll(async () => {
          return page.locator("[data-gharargah-terminal-modal]").evaluate(el => {
            const rect = el.getBoundingClientRect()
            const fullW = Math.abs(rect.width - window.innerWidth) < 2
            const fullH = Math.abs(rect.height - window.innerHeight) < 2
            return fullW && fullH
          })
        }, { timeout: 10_000 })
        .toBe(true)
      await expectSelectorVisible(page, "[data-gharargah-session-mode-switch]")
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal-sessions]"), 0)
      await expectLocatorCount(page.locator("[data-gharargah-session-mode-tab]"), 3)
      await expect
        .poll(async () => page.evaluate(() =>
          [...document.querySelectorAll("[data-gharargah-session-mode-tab]")]
            .map(tab => tab.textContent?.trim() ?? ""),
        ))
        .toEqual(["Terminal", "Editor", "Git"])
      await expectSelectorVisible(page, '[data-gharargah-session-mode-tab="terminal"][data-active]')
      await expectSelectorVisible(page, '[data-gharargah-session-mode-tab="editor"]')
      await expectSelectorVisible(page, '[data-gharargah-session-mode-tab="git"]')
      await expectLocatorCount(page.locator('[data-gharargah-session-pane="terminal"][data-active]'), 1)
      await expectSelectorVisible(page, "[data-gharargah-terminal-panel]")
      await expect
        .poll(async () => page.locator("[data-gharargah-terminal-git-branch]").textContent(), {
          timeout: 15_000,
        })
        .toMatch(/main/)

      // Git is a full workspace mode and intentionally keeps the modal to three modes only.
      await page.evaluate(() => {
        const api = window.gharargah
        if (!api) return
        ;(window as typeof window & { __gitActions?: string[] }).__gitActions = []
        const record = (value: string) => {
          ;(window as typeof window & { __gitActions?: string[] }).__gitActions?.push(value)
        }
        api.git = {
          isRepo: async () => true,
          status: async () => [
            { path: "src/index.ts", status: "modified", staged: false, unstaged: true },
            { path: "README.md", status: "added", staged: true, unstaged: false },
          ],
          diff: async (_root, opts) => opts?.staged
            ? "diff --git a/README.md b/README.md\nnew file mode 100644\n--- /dev/null\n+++ b/README.md\n@@ -0,0 +1 @@\n+# Sample repository\n"
            : "diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-export const value = 1\n+export const value = 2\n",
          branch: async () => "main",
          summary: async () => ({ branch: "main", upstream: "origin/main", ahead: 2, behind: 1 }),
          branches: async () => ["main", "feature/git-workspace"],
          stage: async (_root, paths) => record(`stage:${paths.join(",")}`),
          unstage: async (_root, paths) => record(`unstage:${paths.join(",")}`),
          discard: async (_root, paths) => record(`discard:${paths.join(",")}`),
          commit: async (_root, summary) => record(`commit:${summary}`),
          checkout: async (_root, branch) => record(`checkout:${branch}`),
          fetch: async () => record("fetch"),
          pull: async () => record("pull"),
          push: async () => record("push"),
          history: async () => [
            { hash: "abc123456789", shortHash: "abc1234", author: "Jet", authoredAt: Date.now(), subject: "Add Git workspace" },
            { hash: "def123456789", shortHash: "def1234", author: "Jet", authoredAt: Date.now() - 60_000, subject: "Restore editor" },
          ],
        }
      })
      await page.locator('[data-gharargah-session-mode-tab="git"]').click()
      await expectSelectorVisible(page, "[data-gharargah-git-workspace]", { timeout: 20_000 })
      await expectSelectorVisible(page, "[data-gharargah-session-pane=git]:not([hidden])")
      await expectListRows(page, {
        panel: "git-files",
        minItems: 2,
        needle: "src/index.ts",
        noResultsText: "No matching changes",
      })
      await expectLocatorVisible(page.locator("[data-gharargah-git-diff]"))
      await page.getByLabel("Filter changed files").fill("README")
      await expectListRows(page, {
        panel: "git-files",
        minItems: 1,
        needle: "README.md",
        noResultsText: "No matching changes",
      })
      await page.getByLabel("Filter changed files").fill("")
      await page.getByRole("checkbox", { name: "Stage src/index.ts" }).click()
      await expect
        .poll(async () => page.evaluate(() =>
          (window as typeof window & { __gitActions?: string[] }).__gitActions ?? [],
        ))
        .toContain("stage:src/index.ts")
      await page.locator("#git-commit-summary").fill("Test Git workspace")
      await page.locator("[data-gharargah-git-commit]").click()
      await expect
        .poll(async () => page.evaluate(() =>
          (window as typeof window & { __gitActions?: string[] }).__gitActions ?? [],
        ))
        .toContain("commit:Test Git workspace")
      await page.getByRole("tab", { name: /History/ }).click()
      await expectListRows(page, {
        panel: "git-history",
        minItems: 2,
        needle: "Add Git workspace",
      })
      await page.locator('[data-gharargah-session-mode-tab="editor"]').click()
      await expectSelectorVisible(page, "[data-gharargah-modal-editor]")
      await expectLocatorCount(page.locator("[data-gharargah-session-mode-tab]"), 3)

      // Open-in-app control in the fullscreen terminal modal header.
      await page.evaluate(() => {
        const api = window.gharargah
        if (!api) return
        api.shell = {
          openInApp: async () => ({ ok: true }),
        }
      })
      await page.locator('[data-gharargah-open-in-app="modal"]').click()
      const modalOpenMenu = page.locator("[data-gharargah-open-in-app-menu]")
      await expectLocatorVisible(modalOpenMenu)
      await expectLocatorVisible(modalOpenMenu.getByRole("menuitem", { name: "VS Code" }))
      await expectLocatorVisible(modalOpenMenu.getByRole("menuitem", { name: "Cursor" }))
      await modalOpenMenu.getByRole("menuitem", { name: "Cursor" }).click()
      await expect.poll(async () => modalOpenMenu.isVisible(), { timeout: 10_000 }).toBe(false)

      await page.locator("[data-gharargah-terminal-modal-close]").click()
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0)

      const cards = section.locator("[data-gharargah-terminal-card]:not([data-gharargah-new-session])")
      await expectLocatorVisible(cards.first())
      await cards.first().click({ button: "right" })
      const cardMenu = page.locator("[data-gharargah-terminal-card-menu]")
      await expectLocatorVisible(cardMenu)
      await cardMenu.getByRole("menuitem", { name: "Kill Terminal" }).click()
      await expect
        .poll(async () => cards.count(), { timeout: 10_000 })
        .toBe(0)
      await expectLocatorVisible(section.locator("[data-gharargah-new-session]"))

      await execCommand(page, "terminal.new")
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", { timeout: 20_000 })
      await page.keyboard.press("Escape")
      await expectLocatorCount(page.locator("[data-gharargah-terminal-modal]"), 0)

      await page.keyboard.press("Meta+p")
      await expectListRows(page, {
        panel: "gharargah:palette",
        minItems: 1,
        needle: `${workspaceName}:`,
        noResultsText: "No open terminals",
      })
    } finally {
      await app.close()
    }
  })

  test("home has no custom titlebar chrome", async () => {
    const { app, page } = await launchJet()
    try {
      await expectSelectorVisible(page, "[data-gharargah-home]")
      await expectLocatorCount(page.locator("[data-gharargah-titlebar]"), 0)
      await expectLocatorCount(page.locator("[data-gharargah-home-button]"), 0)
      await expectLocatorCount(page.locator("[data-gharargah-status-zone]"), 0)
    } finally {
      await app.close()
    }
  })
})
