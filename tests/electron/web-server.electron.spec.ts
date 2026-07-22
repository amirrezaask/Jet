import { expect, test } from "@playwright/test"
import { launchJet, waitForHome } from "./_launch.js"

test.describe("single-binary web server", () => {
  test("serves the SPA, API, WebSocket, persistence, and file conflict boundary", async ({}, testInfo) => {
    const { app, page } = await launchJet()
    try {
      await waitForHome(page)
      await page.waitForFunction(async () => {
        const projects = await fetch("/api/v1/projects").then(response => response.json()) as unknown[]
        return projects.length > 0
      }, null, { timeout: 10_000 })
      const result = await page.evaluate(async () => {
        const health = await fetch("/health")
        const system = await fetch("/api/v1/system")
        const deepRoute = await fetch("/projects/example")
        const projects = await fetch("/api/v1/projects").then(response => response.json()) as Array<{ id: string; rootPath: string }>
        const project = projects[0]
        const file = await fetch(`/api/v1/projects/${project.id}/file?path=package.json`)
        const conflict = await fetch(`/api/v1/projects/${project.id}/file`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: "package.json", content: "{}", expectedVersion: "stale" }),
        })
        const websocket = await new Promise<string>((resolve, reject) => {
          const protocol = location.protocol === "https:" ? "wss:" : "ws:"
          const socket = new WebSocket(`${protocol}//${location.host}/ws?since=0`)
          socket.addEventListener("open", () => socket.send("ping"))
          socket.addEventListener("message", event => {
            if (event.data === "pong") { socket.close(); resolve("pong") }
          })
          socket.addEventListener("error", () => reject(new Error("WebSocket failed")))
        })
        return {
          health: health.status,
          system: system.status,
          deepRoute: deepRoute.status,
          deepContentType: deepRoute.headers.get("content-type"),
          projects: projects.length,
          file: file.status,
          conflict: conflict.status,
          websocket,
        }
      })
      expect(result).toEqual({
        health: 200,
        system: 200,
        deepRoute: 200,
        deepContentType: "text/html",
        projects: 1,
        file: 200,
        conflict: 409,
        websocket: "pong",
      })
      await page.reload()
      await waitForHome(page)
      await page.waitForSelector('[data-gharargah-project-name="sample-workspace"]', { timeout: 10_000 })
      expect(await page.count('[data-gharargah-project-name="sample-workspace"]')).toBeGreaterThan(0)
      await testInfo.attach("home-after-reload", {
        body: Buffer.from(await page.screenshot(), "base64"),
        contentType: "image/png",
      })
    } finally {
      await app.close()
    }
  })

  test("server-owned mock agent continues through browser reload", async () => {
    const { app, page } = await launchJet({ env: { GHARARGAH_AGENT_MOCK: "1" } })
    try {
      await waitForHome(page)
      const started = await page.evaluate(async () => {
        const path = window.__gharargahAgent!.getState().activeWorkspace!
        const uri = `file://${path}`
        const agents = window.gharargah!.agents!
        const thread = await agents.createThread({
          workspaceRootUri: uri,
          workspaceRootPath: path,
          provider: "cursor",
          model: "auto",
          title: "Reload test",
        })
        await agents.sendMessage({
          workspaceRootUri: uri,
          workspaceRootPath: path,
          threadId: thread.id,
          text: "continue after reload",
        })
        return { id: thread.id, path, uri }
      })
      await page.reload()
      await waitForHome(page)
      await expect.poll(() => page.evaluate(async input => {
        return (await window.gharargah!.agents!.readThread(input.uri, input.path, input.id))?.status
      }, started), { timeout: 10_000 }).toBe("idle")
      const text = await page.evaluate(async input => {
        const thread = await window.gharargah!.agents!.readThread(input.uri, input.path, input.id)
        return thread?.messages.map(message => message.text).join("\n") ?? ""
      }, started)
      expect(text).toContain("Mock agent reply: continue after reload")
    } finally {
      await app.close()
    }
  })
})
