import { _electron as electron } from "@playwright/test"
import { resolve } from "node:path"
import { execSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { wrapPlaywrightPage } from "../shell/playwright-driver.js"
import { launchTauri } from "../shell/launch-tauri.js"
import type { LaunchShellResult, ShellDriver } from "../shell/driver.js"

export type { ShellDriver }
export type LaunchJetOptions = {
  workspaceRel?: string
  env?: Record<string, string>
  userDataDir?: string
  launchWithoutWorkspace?: boolean
}

export const REPO_ROOT = resolve(__dirname, "..", "..")
export const DESKTOP_DIR = resolve(REPO_ROOT, "apps/jet-desktop")
export const MAIN_JS = resolve(DESKTOP_DIR, "dist-electron/main.js")
export const SAMPLE = "fixtures/sample-workspace"

let ptySpawnAvailable: boolean | null = null

export function hasPtySpawn(): boolean {
  if (ptySpawnAvailable != null) return ptySpawnAvailable
  try {
    const { spawn } = require(require.resolve("node-pty", { paths: [DESKTOP_DIR] })) as typeof import("node-pty")
    const shell = process.env.SHELL || "/bin/zsh"
    const pty = spawn(shell, ["-il"], {
      name: "xterm-256color",
      cwd: process.env.HOME || "/",
      env: process.env as Record<string, string>,
      cols: 80,
      rows: 24,
    })
    pty.kill()
    ptySpawnAvailable = true
  } catch {
    ptySpawnAvailable = false
  }
  return ptySpawnAvailable
}

export function hasTypescriptLanguageServer(): boolean {
  try {
    execSync("typescript-language-server --version", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

export function hasCursorAgent(): boolean {
  try {
    execSync("which cursor-agent", { stdio: "ignore" })
    return true
  } catch {
    try {
      execSync("which agent", { stdio: "ignore" })
      return true
    } catch {
      return false
    }
  }
}

function isTauriShell(): boolean {
  return process.env.JET_SHELL === "tauri" || process.env.PLAYWRIGHT_PROJECT_NAME === "tauri-e2e"
}

export async function launchJet(
  workspaceRelOrOpts: string | LaunchJetOptions = SAMPLE,
): Promise<LaunchShellResult> {
  if (isTauriShell()) {
    const opts: LaunchJetOptions =
      typeof workspaceRelOrOpts === "string" ? { workspaceRel: workspaceRelOrOpts } : workspaceRelOrOpts
    return launchTauri(opts)
  }

  const opts: LaunchJetOptions =
    typeof workspaceRelOrOpts === "string" ? { workspaceRel: workspaceRelOrOpts } : workspaceRelOrOpts
  const workspaceRel = opts.workspaceRel ?? SAMPLE
  const workspacePath = resolve(REPO_ROOT, workspaceRel)
  const userDataDir = opts.userDataDir ?? mkdtempSync(resolve(tmpdir(), "jet-e2e-"))
  const pathEnv = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH ?? "",
  ].join(":")
  const workerStaggerMs = Number(process.env.TEST_PARALLEL_INDEX ?? 0) * 400
  if (workerStaggerMs > 0) {
    await new Promise(r => setTimeout(r, workerStaggerMs))
  }
  const app = await electron.launch({
    args: opts.launchWithoutWorkspace ? [MAIN_JS] : [MAIN_JS, "--", workspacePath],
    cwd: DESKTOP_DIR,
    env: {
      ...process.env,
      ...opts.env,
      PATH: pathEnv,
      JET_E2E: "1",
      JET_E2E_USER_DATA: userDataDir,
      ...(process.env.JET_HEADED ? { JET_HEADED: process.env.JET_HEADED } : {}),
      ...(process.env.PWDEBUG ? { PWDEBUG: process.env.PWDEBUG } : {}),
    },
  })

  const rawPage = await waitForAppPage(app)
  await rawPage.waitForLoadState("domcontentloaded")
  await rawPage.waitForFunction(() => window.__jetAgent != null, null, { timeout: 30_000 })
  await rawPage.evaluate(async () => {
    await window.__jetAgent!.waitForReady()
  })
  const page = wrapPlaywrightPage(rawPage)
  return {
    app: { close: () => app.close() },
    page,
  }
}

/** Playwright may surface DevTools as firstWindow(); pick the renderer shell. */
async function waitForAppPage(app: Awaited<ReturnType<typeof electron.launch>>) {
  for (let i = 0; i < 120; i++) {
    for (const win of app.windows()) {
      const url = win.url()
      if (url.startsWith("devtools://")) continue
      if (url.startsWith("file://") || url.startsWith("http://")) return win
    }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error("Electron app window not found (only DevTools?)")
}

export async function openFixtureFile(page: ShellDriver, rel: string): Promise<void> {
  await page.evaluate(async (f: string) => {
    await window.__jetAgent!.openFile(f)
    await window.__jetAgent!.waitForEditor()
  }, rel)
  await focusEditor(page)
}

export async function focusEditor(page: ShellDriver): Promise<void> {
  await page.locator(".cm-content").first().click({ timeout: 10_000 })
}

export async function waitForDialog(page: ShellDriver, timeoutMs = 30_000): Promise<void> {
  await page.locator('[role="dialog"]').first().waitFor({ state: "visible", timeout: timeoutMs })
}

export async function openQuickOpen(page: ShellDriver): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    await execCommand(page, "workspace.quickOpen")
    try {
      await waitForDialog(page, 2_000)
      return
    } catch {
      await page.waitForTimeout(250)
    }
  }
  throw new Error("Quick open dialog did not appear")
}

export async function typeInEditor(page: ShellDriver, text: string): Promise<void> {
  await focusEditor(page)
  await page.keyboard.type(text)
}

export async function showTerminal(page: ShellDriver): Promise<void> {
  await page.evaluate(async () => {
    await window.__jetAgent!.executeCommand("terminal.show")
  })
  await page.waitForSelector("[data-jet-terminal-panel] .xterm", { timeout: 15_000 })
}

export async function readTerminalText(page: ShellDriver): Promise<string> {
  return page.evaluate(() => {
    const rows = document.querySelector("[data-jet-terminal-panel] .xterm-rows")
    return rows?.textContent ?? ""
  })
}

export async function confirmOverlay(page: ShellDriver): Promise<void> {
  await page.keyboard.press("Meta+Enter")
}

export async function waitForSearchReady(page: ShellDriver, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    async () => {
      if (!window.__jetAgent?.getState().searchReady) return false
      const path = window.__jetAgent?.getState().activeWorkspace
      if (!path || !window.jet?.search?.isScanReady) return false
      const uri = path.startsWith("/") ? `file://${path}` : `file:///${path}`
      return window.jet.search.isScanReady(uri)
    },
    null,
    { timeout: timeoutMs },
  )
}

export async function waitForLspConnected(page: ShellDriver, timeoutMs = 60_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const footer = document.querySelector("footer")
      const text = footer?.textContent ?? ""
      return text.includes("LSP connected") || text.includes("Language server connected")
    },
    null,
    { timeout: timeoutMs },
  )
}

export async function execCommand(page: ShellDriver, commandId: string): Promise<void> {
  await page.evaluate(async (cmd: string) => {
    await window.__jetAgent!.executeCommand(cmd)
  }, commandId)
}
