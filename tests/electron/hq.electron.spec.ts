import { expect, test } from "@playwright/test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expectListRows } from "../helpers/list.js"
import { launchJet, waitForHq, waitForProjectPage } from "./_launch.js"

type SeededAgent = {
  projectId: string
  projectSessionId: string
  sessionId: string
  ptyId: string
}

async function seedAgent(
  page: Awaited<ReturnType<typeof launchJet>>["page"],
  input: {
    rootPath: string
    title: string
    provider: "codex" | "claude"
    notification: "permission" | "completed"
  },
): Promise<SeededAgent> {
  return page.evaluate(async seed => {
    const projectResponse = await fetch("/api/v1/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: seed.rootPath }),
    })
    if (!projectResponse.ok) throw new Error(await projectResponse.text())
    const project = (await projectResponse.json()) as {
      id: string
      name: string
      rootPath: string
    }
    const sessionResponse = await fetch("/api/v1/project-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: seed.rootPath, cwdPath: seed.rootPath, title: "Main" }),
    })
    if (!sessionResponse.ok) throw new Error(await sessionResponse.text())
    const projectSession = (await sessionResponse.json()) as { id: string }
    const sessionId = `yaade:terminal:hq-${seed.provider}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const terminal = await window.yaade!.terminal!.create(`file://${seed.rootPath}`, {
      command: "sh",
      args: [
        "-c",
        "printf 'HQ_AGENT_READY\\n'; while IFS= read -r line; do [ \"$line\" = \"__EXIT__\" ] && exit 0; printf 'HQ_ECHO:%s\\n' \"$line\"; done",
      ],
    })
    const update = await fetch(`/api/v1/project-sessions/${projectSession.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payload: {
          version: 1,
          layout: { tree: { root: null }, focusedPaneId: null, zoomedPaneId: null },
          sessions: [{
            ptyTabId: sessionId,
            ptyId: terminal.id,
            cwdRootUri: `file://${seed.rootPath}`,
            launchCommand: seed.provider,
            agentProvider: seed.provider,
            agentTitle: seed.title,
          }],
        },
      }),
    })
    if (!update.ok) throw new Error(await update.text())
    await window.yaade!.notifications!.bindSession({
      sessionId,
      projectId: project.id,
      projectName: project.name,
      sessionTitle: seed.title,
      provider: seed.provider,
      ptyId: terminal.id,
    })
    await window.yaade!.notifications!.ingest({
      source: "provider-hook",
      type: seed.notification === "permission" ? "permission-required" : "turn-completed",
      title:
        seed.notification === "permission"
          ? `${seed.title} needs permission`
          : `${seed.title} completed a turn`,
      sessionId,
      eventId: `hq-e2e-${sessionId}`,
    })
    return {
      projectId: project.id,
      projectSessionId: projectSession.id,
      sessionId,
      ptyId: terminal.id,
    }
  }, input)
}

