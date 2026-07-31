import { chromium } from "@playwright/test"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { wrapPlaywrightPage } from "./playwright-driver.js"
import type { LaunchShellResult } from "./driver.js"

const REPO_ROOT = path.resolve(__dirname, "../..")
const HOST_SERVER_ENTRY = path.join(REPO_ROOT, "apps/host-server/src/bin.ts")

function resolveTsxCli(): string {
  const candidates = [
    process.env.GHARARGAH_TSX_CLI,
    path.join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs"),
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  const pnpmDir = path.join(REPO_ROOT, "node_modules/.pnpm")
  if (fs.existsSync(pnpmDir)) {
    for (const name of fs.readdirSync(pnpmDir)) {
      if (!name.startsWith("tsx@")) continue
      const candidate = path.join(pnpmDir, name, "node_modules/tsx/dist/cli.mjs")
      if (fs.existsSync(candidate)) return candidate
    }
  }
  throw new Error(`tsx CLI missing; run pnpm install from repo root`)
}

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
      server.close(error => (error ? reject(error) : resolve(address.port)))
    })
  })
}

async function waitForHttpOk(url: string, proc: ChildProcessWithoutNullStreams, logs: () => string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`process exited (${proc.exitCode})\n${logs()}`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      /* startup */
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`timed out waiting for ${url}\n${logs()}`)
}

function attachLogs(proc: ChildProcessWithoutNullStreams): () => string {
  let logs = ""
  proc.stdout.on("data", chunk => {
    logs += chunk.toString()
  })
  proc.stderr.on("data", chunk => {
    logs += chunk.toString()
  })
  return () => logs
}

async function killProc(proc: ChildProcessWithoutNullStreams): Promise<void> {
  if (proc.exitCode !== null) return
  proc.kill("SIGTERM")
  await new Promise<void>(resolve => {
    const force = setTimeout(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL")
    }, 1_000)
    proc.once("exit", () => {
      clearTimeout(force)
      resolve()
    })
    setTimeout(resolve, 2_500)
  })
  if (proc.exitCode === null) proc.kill("SIGKILL")
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
  const workspace = isFixture
    ? path.join(temporaryRoot, path.basename(sourceWorkspace))
    : sourceWorkspace
  if (isFixture && !fs.existsSync(workspace)) fs.cpSync(sourceWorkspace, workspace, { recursive: true })
  if (!fs.existsSync(HOST_SERVER_ENTRY)) {
    throw new Error(`Host server entry missing at ${HOST_SERVER_ENTRY}`)
  }
  const tsxCli = resolveTsxCli()

  const sharedEnv = {
    ...process.env,
    JET_ALLOWED_ROOTS: `${REPO_ROOT},${temporaryRoot},${path.dirname(sourceWorkspace)}`,
    GHARARGAH_E2E: "1",
    ...options.env,
  }

  const server = spawn(
    process.execPath,
    [
      tsxCli,
      HOST_SERVER_ENTRY,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--data-dir",
      serverData,
      workspace,
    ],
    {
      cwd: REPO_ROOT,
      env: sharedEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  ) as ChildProcessWithoutNullStreams
  const jetLogs = attachLogs(server)
  const url = `http://127.0.0.1:${port}`
  await waitForHttpOk(`${url}/health`, server, jetLogs)

  const context = await chromium.launchPersistentContext(browserData, {
    headless: process.env.GHARARGAH_HEADED !== "1",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark",
  })
  const browserPage = context.pages()[0] ?? (await context.newPage())
  const errors: string[] = []
  browserPage.on("pageerror", error => errors.push(error.stack ?? error.message))
  browserPage.on("console", message => {
    if (message.type() === "error") {
      const location = message.location()
      const source = location.url
        ? ` (${location.url}:${location.lineNumber + 1}:${location.columnNumber + 1})`
        : ""
      errors.push(`${message.text()}${source}`)
    }
  })

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
        await context.close().catch(() => {})
        await killProc(server)
        if (errors.length) process.stderr.write(`Browser console errors:\n${errors.join("\n")}\n`)
      },
    },
  }
}
