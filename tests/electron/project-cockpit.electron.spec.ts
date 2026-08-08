import { expect, test } from "@playwright/test"
import { execSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expectListRows } from "../helpers/list.js"
import { launchJet, waitForProjectPage } from "./_launch.js"

function createRepository(prefix: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const project = path.join(home, "repo")
  fs.mkdirSync(path.join(project, "src"), { recursive: true })
  fs.writeFileSync(
    path.join(project, "README.md"),
    [
      "# Cockpit Fixture",
      "",
      "- [x] Render GFM",
      "",
      "| Tool | Ready |",
      "| --- | --- |",
      "| YAADE | yes |",
      "",
      "[Local source](src/app.ts)",
      "[External](https://example.com)",
      "![Remote image](https://example.com/remote.png)",
    ].join("\n"),
  )
  fs.writeFileSync(path.join(project, "src", "app.ts"), "export const ready = true\n")
  execSync(
    "git init && git config user.email test@example.com && git config user.name Cockpit && git add . && git commit -m 'feat: seed cockpit'",
    { cwd: project, stdio: "ignore" },
  )
  fs.appendFileSync(path.join(project, "src", "app.ts"), "export const followUp = true\n")
  execSync("git add . && git commit -m 'fix: add cockpit follow-up'", {
    cwd: project,
    stdio: "ignore",
  })
  execSync("git branch feature/cockpit-menu", { cwd: project, stdio: "ignore" })
  fs.appendFileSync(path.join(project, "src", "app.ts"), "export const dirty = true\n")
  return { home, project }
}

test.describe("project cockpit", () => {
  test("shows actionable repository data and adapts without overflow", async () => {
    const { home } = createRepository("yaade-cockpit-")
    const { app, page } = await launchJet({
      homeDir: home,
      startPath: "/repo",
      launchWithoutWorkspace: true,
      projectPage: true,
    })
    try {
      await waitForProjectPage(page)
      await page.getByRole("heading", { name: "repo" }).waitFor({ state: "visible" })
      const branchMenu = page.locator("[data-yaade-project-branch-menu]")
      await branchMenu.waitFor({ state: "visible" })
      await expect
        .poll(() =>
          page.evaluate(() => ({
            commandDeck: document.querySelectorAll("[data-yaade-command-deck]").length,
            launchAgent: document.querySelectorAll("[data-yaade-launch-agent]").length,
            worktreeCards: document.querySelectorAll("[data-yaade-project-worktrees]").length,
            worktreeSwitcher: document.querySelectorAll("[data-yaade-worktree-switcher]").length,
          })),
        )
        .toEqual({ commandDeck: 0, launchAgent: 0, worktreeCards: 0, worktreeSwitcher: 1 })

      await branchMenu.focus()
      await page.keyboard.press("Enter")
      await expectListRows(page, {
        panel: "project-branches",
        minItems: 2,
        needle: "feature/cockpit-menu",
        noResultsText: "No branches",
      })
      await page.keyboard.press("Escape")
      await expect
        .poll(() => page.locator('[data-yaade-list-panel="project-branches"]').count())
        .toBe(0)
      await expectListRows(page, {
        panel: "project-commits",
        minItems: 2,
        needle: "fix: add cockpit follow-up",
        noResultsText: "No commits yet",
      })
      await page
        .locator('[data-yaade-project-commit]')
        .filter({ hasText: "fix: add cockpit follow-up" })
        .click()
      await page.locator("[data-yaade-commit-changes-dialog]").waitFor({
        state: "visible",
        timeout: 10_000,
      })
      await expectListRows(page, {
        panel: "commit-changes-files",
        minItems: 1,
        needle: "app.ts",
        noResultsText: "No files changed",
      })
      await page.getByRole("button", { name: "Close" }).click()

      await page.locator("[data-yaade-project-history-more]").click()
      await page
        .locator('[data-yaade-project-panel="history"]')
        .waitFor({ state: "visible" })
      await expect
        .poll(() =>
          page
            .locator('[data-yaade-project-tab="history"]')
            .getAttribute("data-state"),
        )
        .toBe("active")
      await expectListRows(page, {
        panel: "git-history",
        minItems: 3,
        needle: "fix: add cockpit follow-up",
      })
      await page.locator('[data-yaade-project-tab="overview"]').click()

      const readme = page.locator("[data-yaade-project-readme]")
      await readme.getByRole("heading", { name: "Cockpit Fixture" }).waitFor({ state: "visible" })
      await readme.getByText("YAADE").waitFor({ state: "visible" })
      await readme.getByText("Image omitted: Remote image").waitFor({ state: "visible" })
      await expect.poll(() => readme.locator("img").count()).toBe(0)

      await page.setViewportSize({ width: 390, height: 844 })
      const mobile = await page.evaluate(() => {
        const branch = document.querySelector<HTMLElement>("[data-yaade-project-branch-menu]")
        return {
          viewport: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          branchWidth: branch?.getBoundingClientRect().width ?? 0,
        }
      })
      expect(mobile.documentWidth).toBeLessThanOrEqual(mobile.viewport)
      expect(mobile.branchWidth).toBeGreaterThan(60)

      await branchMenu.focus()
      await page.keyboard.press("Tab")
      await page.keyboard.press("Shift+Tab")
      expect(
        await branchMenu.evaluate(
          element => getComputedStyle(element).boxShadow,
        ),
      ).not.toBe("none")

      await page.evaluate(() => {
        document.documentElement.dataset.yaadeReducedMotion = "true"
      })
      expect(
        await page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--yaade-motion-panel")
            .trim(),
        ),
      ).toMatch(/^0(?:ms|s)$/)

      await page.evaluate(() => {
        localStorage.setItem("jet-theme-id", "default-light")
        localStorage.setItem("jet-color-scheme", "light")
        localStorage.setItem(
          "jet-appearance-settings",
          JSON.stringify({ themeId: "default-light" }),
        )
      })
      await page.reload()
      await waitForProjectPage(page)
      expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
    } finally {
      await app.close()
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})
