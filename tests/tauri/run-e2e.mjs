import net from "node:net"
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runUiSuite } from "./run-ui-suite.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, "../..")
const TAURI_DIR = path.join(REPO_ROOT, "apps/jet-tauri/src-tauri")
const CONF_PATH = path.join(TAURI_DIR, "tauri.conf.json")
const E2E_CAP_TEMPLATE = path.join(__dirname, "e2e-capability.json")
const E2E_CAP_PATH = path.join(TAURI_DIR, "capabilities/e2e.json")
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

function enableE2eCapability() {
  const raw = fs.readFileSync(CONF_PATH, "utf8")
  const conf = JSON.parse(raw)
  const caps = conf.app.security.capabilities
  fs.copyFileSync(E2E_CAP_TEMPLATE, E2E_CAP_PATH)
  let confBackup = null
  if (!caps.includes("e2e")) {
    caps.push("e2e")
    fs.writeFileSync(CONF_PATH, `${JSON.stringify(conf, null, 2)}\n`)
    confBackup = raw
  }
  return { confBackup }
}

function restoreConf(backup) {
  if (backup?.confBackup != null) {
    fs.writeFileSync(CONF_PATH, backup.confBackup)
  }
  try {
    fs.unlinkSync(E2E_CAP_PATH)
  } catch {
    /* already removed */
  }
}

let backup = null
let appProcess = null
try {
  run("node", ["apps/jet-tauri/scripts/cleanup-e2e-artifacts.mjs"], { cwd: REPO_ROOT })
  backup = enableE2eCapability()

  run("pnpm", ["--filter", "jet-tauri", "build"])
  run("pnpm", ["exec", "tauri", "build", "--features", "e2e"], {
    cwd: path.join(REPO_ROOT, "apps/jet-tauri"),
  })

  appProcess = spawn(appBinary, [SAMPLE_WORKSPACE], {
    env: {
      ...process.env,
      TAURI_WEBDRIVER_PORT: String(WEBDRIVER_PORT),
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
  restoreConf(backup)
}
