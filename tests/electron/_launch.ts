import { resolve } from "node:path"
import { execSync } from "node:child_process"
import { launchWeb } from "../shell/launch-web.js"
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

/** The Rust server owns PTYs; assume available on Unix CI/dev machines. */
export function hasPtySpawn(): boolean {
  return process.platform !== "win32"
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

/** Shared E2E entry. Historical specs remain under tests/electron/. */
export async function launchJet(
  workspaceRelOrOpts: string | LaunchJetOptions = SAMPLE,
): Promise<LaunchShellResult> {
  const opts: LaunchJetOptions =
    typeof workspaceRelOrOpts === "string" ? { workspaceRel: workspaceRelOrOpts } : workspaceRelOrOpts
  return launchWeb(opts)
}

export async function waitForHome(page: ShellDriver, timeoutMs = 30_000): Promise<void> {
  await page.waitForSelector("[data-gharargah-home]", { timeout: timeoutMs })
  await page.waitForFunction(
    () => window.__gharargahAgent?.getState()?.shellView === "home",
    null,
    { timeout: timeoutMs },
  )
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
  await page.locator("[data-gharargah-terminal-panel] .gharargah-terminal-surface").click()
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

export async function execCommand(page: ShellDriver, commandId: string): Promise<void> {
  await page.evaluate(async (cmd: string) => {
    await window.__gharargahAgent!.executeCommand(cmd)
  }, commandId)
}

export async function clickNewSession(page: ShellDriver): Promise<void> {
  await page.getByRole("button", { name: "New session" }).first().click()
}

/** Pick an agent CLI from the new-session lister (default: Shell). */
export async function pickAgentCli(
  page: ShellDriver,
  agentId: string = "shell",
): Promise<void> {
  const option = page.locator(`[data-gharargah-agent-cli-option="${agentId}"]`)
  await option.waitFor({ state: "visible", timeout: 20_000 })
  await option.click()
}

/** Open a CLI-driven ADE session (picker → terminal modal). */
export async function openNewCliSession(
  page: ShellDriver,
  agentId: string = "shell",
): Promise<ReturnType<ShellDriver["locator"]>> {
  await clickNewSession(page)
  await pickAgentCli(page, agentId)
  const modal = page.locator("[data-gharargah-terminal-modal]")
  await modal.waitFor({ state: "visible", timeout: 20_000 })
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-gharargah-terminal-modal]")
        ?.getAttribute("data-gharargah-session-mode") === "terminal",
    null,
    { timeout: 20_000 },
  )
  return modal
}

/**
 * @deprecated Prefer {@link openNewCliSession}. Kept for older agent-chat specs;
 * product new-session path is always the agent CLI picker.
 */
export async function openNewAgentSession(
  page: ShellDriver,
  providerId?: string,
): Promise<ReturnType<ShellDriver["locator"]>> {
  return openNewCliSession(page, providerId ?? "shell")
}
