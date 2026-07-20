import { resolve } from "node:path"
import { execFileSync, execSync } from "node:child_process"
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
export const SAMPLE = "fixtures/sample-workspace"

/** Tauri host owns PTY; assume available on Unix CI/dev machines. */
export function hasPtySpawn(): boolean {
  return process.platform !== "win32"
}

export function hasTypescriptLanguageServer(): boolean {
  const candidates = [
    "/opt/homebrew/bin/typescript-language-server",
    "/usr/local/bin/typescript-language-server",
    "typescript-language-server",
  ]
  for (const command of candidates) {
    try {
      execFileSync(command, ["--version"], { stdio: "ignore" })
      return true
    } catch {
      /* try the next standard install location */
    }
  }
  return false
}

export function hasGopls(): boolean {
  const candidates = [
    "/opt/homebrew/bin/gopls",
    "/usr/local/bin/gopls",
    `${process.env.HOME ?? ""}/.local/share/nvim/mason/bin/gopls`,
    "gopls",
  ]
  for (const command of candidates) {
    if (!command) continue
    try {
      execFileSync(command, ["version"], { stdio: "ignore" })
      return true
    } catch {
      /* try next */
    }
  }
  return false
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

/** Shared E2E entry — Tauri shell only (Electron retired). Specs stay under tests/electron/. */
export async function launchJet(
  workspaceRelOrOpts: string | LaunchJetOptions = SAMPLE,
): Promise<LaunchShellResult> {
  const opts: LaunchJetOptions =
    typeof workspaceRelOrOpts === "string" ? { workspaceRel: workspaceRelOrOpts } : workspaceRelOrOpts
  return launchTauri(opts)
}

export async function openFixtureFile(page: ShellDriver, rel: string): Promise<void> {
  await page.evaluate(async (f: string) => {
    await window.__gharargahAgent!.openFile(f)
    await window.__gharargahAgent!.waitForEditor()
  }, rel)
  await focusEditor(page)
}

export async function focusEditor(page: ShellDriver): Promise<void> {
  await page.waitForFunction(() => !!document.querySelector(".cm-content"), null, { timeout: 10_000 })
  await page.evaluate(() => {
    const el = document.querySelector(".cm-content") as HTMLElement | null
    el?.focus()
  })
  const focused = await page.evaluate(
    () => document.activeElement?.closest(".cm-editor") != null,
  )
  if (!focused) {
    await page.locator(".cm-content").first().click({ timeout: 10_000 })
  }
}

export async function waitForDialog(page: ShellDriver, timeoutMs = 30_000): Promise<void> {
  await page
    .locator('[role="dialog"][data-state="open"], [data-slot="dialog-content"][data-state="open"]')
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs })
}

export async function openThemePicker(page: ShellDriver): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    await execCommand(page, "ui.showThemePicker")
    try {
      await page.locator("[data-gharargah-settings-overlay]").waitFor({ state: "visible", timeout: 2_000 })
      return
    } catch {
      await page.waitForTimeout(250)
    }
  }
  throw new Error("Theme picker did not appear")
}

export async function focusTerminal(page: ShellDriver): Promise<void> {
  await page.locator("[data-gharargah-terminal-panel] \.gharargah-terminal-surface").click()
  await page.evaluate(() => {
    const textarea = document.querySelector(
      "[data-gharargah-terminal-panel] .xterm-helper-textarea",
    ) as HTMLTextAreaElement | null
    textarea?.focus()
  })
}

export async function openSettings(page: ShellDriver): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    await execCommand(page, "settings.show")
    try {
      await page.locator("[data-gharargah-settings-overlay]").waitFor({ state: "visible", timeout: 2_000 })
      return
    } catch {
      await page.waitForTimeout(250)
    }
  }
  throw new Error("Settings overlay did not appear")
}

export async function openBufferList(page: ShellDriver): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    await execCommand(page, "workspace.bufferList")
    try {
      await waitForDialog(page, 2_000)
      return
    } catch {
      await page.waitForTimeout(250)
    }
  }
  throw new Error("Buffer list dialog did not appear")
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
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.evaluate(async () => {
      await window.__gharargahAgent!.executeCommand("terminal.show")
    })
    await page.waitForSelector("[data-gharargah-terminal-panel] .xterm", { timeout: 30_000 })
    try {
      await page.waitForFunction(
        () => {
          const text = document.querySelector("[data-gharargah-terminal-panel] .xterm-rows")?.textContent ?? ""
          return text.trim().length > 0
        },
        null,
        { timeout: 30_000 },
      )
      return
    } catch {
      if (attempt === 1) throw new Error("terminal did not become ready")
    }
  }
}

export async function readTerminalText(page: ShellDriver): Promise<string> {
  return page.evaluate(() => {
    const rows = document.querySelector("[data-gharargah-terminal-panel] .xterm-rows")
    return rows?.textContent ?? ""
  })
}

export async function confirmOverlay(page: ShellDriver): Promise<void> {
  await page.keyboard.press("Meta+Enter")
}

export async function waitForSearchReady(page: ShellDriver, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    async () => {
      if (!window.__gharargahAgent?.getState().searchReady) return false
      const path = window.__gharargahAgent?.getState().activeWorkspace
      if (!path || !window.gharargah?.search?.isScanReady) return false
      const uri = path.startsWith("/") ? `file://${path}` : `file:///${path}`
      return window.gharargah.search.isScanReady(uri)
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
      if (text.includes("LSP connected") || text.includes("Language server connected")) return true
      return document.querySelector('button[aria-label="Language server connected"]') != null
    },
    null,
    { timeout: timeoutMs },
  )
}

export async function execCommand(page: ShellDriver, commandId: string): Promise<void> {
  await page.evaluate(async (cmd: string) => {
    await window.__gharargahAgent!.executeCommand(cmd)
  }, commandId)
}
