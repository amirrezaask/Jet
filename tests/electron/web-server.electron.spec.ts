import { expect, test } from "@playwright/test"
import { launchJet, waitForHome, waitForMux } from "./_launch.js"

test.describe("single-binary web server", () => {
  test("tears down, then rejects unexpected browser console errors", async () => {
    const { app, page } = await launchJet({ projectPage: true })
    await page.evaluate(() => {
      console.error("YAADE_E2E_UNEXPECTED_CONSOLE_SENTINEL")
    })
    await expect(app.close()).rejects.toThrow(
      /Unexpected browser failures:[\s\S]*YAADE_E2E_UNEXPECTED_CONSOLE_SENTINEL/,
    )
  })

  test("serves the SPA, health, system, WS, and workspace-session API", async ({}, testInfo) => {
    const { app, page } = await launchJet({
      expectedHttpErrors: [
        { method: "GET", path: "/api/v1/workspace-session", status: 403 },
        { method: "GET", path: "/api/v1/workspace-session", status: 404 },
      ],
    })
    try {
      await waitForHome(page)
      await waitForMux(page)
      const result = await page.evaluate(async () => {
        const health = await fetch("/health")
        const system = await fetch("/api/v1/system")
        const systemBody = (await system.json()) as {
          homeDir?: string
          machineHostname?: string
        }
        const deepRoute = await fetch("/dev/example")
        const websocket = await new Promise<string>((resolve, reject) => {
          const protocol = location.protocol === "https:" ? "wss:" : "ws:"
          const socket = new WebSocket(`${protocol}//${location.host}/ws?since=0`)
          socket.addEventListener("open", () => socket.send("ping"))
          socket.addEventListener("message", event => {
            if (event.data === "pong") {
              socket.close()
              resolve("pong")
            }
          })
          socket.addEventListener("error", () => reject(new Error("WebSocket failed")))
        })
        const sessionGet = await fetch(
          `/api/v1/workspace-session?root=${encodeURIComponent(systemBody.homeDir ?? "/")}`,
        )
        return {
          health: health.status,
          system: system.status,
          homeDir: typeof systemBody.homeDir === "string",
          deepRoute: deepRoute.status,
          deepContentType: deepRoute.headers.get("content-type"),
          websocket,
          sessionGet: sessionGet.status,
        }
      })
      expect(result.health).toBe(200)
      expect(result.system).toBe(200)
      expect(result.homeDir).toBe(true)
      expect(result.deepRoute).toBe(200)
      expect(result.deepContentType).toContain("text/html")
      expect(result.websocket).toBe("pong")
      expect([200, 403, 404]).toContain(result.sessionGet)
      await page.reload()
      await waitForMux(page)
      await testInfo.attach("mux-after-reload", {
        body: Buffer.from(await page.screenshot(), "base64"),
        contentType: "image/png",
      })
    } finally {
      await app.close()
    }
  })

  test("rejects removed agents:* host RPC without aborting the server", async () => {
    const { app, page } = await launchJet({
      expectedHttpErrors: [{ method: "POST", path: "/api/v1/rpc", status: 400 }],
    })
    try {
      await waitForHome(page)
      const result = await page.evaluate(async () => {
        const response = await fetch("/api/v1/rpc", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            channel: "agents:listAgents",
            args: [],
          }),
        })
        const health = await fetch("/health")
        return {
          rpcStatus: response.status,
          errorCode: (await response.json()).error?.code,
          healthStatus: health.status,
        }
      })

      expect(result).toEqual({
        rpcStatus: 400,
        errorCode: "UNKNOWN_OPERATION",
        healthStatus: 200,
      })
    } finally {
      await app.close()
    }
  })
})
