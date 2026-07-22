import { expect, test } from "@playwright/test"
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import type { ShellDriver } from "../shell/driver.js"

import {
  expectLocatorContainsText,
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import { expectListRows } from "../helpers/list.js"
import { execCommand, hasPtySpawn, launchJet, REPO_ROOT, SAMPLE } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

test.describe("session Git and editor workspaces", () => {
  test.skip(!ptyAvailable, "PTY support is required to open a session workspace")

  test("Git stages the selected preview, stages all, and keeps every portal interaction inside the session", async () => {
    const fixture = createGitFixture()
    const { app, page } = await launchJet(fixture.workspace)
    try {
      await openSessionMode(page, "git")
      await expectListRows(page, {
        panel: "git-files",
        minItems: 5,
        needle: "src/index.ts",
        noResultsText: "No matching changes",
      })
      const indexRow = page.locator('[data-gharargah-git-file="src/index.ts"]').first()
      await indexRow.locator("button").nth(1).click()
      await expectLocatorContainsText(page.locator("[data-gharargah-git-diff]"), "src/index.ts")
      await page.getByRole("button", { name: "Stage file" }).click()
      await expectLocatorVisible(page.getByRole("button", { name: "Unstage file" }), { timeout: 20_000 })
      await expectLocatorContainsText(page.locator("[data-gharargah-git-diff]"), "src/index.ts")
      expect(git(fixture.workspace, "diff", "--cached", "--name-only", "src/index.ts")).toBe("src/index.ts")
      expect(git(fixture.workspace, "diff", "--name-only", "src/index.ts")).toBe("")

      await page.getByRole("button", { name: "Unstage file" }).click()
      await expectLocatorVisible(page.getByRole("button", { name: "Stage file" }), { timeout: 20_000 })
      await expectLocatorContainsText(page.locator("[data-gharargah-git-diff]"), "src/index.ts")
      expect(git(fixture.workspace, "diff", "--cached", "--name-only", "src/index.ts")).toBe("")
      expect(git(fixture.workspace, "diff", "--name-only", "src/index.ts")).toBe("src/index.ts")

      // Menus and confirmations are portaled outside the parent Dialog. They must not close it.
      const discardRow = page.locator('[data-gharargah-git-file="src/config.go"]').first()
      await discardRow.locator("button").nth(1).click()
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")
      await page.getByRole("button", { name: "Discard file" }).click()
      await expectLocatorVisible(page.getByRole("alertdialog"))
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")
      await page.locator('[data-gharargah-confirm="cancel"]').click()
      await expectLocatorVisible(page.locator('[data-gharargah-git-file="src/config.go"]'))
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")
      expect(git(fixture.workspace, "status", "--short", "src/config.go")).toContain("src/config.go")

      const stageAll = page.locator("[data-gharargah-git-stage-all]")
      await expectLocatorVisible(stageAll)
      await stageAll.click()
      await expect.poll(() => stageAll.evaluate(el => (el as HTMLButtonElement).disabled), { timeout: 20_000 }).toBe(true)
      expect(git(fixture.workspace, "diff", "--name-only")).toBe("")
      expect(git(fixture.workspace, "diff", "--cached", "--name-only")).toContain("src/index.ts")
      expect(git(fixture.workspace, "diff", "--cached", "--name-only")).toContain("notes.txt")

      await page.getByLabel("Filter changed files").fill("index")
      await expectListRows(page, {
        panel: "git-files",
        minItems: 1,
        needle: "src/index.ts",
        noResultsText: "No matching changes",
      })
      await page.getByLabel("Filter changed files").fill("__no_such_changed_file__")
      await expectLocatorContainsText(page.locator('[data-gharargah-list-panel="git-files"]'), "No matching changes")
      await expectLocatorCount(page.locator('[data-gharargah-list-panel="git-files"] [data-gharargah-list-item]'), 0)
      await page.getByLabel("Filter changed files").fill("")

      await page.getByRole("tab", { name: /Staged/ }).click()
      await expectListRows(page, {
        panel: "git-files",
        minItems: 4,
        needle: "README.md",
        noResultsText: "No matching changes",
      })
      await page.getByRole("checkbox", { name: "Unstage README.md" }).click()
      await expect.poll(() => git(fixture.workspace, "diff", "--name-only", "README.md"), { timeout: 20_000 }).toBe("README.md")
      await page.getByRole("tab", { name: "Changes" }).click()
      const restageAll = page.locator("[data-gharargah-git-stage-all]")
      await expect.poll(() => restageAll.evaluate(el => !(el as HTMLButtonElement).disabled), { timeout: 20_000 }).toBe(true)
      await restageAll.click()
      await expect.poll(() => git(fixture.workspace, "diff", "--name-only"), { timeout: 20_000 }).toBe("")

      await page.getByRole("button", { name: "split" }).click()
      await expect.poll(() => page.getByRole("button", { name: "split" }).getAttribute("aria-pressed")).toBe("true")

      await selectBranch(page, "feature/git-workspace")
      await expect.poll(() => git(fixture.workspace, "branch", "--show-current"), { timeout: 20_000 }).toBe("feature/git-workspace")
      await selectBranch(page, "main")
      await expect.poll(() => git(fixture.workspace, "branch", "--show-current"), { timeout: 20_000 }).toBe("main")

      const fetch = page.getByRole("button", { name: "Fetch" })
      await fetch.click()
      await expect.poll(() => fetch.evaluate(el => !(el as HTMLButtonElement).disabled), { timeout: 20_000 }).toBe(true)
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")

      await page.locator("#git-commit-summary").fill("Cover Git workspace")
      await page.locator("#git-commit-body").fill("Exercise staging, history, branch, and remote actions.")
      const commitButton = page.locator("[data-gharargah-git-commit]")
      await expect.poll(() => commitButton.evaluate(el => !(el as HTMLButtonElement).disabled), { timeout: 20_000 }).toBe(true)
      await expect.poll(async () => {
        if (git(fixture.workspace, "status", "--short") === "") return true
        await commitButton.evaluate(element => {
          const button = element as HTMLButtonElement
          if (!button.disabled) button.form?.requestSubmit(button)
        })
        return false
      }, { timeout: 20_000 }).toBe(true)
      expect(git(fixture.workspace, "log", "-1", "--pretty=%s%n%b")).toContain("Cover Git workspace")

      const pull = page.getByRole("button", { name: "Pull" })
      await pull.click()
      await expect.poll(() => pull.evaluate(el => !(el as HTMLButtonElement).disabled), { timeout: 20_000 }).toBe(true)

      const push = page.getByRole("button", { name: "Push" })
      await push.click()
      await expect.poll(() => push.evaluate(el => !(el as HTMLButtonElement).disabled), { timeout: 20_000 }).toBe(true)
      expect(git(fixture.workspace, "rev-parse", "main")).toBe(git(fixture.workspace, "rev-parse", "origin/main"))

      await page.getByRole("tab", { name: /History/ }).click()
      await expectListRows(page, {
        panel: "git-history",
        minItems: 2,
        needle: "Cover Git workspace",
      })
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")
      await expectLocatorCount(page.locator("[data-gharargah-session-mode-tab]"), 3)
    } finally {
      await app.close()
      fixture.remove()
    }
  })

  test("multi-root Quick Open, saving, buffer navigation, and nested overlays keep the editor session open", async () => {
    const fixture = createGitFixture()
    const { app, page } = await launchJet(fixture.workspace)
    try {
      await page.evaluate(async ({ primary, secondary }) => {
        await window.__gharargahAgent!.addWorkspace(secondary)
        await window.__gharargahAgent!.openWorkspace(primary)
      }, { primary: fixture.workspace, secondary: fixture.secondWorkspace })
      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.listWorkspaces().length))
        .toBe(2)
      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.getState().activeWorkspace))
        .toBe(fixture.workspace)

      await execCommand(page, "terminal.new")
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", { timeout: 20_000 })
      await page.locator('[data-gharargah-session-mode-tab="editor"]').click()
      await expectSelectorVisible(page, "[data-gharargah-modal-editor]")
      await expect.poll(async () => page.locator("[data-gharargah-session-mode-tab]").evaluate(el => el.parentElement?.textContent ?? ""))
        .toContain("TerminalEditorGit")

      await openQuickFile(page, "index", "src/index.ts")
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")
      await expectSelectorVisible(page, '[data-gharargah-session-mode-tab="editor"][data-active]')
      await expectSelectorVisible(page, ".cm-editor", { timeout: 20_000 })
      await expectLocatorContainsText(page.locator("[data-gharargah-modal-editor-tabs]"), "index.ts")
      await expectLocatorContainsText(page.locator("[data-gharargah-modal-editor-breadcrumbs]"), "src/index.ts")
      const marker = "// editor-playwright-save"
      const editor = page.locator(".cm-content")
      await editor.focus()
      await editor.evaluate((element, text) => {
        ;(element as HTMLElement).focus()
        const selection = window.getSelection()
        const range = document.createRange()
        range.selectNodeContents(element)
        range.collapse(false)
        selection?.removeAllRanges()
        selection?.addRange(range)
        document.execCommand("insertText", false, `\n${text}`)
      }, marker)
      await expectSelectorVisible(page, "[data-gharargah-buffer-dirty]")
      await expectLocatorContainsText(page.locator("[data-gharargah-modal-editor-status]"), "dirty")
      await execCommand(page, "workspace.saveFile")
      await expect.poll(() => readFileSync(join(fixture.workspace, "src/index.ts"), "utf8"), { timeout: 20_000 }).toContain(marker)
      await expectLocatorCount(page.locator("[data-gharargah-buffer-dirty]"), 0, { timeout: 20_000 })

      await openQuickFile(page, "utils", "src/utils.ts")
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")
      await expectLocatorCount(page.locator("[data-gharargah-modal-editor-tab]"), 2)
      await expectLocatorContainsText(page.locator("[data-gharargah-modal-editor-tab][data-active]"), "utils.ts")

      const activeBuffer = page.locator('[data-gharargah-modal-editor-tab][data-active] button[role="tab"]')
      await activeBuffer.focus()
      await activeBuffer.press("ArrowLeft")
      await expectLocatorContainsText(page.locator("[data-gharargah-modal-editor-tab][data-active]"), "index.ts")
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")
      await page.getByRole("button", { name: "Close utils.ts" }).click()
      await expectLocatorCount(page.locator("[data-gharargah-modal-editor-tab]"), 1, { timeout: 20_000 })

      // A nested command palette may dismiss itself; it must never dismiss the session behind it.
      await page.getByRole("button", { name: "Commands" }).click()
      await expectSelectorVisible(page, "[data-gharargah-palette]")
      await page.keyboard.press("Escape")
      await expectLocatorCount(page.locator("[data-gharargah-palette]"), 0, { timeout: 20_000 })
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")

      await editor.focus()
      await editor.evaluate(element => {
        ;(element as HTMLElement).focus()
        document.execCommand("insertText", false, "x")
      })
      await expectSelectorVisible(page, "[data-gharargah-buffer-dirty]")
      await page.getByRole("button", { name: "Close index.ts" }).click()
      await expectLocatorVisible(page.getByRole("alertdialog"))
      await page.locator('[data-gharargah-confirm="cancel"]').click()
      await expectLocatorCount(page.locator('[role="alertdialog"][data-state="open"]'), 0, { timeout: 20_000 })
      await expectLocatorCount(page.locator("[data-gharargah-modal-editor-tab]"), 1)
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]")

      const editorMode = page.locator('[data-gharargah-session-mode-tab="editor"]')
      await editorMode.focus()
      await editorMode.press("ArrowRight")
      await expectSelectorVisible(page, '[data-gharargah-session-mode-tab="git"][data-active]')
      await page.locator('[data-gharargah-session-mode-tab="editor"]').click()
      await expectSelectorVisible(page, '[data-gharargah-session-mode-tab="editor"][data-active]')
      await expectLocatorCount(page.locator("[data-gharargah-session-mode-tab]"), 3)
      await expectLocatorCount(page.locator("[data-gharargah-workspace-sidebar]"), 0)
    } finally {
      await app.close()
      fixture.remove()
    }
  })
})

