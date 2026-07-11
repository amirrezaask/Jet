import net from "node:net"
import { spawn, spawnSync } from "node:child_process"
import path from "node:path"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { runUiSuite } from "./run-ui-suite.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, "../..")
const TAURI_DIR = path.join(REPO_ROOT, "apps/jet-tauri/src-tauri")
const E2E_CONF_PATH = path.join(TAURI_DIR, "tauri.e2e.conf.json")
const SAMPLE_WORKSPACE = path.join(REPO_ROOT, "fixtures/sample-workspace")
const binName = process.platform === "win32" ? "jet-tauri.exe" : "jet-tauri"
const appBinary = path.join(TAURI_DIR, "target", "release", binName)
const WEBDRIVER_PORT = 4445

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, ...opts.env },
  })
  if (result.status !== 0) {
    throw new Error(`command failed: ${cmd} ${args.join(" ")}`)
  }
}

function waitForPort(port, timeoutMs = 60_000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const socket = net.connect(port, "127.0.0.1")
      socket.once("connect", () => {
        socket.end()
        resolve()
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

let appProcess = null
try {
  run("node", ["apps/jet-tauri/scripts/cleanup-e2e-artifacts.mjs"], { cwd: REPO_ROOT })
  run("pnpm", ["--filter", "jet-tauri", "build"])
  run(
    "pnpm",
    ["exec", "tauri", "build", "--features", "e2e", "--config", E2E_CONF_PATH],
    { cwd: path.join(REPO_ROOT, "apps/jet-tauri") },
  )

  appProcess = spawn(appBinary, [SAMPLE_WORKSPACE], {
    env: {
      ...process.env,
      JET_E2E: "1",
      JET_E2E_USER_DATA: mkdtempSync(path.join(tmpdir(), "jet-tauri-e2e-")),
      TAURI_WEBDRIVER_PORT: String(WEBDRIVER_PORT),
      ...(process.env.JET_HEADED ? { JET_HEADED: process.env.JET_HEADED } : {}),
      ...(process.env.PWDEBUG ? { PWDEBUG: process.env.PWDEBUG } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  appProcess.stdout?.on("data", chunk => process.stdout.write(chunk))
  appProcess.stderr?.on("data", chunk => process.stderr.write(chunk))

  await waitForPort(WEBDRIVER_PORT)

  console.log("\nTauri UI E2E (node:http WebDriver)\n")
  await runUiSuite(WEBDRIVER_PORT)
  console.log("\nAll Tauri UI E2E specs passed.\n")
} finally {
  if (appProcess && !appProcess.killed) {
    appProcess.kill("SIGTERM")
    await new Promise(resolve => {
      const timer = setTimeout(() => {
        if (!appProcess.killed) appProcess.kill("SIGKILL")
        resolve()
      }, 5_000)
      appProcess.once("exit", () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}
