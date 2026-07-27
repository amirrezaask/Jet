import { chromium } from "@playwright/test"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { wrapPlaywrightPage } from "./playwright-driver.js"
import type { LaunchShellResult } from "./driver.js"

const REPO_ROOT = path.resolve(__dirname, "../..")
const JET_BINARY = path.join(REPO_ROOT, "apps/server/target/debug/jet")
const MOCK_ACP_BINARY = path.join(REPO_ROOT, "apps/server/target/debug/gharargah-mock-acp")
const MOCK_CODEX_APP_SERVER_BINARY = path.join(
  REPO_ROOT,
  "apps/server/target/debug/gharargah-mock-line-rpc",
)
const MOCK_CLAUDE_SDK_BINARY = path.join(
  REPO_ROOT,
  "apps/server/target/debug/gharargah-mock-claude-sdk",
)
const AGENT_SERVER_ENTRY = path.join(REPO_ROOT, "apps/agent-server/src/bin.ts")

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
  const agentPort = await freePort()
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
  if (!fs.existsSync(JET_BINARY)) {
    throw new Error(
      `Jet binary missing at ${JET_BINARY}; run cargo build --manifest-path apps/server/Cargo.toml`,
    )
  }
  if (!fs.existsSync(MOCK_ACP_BINARY)) {
    throw new Error(
      `Mock ACP binary missing at ${MOCK_ACP_BINARY}; run cargo build --manifest-path apps/server/Cargo.toml --bin gharargah-mock-acp`,
    )
  }
  if (!fs.existsSync(MOCK_CLAUDE_SDK_BINARY)) {
    throw new Error(
      `Mock Claude SDK binary missing at ${MOCK_CLAUDE_SDK_BINARY}; run cargo build --manifest-path apps/server/Cargo.toml --bin gharargah-mock-claude-sdk`,
    )
  }
  if (!fs.existsSync(MOCK_CODEX_APP_SERVER_BINARY)) {
    throw new Error(
      `Mock Codex app-server binary missing at ${MOCK_CODEX_APP_SERVER_BINARY}; run cargo build --manifest-path apps/server/Cargo.toml --bin gharargah-mock-line-rpc`,
    )
  }
  if (!fs.existsSync(AGENT_SERVER_ENTRY)) {
    throw new Error(`agent-server entry missing; run pnpm install from repo root`)
  }
  const tsxCli = resolveTsxCli()

  const sharedEnv = {
    ...process.env,
    JET_ALLOWED_ROOTS: `${REPO_ROOT},${temporaryRoot},${path.dirname(sourceWorkspace)}`,
    GHARARGAH_E2E: "1",
    GHARARGAH_AGENT_RUNTIME: "effect",
    GHARARGAH_AGENT_HOST: "127.0.0.1",
    GHARARGAH_AGENT_PORT: String(agentPort),
    GHARARGAH_AGENT_WS_URL: `ws://127.0.0.1:${agentPort}/agents`,
    GHARARGAH_MOCK_ACP_BIN: MOCK_ACP_BINARY,
    GHARARGAH_MOCK_CODEX_APP_SERVER_BIN: MOCK_CODEX_APP_SERVER_BINARY,
    GHARARGAH_MOCK_CLAUDE_SDK_BIN: MOCK_CLAUDE_SDK_BINARY,
    ...options.env,
  }

  // Pin agent-server to same node as this launcher (avoids better-sqlite3 ABI mismatch).
  const agentServer = spawn(process.execPath, [tsxCli, AGENT_SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: sharedEnv,
    stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams
  const agentLogs = attachLogs(agentServer)
  await waitForHttpOk(`http://127.0.0.1:${agentPort}/health`, agentServer, agentLogs)

  const server = spawn(
    JET_BINARY,
    ["--host", "127.0.0.1", "--port", String(port), "--data-dir", serverData, workspace],
    {
      cwd: REPO_ROOT,
      env: sharedEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  const jetLogs = attachLogs(server)
  const url = `http://127.0.0.1:${port}`
  await waitForHttpOk(`${url}/health`, server, () => `${jetLogs()}\n--- agent ---\n${agentLogs()}`)

  const context = await chromium.launchPersistentContext(browserData, {
    headless: process.env.GHARARGAH_HEADED !== "1",
  })
  const browserPage = context.pages()[0] ?? (await context.newPage())
  const errors: string[] = []
  browserPage.on("pageerror", error => errors.push(error.message))
  browserPage.on("console", message => {
    if (message.type() === "error") errors.push(message.text())
  })

  const agentWsUrl = `ws://127.0.0.1:${agentPort}/agents`
  await browserPage.addInitScript((wsUrl: string) => {
    ;(window as Window & { __GHARARGAH_AGENT_WS_URL__?: string }).__GHARARGAH_AGENT_WS_URL__ = wsUrl
  }, agentWsUrl)

  await browserPage.goto(url, { waitUntil: "domcontentloaded" })
  await browserPage.waitForFunction(() => window.__gharargahAgent != null, null, { timeout: 30_000 })
  await browserPage.evaluate(() => window.__gharargahAgent!.waitForReady())
  // Prove Effect agent-server is reachable from the page context.
  const agentOk = await browserPage.evaluate(async (wsUrl: string) => {
    return await new Promise<boolean>(resolve => {
      try {
        const ws = new WebSocket(wsUrl)
        const t = setTimeout(() => {
          try {
            ws.close()
          } catch {
            /* ignore */
          }
          resolve(false)
        }, 8_000)
        ws.addEventListener("open", () => {
          ws.send(JSON.stringify({ id: 1, method: "health", params: [] }))
        })
        ws.addEventListener("message", ev => {
          try {
            const msg = JSON.parse(String(ev.data)) as { id?: number; result?: { ok?: boolean } }
            if (msg.id === 1 && msg.result?.ok) {
              clearTimeout(t)
              ws.close()
              resolve(true)
            }
          } catch {
            /* ignore */
          }
        })
        ws.addEventListener("error", () => {
          clearTimeout(t)
          resolve(false)
        })
      } catch {
        resolve(false)
      }
    })
  }, agentWsUrl)
  if (!agentOk) {
    throw new Error(
      `Effect agent-server not reachable at ${agentWsUrl}\n${jetLogs()}\n--- agent ---\n${agentLogs()}`,
    )
  }
  // Guard against vite-baked ws://127.0.0.1:4751 stealing traffic from the E2E sidecar.
  const appAgentUrl = await browserPage.evaluate(async () => {
    const injected =
      (window as Window & { __GHARARGAH_AGENT_WS_URL__?: string }).__GHARARGAH_AGENT_WS_URL__ ?? null
    try {
      const health = await window.gharargah?.agents?.getConnectionState?.(
        "file:///tmp",
        "/tmp",
        "probe",
      )
      void health
    } catch {
      /* method optional */
    }
    return injected
  })
  if (!appAgentUrl || appAgentUrl !== agentWsUrl) {
    throw new Error(
      `E2E agent WS mismatch: injected=${appAgentUrl} expected=${agentWsUrl}. ` +
        `App may be talking to a stale vite-baked 4751 server.`,
    )
  }
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
        await killProc(agentServer)
        if (errors.length) process.stderr.write(`Browser console errors:\n${errors.join("\n")}\n`)
      },
    },
  }
}