type GitFixture = {
  workspace: string
  secondWorkspace: string
  remove: () => void
}

function createGitFixture(): GitFixture {
  const root = mkdtempSync(join(tmpdir(), "gharargah-git-editor-e2e-"))
  const workspace = join(root, "workspace")
  const secondWorkspace = join(root, "other-workspace")
  const remote = join(root, "origin.git")
  cpSync(join(REPO_ROOT, SAMPLE), workspace, { recursive: true })
  mkdirSync(secondWorkspace)
  writeFileSync(join(secondWorkspace, "other.ts"), "export const other = true\n")
  rmSync(join(workspace, ".git"), { recursive: true, force: true })

  git(workspace, "init", "-b", "main")
  git(workspace, "config", "user.name", "Gharargah E2E")
  git(workspace, "config", "user.email", "gharargah-e2e@example.com")
  writeFileSync(join(workspace, "README.md"), "# Gharargah E2E\n")
  git(workspace, "add", ".")
  git(workspace, "commit", "-m", "Initial fixture")
  execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" })
  git(workspace, "remote", "add", "origin", remote)
  git(workspace, "push", "-u", "origin", "main")
  git(workspace, "branch", "feature/git-workspace")

  appendFileSync(join(workspace, "src/index.ts"), "\n// previewed working change\n")
  appendFileSync(join(workspace, "README.md"), "\nStaged documentation.\n")
  git(workspace, "add", "README.md")
  writeFileSync(join(workspace, "notes.txt"), "Untracked notes\n")
  appendFileSync(join(workspace, "src/utils.ts"), "\n// staged portion\n")
  git(workspace, "add", "src/utils.ts")
  appendFileSync(join(workspace, "src/utils.ts"), "// unstaged portion\n")
  appendFileSync(join(workspace, "src/config.go"), "\n// discard this change\n")

  return {
    workspace,
    secondWorkspace,
    remove: () => rmSync(root, { recursive: true, force: true }),
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim()
}

async function openSessionMode(page: ShellDriver, mode: "terminal" | "editor" | "git") {
  await execCommand(page, "terminal.new")
  await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", { timeout: 20_000 })
  await page.locator(`[data-gharargah-session-mode-tab="${mode}"]`).click()
  await expectSelectorVisible(page, `[data-gharargah-session-mode-tab="${mode}"][data-active]`)
  await expectLocatorCount(page.locator("[data-gharargah-session-mode-tab]"), 3)
  await expectLocatorCount(page.locator("[data-gharargah-workspace-sidebar]"), 0)
  if (mode === "git") await expectSelectorVisible(page, "[data-gharargah-git-workspace]", { timeout: 20_000 })
}

async function openQuickFile(
  page: ShellDriver,
  query: string,
  expectedPath: string,
) {
  await page.getByRole("button", { name: "Quick Open" }).click()
  await expectSelectorVisible(page, "[data-gharargah-palette]")
  const input = page.locator("[data-gharargah-palette] input")
  await input.fill(query)
  await expectListRows(page, {
    panel: "gharargah:palette",
    minItems: 1,
    needle: expectedPath,
    noResultsText: "No matching files.",
  })
  await page.getByRole("option").filter({ hasText: expectedPath }).first().click()
  await expectLocatorCount(page.locator("[data-gharargah-palette]"), 0, { timeout: 20_000 })
}

async function selectBranch(
  page: ShellDriver,
  branch: string,
) {
  await page.locator("#git-branch").evaluate((element, value) => {
    const select = element as HTMLSelectElement
    select.value = value
    select.dispatchEvent(new Event("change", { bubbles: true }))
  }, branch)
  await expect.poll(() => page.locator("#git-branch").evaluate(el => (el as HTMLSelectElement).value), { timeout: 20_000 }).toBe(branch)
}
