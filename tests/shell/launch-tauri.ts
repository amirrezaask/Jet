import net from "node:net"
import { spawn, spawnSync } from "node:child_process"
import path from "node:path"
import { resolve } from "node:path"
import { tmpdir } from "node:os"
import { mkdtempSync } from "node:fs"
import { createRequire } from "node:module"
import { wrapTauriWebDriver } from "./tauri-driver.js"
import type { LaunchShellResult, ShellApp } from "./driver.js"

const { createWebDriver, waitForJetReady } = createRequire(__filename)("../tauri/webdriver.cjs") as {
  createWebDriver: (port?: number) => ReturnType<typeof createWebDriver>
  waitForJetReady: (wd: { waitUntil: Function; execute: Function; executeAsync: Function }) => Promise<void>
}

export const REPO_ROOT = resolve(__dirname, "..", "..")
const TAURI_DIR = path.join(REPO_ROOT, "apps/jet-tauri/src-tauri")
const E2E_CONF_PATH = path.join(TAURI_DIR, "tauri.e2e.conf.json")
const binName = process.platform === "win32" ? "jet-tauri.exe" : "jet-tauri"
const APP_BINARY = path.join(TAURI_DIR, "target", "release", binName)

let buildDone = process.env.JET_TAURI_E2E_BUILT === "1"

function run(cmd: string, args: string[], cwd = REPO_ROOT): void {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", env: process.env })
  if (result.status !== 0) throw new Error(`command failed: ${cmd} ${args.join(" ")}`)
}

export function ensureTauriE2eBuild(): void {
  if (buildDone) return
  run("pnpm", ["--filter", "jet-tauri", "build"])
  run(
    "pnpm",
    ["exec", "tauri", "build", "--features", "e2e", "--config", E2E_CONF_PATH],
    path.join(REPO_ROOT, "apps/jet-tauri"),
  )
  buildDone = true
  process.env.JET_TAURI_E2E_BUILT = "1"
}

function waitForPort(port: number, timeoutMs = 60_000): Promise<void> {
  const started = Date.now()
  return new Promise((resolvePort, reject) => {
    const tick = () => {
      const socket = net.connect(port, "127.0.0.1")
      socket.once("connect", () => {
        socket.end()
        resolvePort()
      })
      socket.once("error", () => {
        socket.destroy()
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`timed out waiting for WebDriver port ${port}`))
          return
        }
        setTimeout(tick, 250)
      })
    }
    tick()
  })
}

let launchSerial = 0

function allocateWebDriverPort(): number {
  const worker = Number(process.env.TEST_WORKER_INDEX ?? 0)
  const serial = launchSerial++ % 40
  return 4445 + worker * 100 + serial
}

export type LaunchTauriOptions = {
  workspaceRel?: string
  launchWithoutWorkspace?: boolean
}

function clearConflictingTauriInstances(): void {
  // E2E builds omit single-instance, so a user's installed Jet-Tauri.app is safe.
  // Only clear stale release E2E binaries that may still hold WebDriver ports.
  spawnSync("pkill", ["-f", "target/release/jet-tauri"], { stdio: "ignore" })
  spawnSync("sleep", ["0.3"], { stdio: "ignore" })
}

export async function launchTauri(
  workspaceRelOrOpts: string | LaunchTauriOptions = "fixtures/sample-workspace",
): Promise<LaunchShellResult> {
  ensureTauriE2eBuild()
  clearConflictingTauriInstances()

  const opts: LaunchTauriOptions =
    typeof workspaceRelOrOpts === "string" ? { workspaceRel: workspaceRelOrOpts } : workspaceRelOrOpts
  const workspacePath = resolve(REPO_ROOT, opts.workspaceRel ?? "fixtures/sample-workspace")
  const port = allocateWebDriverPort()
  const pathEnv = ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? ""].join(":")

  const args = opts.launchWithoutWorkspace ? [] : [workspacePath]
  const proc = spawn(APP_BINARY, args, {
    env: {
      ...process.env,
      PATH: pathEnv,
      JET_E2E: "1",
      JET_E2E_USER_DATA: mkdtempSync(path.join(tmpdir(), "jet-tauri-e2e-")),
      TAURI_WEBDRIVER_PORT: String(port),
      ...(process.env.JET_HEADED ? { JET_HEADED: process.env.JET_HEADED } : {}),
      ...(process.env.PWDEBUG ? { PWDEBUG: process.env.PWDEBUG } : {}),
    },
    stdio: "ignore",
  })

  await waitForPort(port)

  const wd = createWebDriver(port)
  await wd.newSession()
  await waitForJetReady(wd)
  const page = wrapTauriWebDriver(wd)

  const app: ShellApp = {
    close: async () => {
      try {
        await wd.execute(async () => {
          const currentWindow = window.__TAURI__?.window?.getCurrentWindow?.()
          await currentWindow?.close()
        })
      } catch {
        /* the WebView can disappear before the command response */
      }
      await wd.deleteSession()
      if (!proc.killed) {
        await new Promise<void>(resolveClose => {
          const terminateTimer = setTimeout(() => {
            if (!proc.killed) proc.kill("SIGTERM")
          }, 1_000)
          const killTimer = setTimeout(() => {
            if (!proc.killed) proc.kill("SIGKILL")
            resolveClose()
          }, 5_000)
          proc.once("exit", () => {
            clearTimeout(terminateTimer)
            clearTimeout(killTimer)
            resolveClose()
          })
          if (proc.exitCode != null) {
            clearTimeout(terminateTimer)
            clearTimeout(killTimer)
            resolveClose()
          }
        })
      }
    },
  }

  return { app, page }
}
