import { expect, test } from "@playwright/test"
import { execSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  launchJet,
  waitForMux,
  waitForProjectPage,
  waitForTerminalText,
} from "./_launch.js"

function hasGit(): boolean {
  try {
    execSync("which git", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

test.describe("git worktree sessions", () => {
  test.skip(!hasGit(), "git not available")

  test("worktree session spawns terminal in the worktree cwd", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "yaade-wt-home-"))
    const project = path.join(home, "repo")
    fs.mkdirSync(project, { recursive: true })
    execSync("git init && git config user.email t@t && git config user.name t && echo hi > README && git add . && git commit -m init", {
      cwd: project,
      stdio: "ignore",
    })

    const { app, page } = await launchJet({
      homeDir: home,
      startPath: "/repo",
      launchWithoutWorkspace: true,
      projectPage: true,
    })
    try {
      await waitForProjectPage(page)
      const branch = `e2e-wt-${Date.now().toString(36)}`
      await page.evaluate(async br => {
        await window.__yaadeAgent!.createProjectSession?.({
          title: br,
          worktree: { branch: br },
        })
      }, branch)
      await waitForMux(page)
      await page.evaluate(() => window.__yaadeAgent!.executeCommand("terminal.new"))
      await page.locator("[data-yaade-terminal-panel]").waitFor({
        state: "visible",
        timeout: 15_000,
      })

      const state = await page.evaluate(() => window.__yaadeAgent!.getState())
      expect(state.sessionCwd).toContain(".yaade/worktrees")
      expect(fs.existsSync(state.sessionCwd!)).toBe(true)

      await page.locator("[data-yaade-terminal-panel]").first().click()
      await page.keyboard.type("pwd")
      await page.keyboard.press("Enter")
      await waitForTerminalText(page, ".yaade/worktrees")
    } finally {
      await app.close()
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})
