import { chromium } from "@playwright/test"
import { spawn } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { wrapPlaywrightPage } from "./playwright-driver.js"
import type { LaunchShellResult } from "./driver.js"

const REPO_ROOT = path.resolve(__dirname, "../..")
const JET_BINARY = path.join(REPO_ROOT, "apps/server/target/debug/jet")
const MOCK_ACP_BINARY = path.join(REPO_ROOT, "apps/server/target/debug/gharargah-mock-acp")

type LaunchWebOptions = {
  workspaceRel?: string
  env?: Record<string, string>
  userDataDir?: string
  launchWithoutWorkspace?: boolean
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") return reject(new Error("no test port"))
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

export async function launchWeb(options: LaunchWebOptions = {}): Promise<LaunchShellResult> {
  const port = await freePort()
  const temporaryRoot = options.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "jet-web-e2e-"))
  const browserData = path.join(temporaryRoot, "browser")
  const serverData = path.join(temporaryRoot, "server")
  fs.mkdirSync(browserData, { recursive: true })
  fs.mkdirSync(serverData, { recursive: true })
  const sourceWorkspace = path.resolve(REPO_ROOT, options.workspaceRel ?? "fixtures/sample-workspace")
  const isFixture = sourceWorkspace.startsWith(path.join(REPO_ROOT, "fixtures") + path.sep)
  const workspace = isFixture ? path.join(temporaryRoot, path.basename(sourceWorkspace)) : sourceWorkspace
  if (isFixture && !fs.existsSync(workspace)) fs.cpSync(sourceWorkspace, workspace, { recursive: true })
  if (!fs.existsSync(JET_BINARY)) {
    throw new Error(`Jet binary missing at ${JET_BINARY}; run cargo build --manifest-path apps/server/Cargo.toml`)
  }
  if (!fs.existsSync(MOCK_ACP_BINARY)) {
    throw new Error(
      `Mock ACP binary missing at ${MOCK_ACP_BINARY}; run cargo build --manifest-path apps/server/Cargo.toml --bin gharargah-mock-acp`,
    )
  }
  const server = spawn(JET_BINARY, ["--host", "127.0.0.1", "--port", String(port), "--data-dir", serverData, workspace], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      JET_ALLOWED_ROOTS: `${REPO_ROOT},${temporaryRoot},${path.dirname(sourceWorkspace)}`,
      GHARARGAH_E2E: "1",
      // Real stdio ACP mock — never rely on PATH discovery next to jet alone.
      GHARARGAH_MOCK_ACP_BIN: MOCK_ACP_BINARY,
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let logs = ""
  server.stdout.on("data", chunk => { logs += chunk.toString() })
  server.stderr.on("data", chunk => { logs += chunk.toString() })
  const url = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Jet server exited (${server.exitCode})\n${logs}`)
    try {
      const response = await fetch(`${url}/health`)
      if (response.ok) break
    } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  if (Date.now() >= deadline) throw new Error(`Jet server did not become ready\n${logs}`)

  const context = await chromium.launchPersistentContext(browserData, { headless: process.env.GHARARGAH_HEADED !== "1" })
  const browserPage = context.pages()[0] ?? await context.newPage()
  const errors: string[] = []
  browserPage.on("pageerror", error => errors.push(error.message))
  browserPage.on("console", message => { if (message.type() === "error") errors.push(message.text()) })
  await browserPage.goto(url, { waitUntil: "domcontentloaded" })
  await browserPage.waitForFunction(() => window.__gharargahAgent != null, null, { timeout: 30_000 })
  await browserPage.evaluate(() => window.__gharargahAgent!.waitForReady())
  if (!options.launchWithoutWorkspace) {
    await browserPage.waitForFunction(
      () => (window.__gharargahAgent?.listWorkspaces().length ?? 0) > 0,
      null,
      { timeout: 30_000 },
    )
  }

  return {
    page: wrapPlaywrightPage(browserPage),
    app: {
      async close() {
        await context.close()
        if (server.exitCode === null) server.kill("SIGTERM")
        await new Promise<void>(resolve => {
          if (server.exitCode !== null) return resolve()
          const force = setTimeout(() => {
            if (server.exitCode === null) server.kill("SIGKILL")
          }, 2_000)
          server.once("exit", () => {
            clearTimeout(force)
            resolve()
          })
        })
        if (errors.length) process.stderr.write(`Browser console errors:\n${errors.join("\n")}\n`)
      },
    },
  }
}
