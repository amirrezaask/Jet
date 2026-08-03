import { expect, test } from "@playwright/test"
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
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
      const repositoryToolbar = page.locator("[data-yaade-git-toolbar]")
      const sessionHeader = page.locator("[data-yaade-terminal-modal-header]")
      const session = page.locator("[data-yaade-terminal-modal]")
      await expect
        .poll(async () =>
          (await session.locator("[data-yaade-terminal-modal-title]").textContent())?.trim() ?? "",
        )
        .toBe("workspace / Git")
      await expectLocatorCount(repositoryToolbar.getByText("workspace", { exact: true }), 0)
      await expectLocatorCount(repositoryToolbar.getByText("main", { exact: true }), 0)
      await expectLocatorCount(repositoryToolbar.getByText(/^Commit \d+$/), 0)
      await expectLocatorVisible(
        sessionHeader.getByRole("button", {
          name: "Switch branch, current branch main",
        }),
      )
      await expectLocatorCount(repositoryToolbar.getByRole("button"), 3)
      await expectLocatorVisible(repositoryToolbar.getByRole("button", { name: "Refresh Git" }))
      await expectLocatorVisible(repositoryToolbar.getByRole("tab", { name: "Changes", exact: true }))
      await expectLocatorVisible(repositoryToolbar.getByRole("tab", { name: "History", exact: true }))
      await expectSelectorVisible(page, "[data-yaade-session-mode-dock]")
      await expectLocatorCount(page.locator("[data-yaade-git-commit-form]"), 0)
      await expect
        .poll(async () => {
          const workspace = await page.locator("[data-yaade-git-workspace]").boundingBox()
          const content = await page.locator("[data-yaade-git-content]").boundingBox()
          if (!workspace || !content) return Number.POSITIVE_INFINITY
          return Math.abs(workspace.y + workspace.height - (content.y + content.height))
        })
        .toBeLessThanOrEqual(1)
      const repositoryActions = repositoryToolbar.getByRole("button", { name: "Repository actions" })
      await repositoryActions.focus()
      await repositoryActions.press("Enter")
      await expectLocatorVisible(page.getByRole("menuitem", { name: "Fetch from remote" }))
      await expectLocatorVisible(page.getByRole("menuitem", { name: "Pull from remote" }))
      await expectLocatorVisible(page.getByRole("menuitem", { name: "Push to remote" }))
      await page.keyboard.press("Escape")
      await expect.poll(() => repositoryActions.evaluate(element => element === document.activeElement)).toBe(true)

      const indexRow = page.locator('[data-yaade-git-file="src/index.ts"]').first()
      await indexRow.locator("button").nth(1).click()
      await expectLocatorContainsText(page.locator("[data-yaade-git-diff]"), "src/index.ts")
      const diffToolbar = page.locator("[data-yaade-git-diff-toolbar]")
      await expectLocatorCount(diffToolbar.getByRole("button"), 2)
      await expectLocatorVisible(diffToolbar.getByRole("button", { name: "Stage file" }))
      await page.getByRole("button", { name: "Stage file" }).click()
      await expectLocatorVisible(page.getByRole("button", { name: "Unstage file" }), { timeout: 20_000 })
      await expectLocatorContainsText(page.locator("[data-yaade-git-diff]"), "src/index.ts")
      expect(git(fixture.workspace, "diff", "--cached", "--name-only", "src/index.ts")).toBe("src/index.ts")
      expect(git(fixture.workspace, "diff", "--name-only", "src/index.ts")).toBe("")

      await page.getByRole("button", { name: "Unstage file" }).click()
      await expectLocatorVisible(page.getByRole("button", { name: "Stage file" }), { timeout: 20_000 })
      await expectLocatorContainsText(page.locator("[data-yaade-git-diff]"), "src/index.ts")
      expect(git(fixture.workspace, "diff", "--cached", "--name-only", "src/index.ts")).toBe("")
      expect(git(fixture.workspace, "diff", "--name-only", "src/index.ts")).toBe("src/index.ts")

      const changedFiles = page.locator('[data-yaade-list-panel="git-files"]')
      await changedFiles.focus()
      await changedFiles.press("Space")
      await expectLocatorVisible(page.getByRole("button", { name: "Unstage file" }), { timeout: 20_000 })
      await changedFiles.press("Space")
      await expectLocatorVisible(page.getByRole("button", { name: "Stage file" }), { timeout: 20_000 })

      // Menus and confirmations are portaled outside the parent Dialog. They must not close it.
      const discardRow = page.locator('[data-yaade-git-file="src/config.go"]').first()
      await discardRow.locator("button").nth(1).click()
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]")
      await page.getByRole("button", { name: "Diff actions for src/config.go" }).click()
      await page.getByRole("menuitem", { name: "Discard changes" }).click()
      await expectLocatorVisible(page.getByRole("alertdialog"))
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]")
      await page.locator('[data-yaade-confirm="cancel"]').click()
      await expectLocatorVisible(page.locator('[data-yaade-git-file="src/config.go"]'))
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]")
      expect(git(fixture.workspace, "status", "--short", "src/config.go")).toContain("src/config.go")

      const stageAll = page.locator("[data-yaade-git-stage-all]")
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
      await expectLocatorContainsText(page.locator('[data-yaade-list-panel="git-files"]'), "No matching changes")
      await expectLocatorCount(page.locator('[data-yaade-list-panel="git-files"] [data-yaade-list-item]'), 0)
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
      const restageAll = page.locator("[data-yaade-git-stage-all]")
      await expect.poll(() => restageAll.evaluate(el => !(el as HTMLButtonElement).disabled), { timeout: 20_000 }).toBe(true)
      await restageAll.click()
      await expect.poll(() => git(fixture.workspace, "diff", "--name-only"), { timeout: 20_000 }).toBe("")

      const diffActions = page.getByRole("button", { name: /Diff actions for/ })
      await diffActions.click()
      const splitDiff = page.getByRole("menuitemradio", { name: "Split" })
      await expectLocatorVisible(splitDiff)
      await splitDiff.click()
      await diffActions.click()
      await expect.poll(() => page.getByRole("menuitemradio", { name: "Split" }).getAttribute("aria-checked")).toBe("true")
      await page.keyboard.press("Escape")
      await expect.poll(() => diffActions.evaluate(element => element === document.activeElement)).toBe(true)

      await selectBranch(page, "feature/git-workspace")
      await expect.poll(() => git(fixture.workspace, "branch", "--show-current"), { timeout: 20_000 }).toBe("feature/git-workspace")
      await selectBranch(page, "main")
      await expect.poll(() => git(fixture.workspace, "branch", "--show-current"), { timeout: 20_000 }).toBe("main")

      await repositoryActions.click()
      await page.getByRole("menuitem", { name: "Fetch from remote" }).click()
      await expect.poll(() => repositoryActions.evaluate(el => !(el as HTMLButtonElement).disabled), { timeout: 20_000 }).toBe(true)
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]")

      const commitTrigger = repositoryToolbar.locator("[data-yaade-git-commit-trigger]")
      await expect.poll(() => commitTrigger.evaluate(el => !(el as HTMLButtonElement).disabled), { timeout: 20_000 }).toBe(true)
      await commitTrigger.click()
      await expectLocatorVisible(page.locator("[data-yaade-git-commit-dialog]"))
      await expect.poll(() => page.locator("#git-commit-summary").evaluate(element => element === document.activeElement)).toBe(true)
      await page.locator("#git-commit-summary").fill("Cover Git workspace")
      await page.locator("#git-commit-body").fill("Exercise staging, history, branch, and remote actions.")
      await page.getByRole("button", { name: "Cancel" }).click()
      await expectLocatorCount(page.locator("[data-yaade-git-commit-dialog]"), 0)
      await expect.poll(() => commitTrigger.evaluate(element => element === document.activeElement)).toBe(true)
      await commitTrigger.press("Enter")
      await expect.poll(() => page.locator("#git-commit-summary").inputValue()).toBe("Cover Git workspace")
      const commitButton = page.locator("[data-yaade-git-commit]")
      await expect.poll(() => commitButton.evaluate(el => !el.hasAttribute("disabled") && (el).getAttribute("aria-disabled") !== "true"), { timeout: 20_000 }).toBe(true)
      await page.locator("#git-commit-summary").press("Enter")
      await expect.poll(() => git(fixture.workspace, "status", "--short"), { timeout: 20_000 }).toBe("")
      await expectLocatorCount(page.locator("[data-yaade-git-commit-dialog]"), 0)
      expect(git(fixture.workspace, "log", "-1", "--pretty=%s%n%b")).toContain("Cover Git workspace")

      await repositoryActions.click()
      await page.getByRole("menuitem", { name: "Pull from remote" }).click()
      await expect.poll(() => repositoryActions.evaluate(el => !(el as HTMLButtonElement).disabled), { timeout: 20_000 }).toBe(true)

      await repositoryActions.click()
      await page.getByRole("menuitem", { name: "Push to remote" }).click()
      await expect.poll(() => repositoryActions.evaluate(el => !(el as HTMLButtonElement).disabled), { timeout: 20_000 }).toBe(true)
      expect(git(fixture.workspace, "rev-parse", "main")).toBe(git(fixture.workspace, "rev-parse", "origin/main"))

      await page.getByRole("tab", { name: /History/ }).click()
      await expectListRows(page, {
        panel: "git-history",
        minItems: 2,
        needle: "Cover Git workspace",
      })
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]")
      await expectLocatorCount(page.locator("[data-yaade-session-mode-tab]"), 4)
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
        await window.__yaadeAgent!.addWorkspace(secondary)
        await window.__yaadeAgent!.openWorkspace(primary)
      }, { primary: fixture.workspace, secondary: fixture.secondWorkspace })
      await expect
        .poll(() => page.evaluate(() => window.__yaadeAgent!.listWorkspaces().length))
        .toBe(2)
      await expect
        .poll(async () => {
          const active = await page.evaluate(() => window.__yaadeAgent!.getState().activeWorkspace)
          return active ? realpathSync(active) : null
        })
        .toBe(realpathSync(fixture.workspace))

      await execCommand(page, "terminal.new")
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]", { timeout: 20_000 })
      await page.locator('[data-yaade-session-mode-tab="editor"]').click()
      await expectSelectorVisible(page, "[data-yaade-modal-editor]")
      await expect.poll(async () => page.evaluate(() =>
        [...document.querySelectorAll("[data-yaade-session-mode-tab]")]
          .map(tab => tab.getAttribute("aria-label") ?? "")
          .join(""),
      )).toContain("AgentEditorGitTerminal")

      await openQuickFile(page, "index", "src/index.ts")
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]")
      await expectSelectorVisible(page, '[data-yaade-session-mode-tab="editor"][data-active]')
      await expectSelectorVisible(page, "[data-yaade-monaco-editor]", { timeout: 20_000 })
      await expectLocatorContainsText(
        page.locator(
          "[data-yaade-terminal-modal-header] [data-yaade-modal-editor-tabs]",
        ),
        "index.ts",
      )
      const marker = "// editor-playwright-save"
      const editor = page.locator("[data-yaade-monaco-editor] .monaco-editor")
      await editor.click()
      await page.keyboard.press("End")
      await page.keyboard.type(`\n${marker}`)
      await expectSelectorVisible(page, "[data-yaade-buffer-dirty]")
      await expect.poll(() =>
        page.getByRole("tab", { name: "index.ts, unsaved changes" }).getAttribute("data-dirty"),
      ).toBe("")
      await expectLocatorContainsText(page.locator("[data-yaade-modal-editor-status]"), "dirty")
      await execCommand(page, "workspace.saveFile")
      await expect.poll(() => readFileSync(join(fixture.workspace, "src/index.ts"), "utf8"), { timeout: 20_000 }).toContain(marker)
      await expectLocatorCount(page.locator("[data-yaade-buffer-dirty]"), 0, { timeout: 20_000 })
      await expect.poll(() =>
        page.getByRole("tab", { name: "index.ts", exact: true }).getAttribute("data-dirty"),
      ).toBeNull()

      await openQuickFile(page, "utils", "src/utils.ts")
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]")
      await expectLocatorCount(page.locator("[data-yaade-modal-editor-tab]"), 2)
      await expectLocatorContainsText(page.locator("[data-yaade-modal-editor-tab][data-active]"), "utils.ts")

      const activeBuffer = page.locator('[data-yaade-modal-editor-tab][data-active] button[role="tab"]')
      await activeBuffer.focus()
      await activeBuffer.press("ArrowLeft")
      await expectLocatorContainsText(page.locator("[data-yaade-modal-editor-tab][data-active]"), "index.ts")
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]")
      await page.getByRole("button", { name: "Close utils.ts" }).click()
      await expectLocatorCount(page.locator("[data-yaade-modal-editor-tab]"), 1, { timeout: 20_000 })

      // A nested command palette may dismiss itself; it must never dismiss the session behind it.
      await page.getByRole("button", { name: "Commands" }).click()
      await expectSelectorVisible(page, "[data-yaade-palette]")
      await page.keyboard.press("Escape")
      await expectLocatorCount(page.locator("[data-yaade-palette]"), 0, { timeout: 20_000 })
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]")

      await editor.click()
      await page.keyboard.press("End")
      await page.keyboard.type("x")
      await expectSelectorVisible(page, "[data-yaade-buffer-dirty]")
      await page.getByRole("button", { name: "Close index.ts" }).click()
      await expectLocatorVisible(page.getByRole("alertdialog"))
      await page.locator('[data-yaade-confirm="cancel"]').click()
      await expectLocatorCount(page.locator('[role="alertdialog"][data-state="open"]'), 0, { timeout: 20_000 })
      await expectLocatorCount(page.locator("[data-yaade-modal-editor-tab]"), 1)
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]")

      await page.locator('[data-yaade-session-mode-tab="git"]').click()
      await expectSelectorVisible(page, '[data-yaade-session-mode-tab="git"][data-active]')
      await page.locator('[data-yaade-session-mode-tab="editor"]').click()
      await expectSelectorVisible(page, '[data-yaade-session-mode-tab="editor"][data-active]')
      await expectLocatorCount(page.locator("[data-yaade-session-mode-tab]"), 4)
      await expectLocatorCount(page.locator("[data-yaade-workspace-sidebar]"), 0)
      await expectSelectorVisible(
        page,
        "[data-yaade-terminal-modal-header] [data-yaade-modal-editor-tabs]",
      )
    } finally {
      await app.close()
      fixture.remove()
    }
  })

  test("editor mode activates the session project root, not another catalog root", async () => {
    const fixture = createGitFixture()
    const { app, page } = await launchJet(fixture.workspace)
    try {
      await page.evaluate(async ({ primary, secondary }) => {
        await window.__yaadeAgent!.addWorkspace(secondary)
        await window.__yaadeAgent!.openWorkspace(secondary)
        void primary
      }, { primary: fixture.workspace, secondary: fixture.secondWorkspace })
      await expect
        .poll(() => page.evaluate(() => window.__yaadeAgent!.listWorkspaces().length))
        .toBe(2)
      await expect
        .poll(async () => {
          const active = await page.evaluate(() => window.__yaadeAgent!.getState().activeWorkspace)
          return active ? realpathSync(active) : null
        })
        .toBe(realpathSync(fixture.secondWorkspace))

      // Session cwd = secondary.
      await execCommand(page, "terminal.new")
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]", { timeout: 20_000 })

      // Steer active folder back to primary while the secondary session stays open.
      await page.evaluate(async primary => {
        await window.__yaadeAgent!.openWorkspace(primary)
      }, fixture.workspace)
      await expect
        .poll(async () => {
          const active = await page.evaluate(() => window.__yaadeAgent!.getState().activeWorkspace)
          return active ? realpathSync(active) : null
        })
        .toBe(realpathSync(fixture.workspace))

      await page.locator('[data-yaade-session-mode-tab="editor"]').click()
      await expectSelectorVisible(page, "[data-yaade-modal-editor]")

      // Editor must re-activate the session's project, not the stale catalog active.
      await expect
        .poll(async () => {
          const active = await page.evaluate(() => window.__yaadeAgent!.getState().activeWorkspace)
          return active ? realpathSync(active) : null
        })
        .toBe(realpathSync(fixture.secondWorkspace))

      await page.getByRole("button", { name: "Quick Open" }).click()
      await expectSelectorVisible(page, "[data-yaade-palette]")
      await expectLocatorVisible(
        page.getByRole("button", { name: "Only other-workspace" }),
      )
      await expect
        .poll(() =>
          page.getByRole("button", { name: "Only other-workspace" }).getAttribute("aria-pressed"),
        )
        .toBe("true")
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
  const root = mkdtempSync(join(tmpdir(), "yaade-git-editor-e2e-"))
  const workspace = join(root, "workspace")
  const secondWorkspace = join(root, "other-workspace")
  const remote = join(root, "origin.git")
  cpSync(join(REPO_ROOT, SAMPLE), workspace, { recursive: true })
  mkdirSync(secondWorkspace)
  writeFileSync(join(secondWorkspace, "other.ts"), "export const other = true\n")
  rmSync(join(workspace, ".git"), { recursive: true, force: true })

  git(workspace, "init", "-b", "main")
  git(workspace, "config", "user.name", "Yaade E2E")
  git(workspace, "config", "user.email", "yaade-e2e@example.com")
  writeFileSync(join(workspace, "README.md"), "# Yaade E2E\n")
  git(workspace, "add", ".")
  git(workspace, "commit", "-m", "Initial fixture")

  git(secondWorkspace, "init", "-b", "main")
  git(secondWorkspace, "config", "user.name", "Yaade E2E")
  git(secondWorkspace, "config", "user.email", "yaade-e2e@example.com")
  git(secondWorkspace, "add", ".")
  git(secondWorkspace, "commit", "-m", "Secondary fixture")
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
  await expectSelectorVisible(page, "[data-yaade-terminal-modal]", { timeout: 20_000 })
  await page.locator(`[data-yaade-session-mode-tab="${mode}"]`).click()
  await expectSelectorVisible(page, `[data-yaade-session-mode-tab="${mode}"][data-active]`)
  await expectLocatorCount(page.locator("[data-yaade-session-mode-tab]"), 4)
  await expectLocatorCount(page.locator("[data-yaade-workspace-sidebar]"), 0)
  if (mode === "git") await expectSelectorVisible(page, "[data-yaade-git-workspace]", { timeout: 20_000 })
}

async function openQuickFile(
  page: ShellDriver,
  query: string,
  expectedPath: string,
) {
  await page.getByRole("button", { name: "Quick Open" }).click()
  await expectSelectorVisible(page, "[data-yaade-palette]")
  const input = page.locator("[data-yaade-palette] input")
  await input.fill(query)
  await expectListRows(page, {
    panel: "yaade:palette",
    minItems: 1,
    needle: expectedPath,
    noResultsText: "No matching files.",
  })
  await page.getByRole("option").filter({ hasText: expectedPath }).first().click()
  await expectLocatorCount(page.locator("[data-yaade-palette]"), 0, { timeout: 20_000 })
}

async function selectBranch(
  page: ShellDriver,
  branch: string,
) {
  await page.locator("[data-yaade-git-branch-trigger]").click()
  await page.getByRole("menuitemradio", { name: branch, exact: true }).click()
  await expect
    .poll(() =>
      page
        .locator("[data-yaade-git-branch-trigger]")
        .getAttribute("aria-label"),
    { timeout: 20_000 })
    .toBe(`Switch branch, current branch ${branch}`)
}
