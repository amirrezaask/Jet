import net from "node:net"
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
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
const CONF_PATH = path.join(TAURI_DIR, "tauri.conf.json")
const E2E_CAP_TEMPLATE = path.join(REPO_ROOT, "tests/tauri/e2e-capability.json")
const E2E_CAP_PATH = path.join(TAURI_DIR, "capabilities/e2e.json")
const binName = process.platform === "win32" ? "jet-tauri.exe" : "jet-tauri"
const APP_BINARY = path.join(TAURI_DIR, "target", "release", binName)

let buildDone = process.env.JET_TAURI_E2E_BUILT === "1"
let confBackup: string | null = null

function run(cmd: string, args: string[], cwd = REPO_ROOT): void {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", env: process.env })
  if (result.status !== 0) throw new Error(`command failed: ${cmd} ${args.join(" ")}`)
}

function enableE2eCapability(): void {
  const raw = fs.readFileSync(CONF_PATH, "utf8")
  const conf = JSON.parse(raw)
  if (!conf.app.security.capabilities.includes("e2e")) {
    fs.copyFileSync(E2E_CAP_TEMPLATE, E2E_CAP_PATH)
    conf.app.security.capabilities.push("e2e")
    fs.writeFileSync(CONF_PATH, `${JSON.stringify(conf, null, 2)}\n`)
    confBackup = raw
  }
}

export function restoreTauriE2eConf(): void {
  if (confBackup != null) {
    fs.writeFileSync(CONF_PATH, confBackup)
    confBackup = null
  }
  try {
    fs.unlinkSync(E2E_CAP_PATH)
  } catch {
    /* gone */
  }
}

export function ensureTauriE2eBuild(): void {
  if (buildDone) return
  run("node", ["apps/jet-tauri/scripts/cleanup-e2e-artifacts.mjs"])
  enableE2eCapability()
  run("pnpm", ["--filter", "jet-tauri", "build"])
  run("pnpm", ["exec", "tauri", "build", "--features", "e2e"], path.join(REPO_ROOT, "apps/jet-tauri"))
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

let portCounter = 4445

export type LaunchTauriOptions = {
  workspaceRel?: string
  launchWithoutWorkspace?: boolean
}

export async function launchTauri(
  workspaceRelOrOpts: string | LaunchTauriOptions = "fixtures/sample-workspace",
): Promise<LaunchShellResult> {
  ensureTauriE2eBuild()

  const opts: LaunchTauriOptions =
    typeof workspaceRelOrOpts === "string" ? { workspaceRel: workspaceRelOrOpts } : workspaceRelOrOpts
  const workspacePath = resolve(REPO_ROOT, opts.workspaceRel ?? "fixtures/sample-workspace")
  const port = portCounter++
  const pathEnv = ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? ""].join(":")

  const args = opts.launchWithoutWorkspace ? [] : [workspacePath]
  const proc = spawn(APP_BINARY, args, {
    env: {
      ...process.env,
      PATH: pathEnv,
      JET_E2E: "1",
      JET_E2E_USER_DATA: mkdtempSync(path.join(tmpdir(), "jet-tauri-e2e-")),
      TAURI_WEBDRIVER_PORT: String(port),
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
      await wd.deleteSession()
      if (!proc.killed) {
        proc.kill("SIGTERM")
        await new Promise<void>(resolveClose => {
          const timer = setTimeout(() => {
            if (!proc.killed) proc.kill("SIGKILL")
            resolveClose()
          }, 5_000)
          proc.once("exit", () => {
            clearTimeout(timer)
            resolveClose()
          })
        })
      }
    },
  }

  return { app, page }
}