test.describe("YAADE HQ", () => {
  test("aggregates projects and live agents, filters attention, and preserves PTYs through the dialog", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yaade-hq-e2e-"))
    const home = path.join(root, "home")
    const alpha = path.join(home, "alpha")
    const beta = path.join(home, "beta")
    const external = path.join(root, "external-project")
    fs.mkdirSync(alpha, { recursive: true })
    fs.mkdirSync(beta, { recursive: true })
    fs.mkdirSync(external, { recursive: true })

    const { app, page } = await launchJet({
      homeDir: home,
      startPath: "/",
      launchWithoutWorkspace: true,
      hq: true,
      env: { JET_ALLOWED_ROOTS: root },
    })
    try {
      expect(
        await page
          .getByRole("heading", { name: "Machine overview" })
          .count(),
      ).toBe(0)
      expect(
        await page
          .getByText(
            "Monitor projects, live agents, and activity across this machine.",
          )
          .count(),
      ).toBe(0)

      const initialResources = await page.evaluate(() =>
        performance.getEntriesByType("resource").map(entry => entry.name),
      )
      expect(
        initialResources.some(name =>
          /(?:MuxApp|monaco|xterm|git-entry|HqAgentDialog|settings-entry)/i.test(name),
        ),
      ).toBe(false)

      const alphaAgent = await seedAgent(page, {
        rootPath: alpha,
        title: "Codex Alpha",
        provider: "codex",
        notification: "permission",
      })
      await seedAgent(page, {
        rootPath: beta,
        title: "Claude Beta",
        provider: "claude",
        notification: "completed",
      })
      const externalProject = await page.evaluate(async rootPath => {
        const response = await fetch("/api/v1/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rootPath }),
        })
        return (await response.json()) as { id: string }
      }, external)

      await page.getByRole("button", { name: "Refresh HQ" }).click()
      await expectListRows(page, {
        panel: "hq-agents",
        minItems: 2,
        needle: "Codex Alpha",
        noResultsText: "No live agents",
      })
      await expectListRows(page, {
        panel: "hq-projects",
        minItems: 3,
        needle: "alpha",
      })
      expect(await page.getByText("Recent activity").count()).toBe(0)
      await page
        .locator('[data-yaade-hq-project]')
        .filter({ hasText: "alpha" })
        .getByRole("button", { name: "Launch agent in alpha" })
        .click()
      await expectListRows(page, {
        panel: "yaade:palette",
        minItems: 5,
        needle: "Claude",
        noResultsText: "No matching agents",
      })
      await page.getByRole("button", { name: "Close" }).click()
      await page.setViewportSize({ width: 1440, height: 900 })
      const summaryTopGap = await page.evaluate(() => {
        const header = document
          .querySelector("[data-yaade-app-header]")
          ?.getBoundingClientRect()
        const summary = document
          .querySelector("[data-yaade-hq-summary]")
          ?.getBoundingClientRect()
        return header && summary ? summary.top - header.bottom : null
      })
      expect(summaryTopGap).not.toBeNull()
      expect(summaryTopGap!).toBeLessThanOrEqual(20)
      const desktopColumns = await page.evaluate(() => {
        const agents = document
          .querySelector('[data-yaade-hq-column="agents"]')
          ?.getBoundingClientRect()
        const projects = document
          .querySelector('[data-yaade-hq-column="projects"]')
          ?.getBoundingClientRect()
        return agents && projects
          ? {
              agents: { x: agents.x, y: agents.y, width: agents.width },
              projects: { x: projects.x, y: projects.y, width: projects.width },
            }
          : null
      })
      expect(desktopColumns).not.toBeNull()
      expect(desktopColumns!.projects.x).toBeGreaterThan(
        desktopColumns!.agents.x + desktopColumns!.agents.width,
      )
      expect(Math.abs(desktopColumns!.agents.y - desktopColumns!.projects.y)).toBeLessThan(2)
      expect(desktopColumns!.agents.width).toBeGreaterThan(desktopColumns!.projects.width)
      await page.setViewportSize({ width: 390, height: 844 })
      const mobileLayout = await page.evaluate(() => {
        const agents = document
          .querySelector('[data-yaade-hq-column="agents"]')
          ?.getBoundingClientRect()
        const projects = document
          .querySelector('[data-yaade-hq-column="projects"]')
          ?.getBoundingClientRect()
        return agents && projects
          ? {
              agentsBottom: agents.bottom,
              projectsTop: projects.top,
              documentWidth: document.documentElement.scrollWidth,
              viewportWidth: innerWidth,
            }
          : null
      })
      expect(mobileLayout).not.toBeNull()
      expect(mobileLayout!.projectsTop).toBeGreaterThan(mobileLayout!.agentsBottom)
      expect(mobileLayout!.documentWidth).toBeLessThanOrEqual(mobileLayout!.viewportWidth)
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.getByRole("tab", { name: /^Attention$/ }).click()
      await expect.poll(() => page.locator('[data-yaade-list-panel="hq-agents"] [data-yaade-list-item]').count()).toBe(1)
      await expect.poll(() => page.locator('[data-yaade-list-panel="hq-agents"]').textContent()).toContain("Codex Alpha")
      await page.getByRole("tab", { name: /^All$/ }).click()
      await page.getByLabel("Search live agents").fill("Claude Beta")
      await expect.poll(() => page.locator('[data-yaade-list-panel="hq-agents"] [data-yaade-list-item]').count()).toBe(1)
      await expect.poll(() => page.locator('[data-yaade-list-panel="hq-agents"]').textContent()).toContain("beta")
      await page.getByLabel("Search live agents").fill("")

      await page.locator(`[data-yaade-hq-agent="${alphaAgent.sessionId}"]`).getByRole("button", { name: /Codex Alpha/ }).click()
      await page.locator("[data-yaade-hq-agent-dialog]").waitFor({ state: "visible" })
      const terminalInput = page.locator("[data-yaade-hq-agent-dialog] .xterm-helper-textarea")
      await terminalInput.focus()
      await page.keyboard.type("dialog-input")
      await page.keyboard.press("Enter")
      await expect.poll(async () =>
        page.evaluate(async ptyId => {
          const attached = await window.yaade!.terminal!.attach(ptyId)
          return [...(attached?.outputChunks ?? []), attached?.output ?? ""].join("")
        }, alphaAgent.ptyId),
      ).toContain("HQ_ECHO:dialog-input")

      await page.getByRole("button", { name: "Mark Read" }).click()
      await expect.poll(() => page.getByRole("button", { name: "Mark Read" }).getAttribute("disabled")).not.toBeNull()
      await page.getByRole("button", { name: "Close" }).click()
      await page.evaluate(async ptyId => {
        await window.yaade!.terminal!.write(ptyId, "after-close\r")
      }, alphaAgent.ptyId)
      await page.locator(`[data-yaade-hq-agent="${alphaAgent.sessionId}"]`).getByRole("button", { name: /Codex Alpha/ }).click()
      await expect.poll(async () =>
        page.evaluate(async ptyId => {
          const attached = await window.yaade!.terminal!.attach(ptyId)
          return [...(attached?.outputChunks ?? []), attached?.output ?? ""].join("")
        }, alphaAgent.ptyId),
      ).toContain("HQ_ECHO:after-close")

      await page.evaluate(async ptyId => {
        await window.yaade!.terminal!.write(ptyId, "__EXIT__\r")
      }, alphaAgent.ptyId)
      await page.locator("[data-yaade-hq-agent-disconnected]").waitFor({ state: "visible" })
      await page.getByRole("button", { name: "Close" }).click()
      await expect.poll(() => page.locator(`[data-yaade-hq-agent="${alphaAgent.sessionId}"]`).count()).toBe(0)
      await page.locator("[data-yaade-notification-bell]").click()
      await expect.poll(() => page.getByText("Codex Alpha needs permission").isVisible()).toBe(true)
      await page.getByRole("button", { name: "Dismiss notification center" }).click()

      await page.locator('[data-yaade-list-panel="hq-projects"] [data-yaade-list-item]').filter({ hasText: "alpha" }).getByRole("button", { name: "Open alpha" }).click()
      await waitForProjectPage(page)
      expect(await page.evaluate(() => location.pathname)).toBe("/alpha")
      await page.getByRole("button", { name: "Open HQ" }).click()
      await waitForHq(page)
      await page.evaluate(() => history.back())
      await waitForProjectPage(page)
      expect(await page.evaluate(() => location.pathname)).toBe("/alpha")
      await page.evaluate(() => history.forward())
      await waitForHq(page)

      await page.locator(`[data-yaade-hq-project="${externalProject.id}"]`).getByRole("button", { name: "Open external-project" }).click()
      await waitForProjectPage(page)
      expect(await page.evaluate(() => location.pathname)).toBe(`/_project/${externalProject.id}`)
      await page.getByRole("button", { name: "Open HQ" }).click()
      await waitForHq(page)
      await page
        .locator('[data-yaade-hq-project]')
        .filter({ hasText: "alpha" })
        .getByRole("button", { name: "Launch agent in alpha" })
        .click()
      await page.locator('[data-yaade-agent-cli-option="codex"]').click()
      await page.locator("[data-yaade-mux]").waitFor({ state: "visible" })
      expect(await page.evaluate(() => location.pathname)).toBe("/alpha")
      await page
        .locator('[data-yaade-mux-pane-title][aria-label="Codex"]')
        .waitFor({ state: "visible" })
    } finally {
      await app.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
