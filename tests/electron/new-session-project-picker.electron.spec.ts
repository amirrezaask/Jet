import { expect, test } from "@playwright/test"
import {
  expectLocatorCount,
  expectLocatorVisible,
  expectSelectorVisible,
} from "../shell/assert.js"
import {
  clickNewSession,
  hasPtySpawn,
  launchJet,
  pickAgentCli,
  REPO_ROOT,
} from "./_launch.js"
import { resolve } from "node:path"

const ptyAvailable = hasPtySpawn()

test.describe("new session project picker", () => {
  test.skip(!ptyAvailable, "PTY sessions are unavailable on this machine")

  test("shows project chips when multiple workspaces exist", async () => {
    const secondPath = resolve(REPO_ROOT, "fixtures/second-workspace")
    const { app, page } = await launchJet()
    try {
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__gharargahAgent!.getState().sessionLayout,
          ),
        )
        .toBe("sidebar")

      await page.evaluate(
        path => window.__gharargahAgent!.addWorkspace(path),
        secondPath,
      )
      await expect
        .poll(() =>
          page.evaluate(() => window.__gharargahAgent!.listWorkspaces().length),
        )
        .toBeGreaterThanOrEqual(2)

      await clickNewSession(page)
      await expectSelectorVisible(page, "[data-gharargah-palette]")
      await expectSelectorVisible(
        page,
        "[data-gharargah-agent-cli-project-picker]",
      )
      await expectSelectorVisible(
        page,
        "[data-gharargah-agent-cli-add-project]",
      )

      const chips = page.locator("[data-gharargah-agent-cli-project-option]")
      await expectLocatorCount(chips, 2)

      const secondChip = page
        .locator("[data-gharargah-agent-cli-project-option]")
        .filter({ hasText: "second-workspace" })
        .first()
      await expectLocatorVisible(secondChip)
      await secondChip.click()
      await expect
        .poll(() => secondChip.getAttribute("data-state"))
        .toBe("on")

      await pickAgentCli(page, "codex")
      await expectSelectorVisible(
        page,
        '[data-gharargah-terminal-modal][data-gharargah-session-presentation="inline"]',
        { timeout: 20_000 },
      )
    } finally {
      await app.close()
    }
  })

  test("removes a project chip from its accessible context menu", async () => {
    const secondPath = resolve(REPO_ROOT, "fixtures/second-workspace")
    const { app, page } = await launchJet()
    try {
      await page.evaluate(
        async ([second, repo]) => {
          await window.__gharargahAgent!.addWorkspace(second)
          await window.__gharargahAgent!.addWorkspace(repo)
        },
        [secondPath, REPO_ROOT],
      )
      await expect
        .poll(() =>
          page.evaluate(() => window.__gharargahAgent!.listWorkspaces().length),
        )
        .toBe(3)

      await clickNewSession(page)
      const picker = page.locator(
        "[data-gharargah-agent-cli-project-picker]",
      )
      await expectLocatorVisible(picker)
      const pickerBefore = await picker.boundingBox()

      const removedChip = page.getByRole("radio", {
        name: "Project second-workspace",
      })
      await removedChip.click()
      await expect
        .poll(() => removedChip.getAttribute("data-state"))
        .toBe("on")
      await removedChip.click({ button: "right" })

      const menu = page.locator(
        "[data-gharargah-agent-cli-project-menu]",
      )
      await expectLocatorVisible(menu)
      const removeItem = menu.getByRole("menuitem", {
        name: "Remove second-workspace",
      })
      await expectLocatorVisible(removeItem)
      await removeItem.click()

      await expect
        .poll(() =>
          page.evaluate(() =>
            window.__gharargahAgent!.listWorkspaces().map(project => project.name),
          ),
        )
        .not.toContain("second-workspace")
      await expectLocatorCount(removedChip, 0)
      await expectLocatorCount(
        page.locator("[data-gharargah-agent-cli-project-option]"),
        2,
      )
      await expectLocatorCount(
        page.locator(
          '[data-gharargah-agent-cli-project-option][data-state="on"]',
        ),
        1,
      )
      await expect
        .poll(() =>
          page
            .getByRole("radio", { name: "Project jet" })
            .getAttribute("data-state"),
        )
        .toBe("on")
      await expectLocatorVisible(picker)
      const pickerAfter = await picker.boundingBox()
      expect(pickerBefore).not.toBeNull()
      expect(pickerAfter).not.toBeNull()
      expect(pickerAfter).toEqual(
        expect.objectContaining({
          x: pickerBefore!.x,
          y: pickerBefore!.y,
          height: pickerBefore!.height,
        }),
      )
      expect(pickerAfter!.width).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })

  test("shows project chips and add control for a single workspace", async () => {
    const { app, page } = await launchJet()
    try {
      await expect
        .poll(() =>
          page.evaluate(() => window.__gharargahAgent!.listWorkspaces().length),
        )
        .toBe(1)

      await clickNewSession(page)
      await expectSelectorVisible(page, "[data-gharargah-palette]")
      await expectSelectorVisible(
        page,
        "[data-gharargah-agent-cli-project-picker]",
      )
      await expectLocatorCount(
        page.locator("[data-gharargah-agent-cli-project-option]"),
        1,
      )
      await expectSelectorVisible(
        page,
        "[data-gharargah-agent-cli-add-project]",
      )
      await pickAgentCli(page, "codex")
      await expectSelectorVisible(
        page,
        "[data-gharargah-terminal-modal]",
        { timeout: 20_000 },
      )
    } finally {
      await app.close()
    }
  })

  test("plus chip opens add project modal from new session picker", async () => {
    const secondPath = resolve(REPO_ROOT, "fixtures/second-workspace")
    const { app, page } = await launchJet()
    try {
      await clickNewSession(page)
      await expectSelectorVisible(
        page,
        "[data-gharargah-agent-cli-add-project]",
      )
      await page.locator("[data-gharargah-agent-cli-add-project]").click()

      const addDialog = page.getByRole("dialog", {
        name: "Add workspace folder",
      })
      await expectLocatorVisible(addDialog)
      await expectSelectorVisible(page, "[data-gharargah-palette]")
      await expectLocatorCount(
        page.locator("[data-gharargah-agent-cli-project-option]"),
        1,
      )
      await page.getByPlaceholder("Path to folder…").fill(`${secondPath}/`)
      await addDialog.getByRole("button", { name: /Add Project/i }).click()

      await expect
        .poll(() =>
          page.evaluate(() => window.__gharargahAgent!.listWorkspaces().length),
        )
        .toBeGreaterThanOrEqual(2)

      await expectSelectorVisible(page, "[data-gharargah-palette]")
      const secondChip = page
        .locator("[data-gharargah-agent-cli-project-option]")
        .filter({ hasText: "second-workspace" })
        .first()
      await expectLocatorVisible(secondChip)
      await expect
        .poll(() => secondChip.getAttribute("data-state"))
        .toBe("on")
    } finally {
      await app.close()
    }
  })
})
