import { expect, test } from "@playwright/test"
import { execSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expectListRows } from "../helpers/list.js"
import { launchJet, waitForProjectPage } from "./_launch.js"

test.describe("project page", () => {
  test("lists sessions with scoped anti-tautology assertions", async () => {
    const { app, page } = await launchJet({ projectPage: true })
    try {
      await waitForProjectPage(page)

      await page.evaluate(async () => {
        await window.__yaadeAgent!.createProjectSession?.({
          title: "E2E Session Alpha",
        })
        await window.__yaadeAgent!.backToProject?.()
      })
      await waitForProjectPage(page)

      await expectListRows(page, {
        panel: "project-sessions",
        minItems: 1,
        needle: "E2E Session Alpha",
        noResultsText: "No sessions yet",
      })
    } finally {
      await app.close()
    }
  })

  test("path switcher navigates to a sibling directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yaade-path-switch-"))
    const home = path.join(root, "home")
    fs.mkdirSync(path.join(home, "dev", "alpha"), { recursive: true })
    fs.mkdirSync(path.join(home, "dev", "beta"), { recursive: true })
    fs.writeFileSync(path.join(home, "dev", "alpha", "README.md"), "alpha\n")
    fs.writeFileSync(path.join(home, "dev", "beta", "README.md"), "beta\n")

    const { app, page } = await launchJet({
      projectPage: true,
      launchWithoutWorkspace: true,
      homeDir: home,
      startPath: "/dev/alpha",
    })
    try {
      await waitForProjectPage(page)
      await expect
        .poll(
          async () =>
            page.locator("[data-yaade-project-path]").getAttribute(
              "data-yaade-project-path",
            ),
          { timeout: 5_000 },
        )
        .toBe(path.join(home, "dev", "alpha"))

      await page.locator('[data-yaade-path-segment="alpha"]').click()
      await page
        .locator('[data-yaade-path-switcher-menu="alpha"]')
        .waitFor({ state: "visible", timeout: 5_000 })
      await page.locator("[data-yaade-path-switcher-search]").waitFor({
        state: "visible",
        timeout: 5_000,
      })
      await page.locator("[data-yaade-path-switcher-search]").fill("bet")
      await page.locator('[data-yaade-path-sibling="beta"]').waitFor({
        state: "visible",
        timeout: 5_000,
      })
      await expect
        .poll(
          async () => page.locator('[data-yaade-path-sibling="alpha"]').count(),
          { timeout: 3_000 },
        )
        .toBe(0)
      await page.locator("[data-yaade-path-switcher-search]").press("Enter")

      await expect
        .poll(
          async () =>
            page.locator("[data-yaade-project-path]").getAttribute(
              "data-yaade-project-path",
            ),
          { timeout: 10_000 },
        )
        .toBe(path.join(home, "dev", "beta"))

      await page.locator('[data-yaade-path-segment="beta"]').waitFor({
        state: "visible",
        timeout: 5_000,
      })
      expect(await page.evaluate(() => location.pathname)).toBe("/dev/beta")
    } finally {
      await app.close()
    }
  })

  test("path switcher arrow keys move selection", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yaade-path-arrows-"))
    const home = path.join(root, "home")
    fs.mkdirSync(path.join(home, "dev", "alpha"), { recursive: true })
    fs.mkdirSync(path.join(home, "dev", "beta"), { recursive: true })
    fs.mkdirSync(path.join(home, "dev", "gamma"), { recursive: true })

    const { app, page } = await launchJet({
      projectPage: true,
      launchWithoutWorkspace: true,
      homeDir: home,
      startPath: "/dev/alpha",
    })
    try {
      await waitForProjectPage(page)
      await page.locator('[data-yaade-path-segment="alpha"]').click()
      await page
        .locator('[data-yaade-path-switcher-menu="alpha"]')
        .waitFor({ state: "visible", timeout: 5_000 })
      await page.locator('[data-yaade-path-sibling="beta"]').waitFor({
        state: "visible",
        timeout: 5_000,
      })

      await page.locator("[data-yaade-path-switcher-search]").press("ArrowDown")
      await expect
        .poll(async () => {
          return page.evaluate(() => {
            const selected = document.querySelector(
              "[data-yaade-path-sibling][data-selected='true']",
            )
            return selected?.getAttribute("data-yaade-path-sibling") ?? null
          })
        })
        .toBe("beta")
      await page.locator("[data-yaade-path-switcher-search]").press("Enter")

      await expect
        .poll(
          async () =>
            page.locator("[data-yaade-project-path]").getAttribute(
              "data-yaade-project-path",
            ),
          { timeout: 10_000 },
        )
        .toBe(path.join(home, "dev", "beta"))
    } finally {
      await app.close()
    }
  })

  test("breadcrumb segment opens switcher to navigate up", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yaade-path-up-"))
    const home = path.join(root, "home")
    fs.mkdirSync(path.join(home, "dev", "nested"), { recursive: true })

    const { app, page } = await launchJet({
      projectPage: true,
      launchWithoutWorkspace: true,
      homeDir: home,
      startPath: "/dev/nested",
    })
    try {
      await waitForProjectPage(page)
      await page.locator('[data-yaade-path-segment="dev"]').click()
      await page
        .locator('[data-yaade-path-switcher-menu="dev"]')
        .waitFor({ state: "visible", timeout: 5_000 })
      await page.locator('[data-yaade-path-sibling="dev"]').click()
      await expect
        .poll(
          async () =>
            page.locator("[data-yaade-project-path]").getAttribute(
              "data-yaade-project-path",
            ),
          { timeout: 10_000 },
        )
        .toBe(path.join(home, "dev"))
      expect(await page.evaluate(() => location.pathname)).toBe("/dev")
    } finally {
      await app.close()
    }
  })

  test("clicking a recent commit opens a changes modal", async () => {
    test.skip(
      (() => {
        try {
          execSync("which git", { stdio: "ignore" })
          return false
        } catch {
          return true
        }
      })(),
      "git not available",
    )

    const home = fs.mkdtempSync(path.join(os.tmpdir(), "yaade-commit-modal-"))
    const project = path.join(home, "repo")
    fs.mkdirSync(project, { recursive: true })
    execSync(
      "git init && git config user.email t@t && git config user.name t && echo one > README.md && git add . && git commit -m first && echo two > README.md && git add . && git commit -m second",
      { cwd: project, stdio: "ignore" },
    )

    const { app, page } = await launchJet({
      homeDir: home,
      startPath: "/repo",
      launchWithoutWorkspace: true,
      projectPage: true,
    })
    try {
      await waitForProjectPage(page)
      await page.locator("[data-yaade-recent-commit]").first().waitFor({
        state: "visible",
        timeout: 10_000,
      })
      await page.locator("[data-yaade-recent-commit]").first().click()

      await page.locator("[data-yaade-commit-changes-dialog]").waitFor({
        state: "visible",
        timeout: 10_000,
      })
      await expect
        .poll(
          async () =>
            (await page.locator("[data-yaade-commit-changes-dialog]").textContent()) ?? "",
          { timeout: 10_000 },
        )
        .toContain("second")

      await expectListRows(page, {
        panel: "commit-changes-files",
        minItems: 1,
        needle: "README.md",
        noResultsText: "No files changed",
      })

      await expect
        .poll(
          async () => page.locator("[data-yaade-commit-changes-dialog] [data-yaade-git-diff]").count(),
          { timeout: 5_000 },
        )
        .toBe(1)
      await expect
        .poll(
          async () =>
            page
              .locator("[data-yaade-commit-changes-dialog] .monaco-diff-editor")
              .count(),
          { timeout: 15_000 },
        )
        .toBeGreaterThan(0)
    } finally {
      await app.close()
      fs.rmSync(home, { recursive: true, force: true })
    }
  })

  test("history tab shows commit file diffs inline", async () => {
    test.skip(
      (() => {
        try {
          execSync("which git", { stdio: "ignore" })
          return false
        } catch {
          return true
        }
      })(),
      "git not available",
    )

    const home = fs.mkdtempSync(path.join(os.tmpdir(), "yaade-history-diff-"))
    const project = path.join(home, "repo")
    fs.mkdirSync(project, { recursive: true })
    execSync(
      "git init && git config user.email t@t && git config user.name t && echo one > note.txt && git add . && git commit -m alpha && echo two > note.txt && git add . && git commit -m beta",
      { cwd: project, stdio: "ignore" },
    )

    const { app, page } = await launchJet({
      homeDir: home,
      startPath: "/repo",
      launchWithoutWorkspace: true,
      projectPage: true,
    })
    try {
      await waitForProjectPage(page)
      await page.locator('[data-yaade-project-tab="history"]').click()
      await page
        .locator('[data-yaade-list-panel="git-history"] [data-yaade-list-item]')
        .first()
        .waitFor({ state: "visible", timeout: 15_000 })
      await page
        .locator('[data-yaade-list-panel="git-history"] [data-yaade-list-item]')
        .first()
        .click()

      await page.locator("[data-yaade-git-commit-detail]").waitFor({
        state: "visible",
        timeout: 10_000,
      })
      await expectListRows(page, {
        panel: "git-commit-files",
        minItems: 1,
        needle: "note.txt",
        noResultsText: "No files changed",
      })

      await page
        .locator('[data-yaade-list-panel="git-commit-files"] [data-yaade-list-item]')
        .first()
        .click()

      await expect
        .poll(
          async () =>
            page
              .locator("[data-yaade-git-commit-detail] [data-yaade-git-diff] .monaco-diff-editor")
              .count(),
          { timeout: 15_000 },
        )
        .toBeGreaterThan(0)
    } finally {
      await app.close()
      fs.rmSync(home, { recursive: true, force: true })
    }
  })

  test("project search opens a Neovim session with quickfix hits", async () => {
    test.skip(
      (() => {
        try {
          execSync("which nvim", { stdio: "ignore" })
          return false
        } catch {
          return true
        }
      })(),
      "nvim not available",
    )

    const home = fs.mkdtempSync(path.join(os.tmpdir(), "yaade-proj-search-"))
    const project = path.join(home, "repo")
    fs.mkdirSync(project, { recursive: true })
    execSync(
      "git init && git config user.email t@t && git config user.name t && echo 'hello yaade-search-needle world' > readme.txt && git add . && git commit -m init",
      { cwd: project, stdio: "ignore" },
    )

    const { app, page } = await launchJet({
      homeDir: home,
      startPath: "/repo",
      launchWithoutWorkspace: true,
      projectPage: true,
    })
    try {
      await waitForProjectPage(page)
      await page.locator("[data-yaade-project-search-input]").waitFor({
        state: "visible",
        timeout: 5_000,
      })
      await page
        .locator("[data-yaade-project-search-input]")
        .fill("yaade-search-needle")
      await page.locator("[data-yaade-project-search-input]").press("Enter")

      await page.locator("[data-yaade-mux]").waitFor({
        state: "visible",
        timeout: 20_000,
      })
      await page.evaluate(() => window.__yaadeAgent!.waitForReady())
      await expect
        .poll(
          async () =>
            page
              .locator('[data-yaade-mux-pane-title][aria-label="Neovim"]')
              .count(),
          { timeout: 15_000 },
        )
        .toBeGreaterThan(0)

      await expect
        .poll(async () => {
          const state = await page.evaluate(() => window.__yaadeAgent!.getState())
          return state.route === "session" && Boolean(state.sessionId)
        })
        .toBe(true)
    } finally {
      await app.close()
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})
