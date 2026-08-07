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
      await page.locator("[data-yaade-command-deck]").waitFor({ state: "visible" })
      await page.locator("[data-yaade-launch-agent]").waitFor({ state: "visible" })

      await expectListRows(page, {
        panel: "project-worktrees",
        minItems: 1,
        needle: "Main",
      })
      await expect
        .poll(() => page.getByText("Repository activity").count())
        .toBe(0)
      expect(
        await page.evaluate(() => {
          const worktrees = document.querySelector(
            '[data-yaade-list-panel="project-worktrees"]',
          )
          const sessions = document.querySelector(
            '[data-yaade-list-panel="project-sessions"]',
          )
          return Boolean(
            worktrees &&
              (!sessions ||
                (worktrees.compareDocumentPosition(sessions) &
                  Node.DOCUMENT_POSITION_FOLLOWING) !==
                  0),
          )
        }),
      ).toBe(true)

      const readme = page.locator("[data-yaade-project-readme]")
      await readme.getByRole("heading", { name: "Cockpit Fixture" }).waitFor({ state: "visible" })
      await readme.getByText("YAADE").waitFor({ state: "visible" })
      await readme.getByText("Image omitted: Remote image").waitFor({ state: "visible" })
      await expect.poll(() => readme.locator("img").count()).toBe(0)

      await page.setViewportSize({ width: 390, height: 844 })
      const mobile = await page.evaluate(() => {
        const primary = document.querySelector<HTMLElement>("[data-yaade-launch-agent]")
        return {
          viewport: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          primaryWidth: primary?.getBoundingClientRect().width ?? 0,
        }
      })
      expect(mobile.documentWidth).toBeLessThanOrEqual(mobile.viewport)
      expect(mobile.primaryWidth).toBeGreaterThan(320)

      await page.locator("[data-yaade-launch-agent]").focus()
      await page.keyboard.press("Tab")
      expect(
        await page.evaluate(
          () => (document.activeElement as HTMLElement | null)?.dataset.yaadeLaunchTool,
        ),
      ).toBe("terminal")
      expect(
        await page.locator('[data-yaade-launch-tool="terminal"]').evaluate(
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

  test("tool shortcuts augment the same hydrated workspace", async () => {
    const { home } = createRepository("yaade-cockpit-launch-")
    const { app, page } = await launchJet({
      homeDir: home,
      startPath: "/repo",
      launchWithoutWorkspace: true,
      projectPage: true,
    })
    try {
      await waitForProjectPage(page)
      await page.locator('[data-yaade-launch-tool="terminal"]').click()
      // This navigation is initiated by the launch request. The generic mux
      // helper may create its own fixture session while ProjectPage is still
      // switching views, which replaces the request-bearing session.
      await page.locator("[data-yaade-mux]").waitFor({ state: "visible" })
      await expect.poll(() => page.locator('[data-yaade-mux-pane-kind="terminal"]').count()).toBe(1)
      await expect.poll(() => page.locator("[data-yaade-mux-pane]").count()).toBe(1)

      await page.locator('[data-yaade-project-tab="overview"]').click()
      await page.locator('[data-yaade-launch-tool="editor"]').click()
      await expect.poll(() => page.locator('[data-yaade-mux-pane-kind="editor"]').count()).toBe(1)
      await expect.poll(() => page.locator("[data-yaade-mux-pane]").count()).toBe(2)

      await page.locator('[data-yaade-project-tab="overview"]').click()
      await page.locator('[data-yaade-launch-tool="git"]').click()
      await expect.poll(() => page.locator('[data-yaade-mux-pane-kind="git"]').count()).toBe(1)
      await expect.poll(() => page.locator("[data-yaade-mux-pane]").count()).toBe(3)

      await page.locator('[data-yaade-project-tab="overview"]').click()
      await page.locator('[data-yaade-launch-tool="neovim"]').click()
      await expect
        .poll(() => page.locator('[data-yaade-mux-pane-title][aria-label="Neovim"]').count())
        .toBe(1)
      await expect.poll(() => page.locator("[data-yaade-mux-pane]").count()).toBe(4)
      await expect.poll(() => page.locator('[data-yaade-mux-pane-kind="terminal"]').count()).toBe(2)
    } finally {
      await app.close()
      fs.rmSync(home, { recursive: true, force: true })
    }
  })

  test("agent picker launches each request exactly once", async () => {
    const { home } = createRepository("yaade-cockpit-agent-")
    const { app, page } = await launchJet({
      homeDir: home,
      startPath: "/repo",
      launchWithoutWorkspace: true,
      projectPage: true,
    })
    try {
      await waitForProjectPage(page)
      await page.locator("[data-yaade-launch-agent]").click()
      await expectListRows(page, {
        panel: "yaade:palette",
        minItems: 5,
        needle: "Claude",
        noResultsText: "No matching agents",
      })
      await page.locator('[data-yaade-agent-cli-option="codex"]').click()
      // This navigation is initiated by the launch request. Do not use
      // waitForMux() here: its fixture fallback creates a session when the
      // project-page agent stub is briefly replaced during the route change.
      await page.locator("[data-yaade-mux]").waitFor({ state: "visible" })
      await expect.poll(() => page.locator('[data-yaade-mux-pane-kind="terminal"]').count()).toBe(1)
      await page.locator('[data-yaade-mux-pane-title][aria-label="Codex"]').waitFor({ state: "visible" })
      await page.waitForTimeout(750)
      expect(await page.locator('[data-yaade-mux-pane-kind="terminal"]').count()).toBe(1)

      await page.locator('[data-yaade-project-tab="overview"]').click()
      await page.locator("[data-yaade-launch-agent]").click()
      await page.locator('[data-yaade-agent-cli-option="claude"]').click()
      await expect.poll(() => page.locator('[data-yaade-mux-pane-kind="terminal"]').count()).toBe(2)
      await page.waitForTimeout(750)
      expect(await page.locator('[data-yaade-mux-pane-kind="terminal"]').count()).toBe(2)
    } finally {
      await app.close()
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})
