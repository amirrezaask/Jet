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
  startPath?: string
  homeDir?: string
}

export const REPO_ROOT = resolve(__dirname, "..", "..")
export const SAMPLE = "fixtures/sample-workspace"

/**
 * PTY availability. On macOS ensure node-pty spawn-helper is +x
 * (`packages/yaade-node-host/scripts/fix-node-pty-perms.mjs`).
 */
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
  await page.waitForSelector("[data-yaade-mux]", {
    timeout: timeoutMs,
  })
  await page.evaluate(() => window.__yaadeAgent!.waitForReady())
  await page.waitForFunction(
    () => window.__yaadeAgent?.getState()?.shellView === "home",
    null,
    { timeout: timeoutMs },
  )
}

/** Wait for the terminal mux shell (alias of waitForHome after Mission Control removal). */
export async function waitForMux(page: ShellDriver, timeoutMs = 30_000): Promise<void> {
  await waitForHome(page, timeoutMs)
}

/** Mission Control sidebar removed — mux shell is the home surface. */
export async function ensureSidebarLayout(page: ShellDriver): Promise<void> {
  await waitForMux(page, 15_000)
}

/** @deprecated Use ensureSidebarLayout — cards layout removed. */
export async function ensureCardsLayout(page: ShellDriver): Promise<void> {
  await ensureSidebarLayout(page)
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
      await page.locator("[data-yaade-settings-overlay]").waitFor({ state: "visible", timeout: 2_000 })
      return
    } catch {
      await page.waitForTimeout(250)
    }
  }
  throw new Error("Theme picker did not appear")
}

export async function focusTerminal(page: ShellDriver): Promise<void> {
  await page.locator("[data-yaade-terminal-panel] .yaade-terminal-surface").click()
  await page.evaluate(() => {
    const textarea = document.querySelector(
      "[data-yaade-terminal-panel] .xterm-helper-textarea",
    ) as HTMLTextAreaElement | null
    textarea?.focus()
  })
}

export async function openSettings(page: ShellDriver): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    await execCommand(page, "settings.show")
    try {
      await page.locator("[data-yaade-settings-overlay]").waitFor({ state: "visible", timeout: 2_000 })
      return
    } catch {
      await page.waitForTimeout(250)
    }
  }
  throw new Error("Settings overlay did not appear")
}

export async function showTerminal(page: ShellDriver): Promise<void> {
  await waitForMux(page)
  await page.waitForSelector("[data-yaade-terminal-panel] .xterm", {
    timeout: 30_000,
  })
}

export async function readTerminalText(page: ShellDriver): Promise<string> {
  return page.evaluate(() => window.__yaadeAgent?.getTerminalText?.() ?? "")
}

/** Poll until the active terminal buffer contains `needle` (WebGL-safe). */
export async function waitForTerminalText(
  page: ShellDriver,
  needle: string | RegExp,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const text = await readTerminalText(page)
    if (typeof needle === "string" ? text.includes(needle) : needle.test(text)) {
      return text
    }
    await page.waitForTimeout(50)
  }
  throw new Error(
    `waitForTerminalText: timed out waiting for ${String(needle)}`,
  )
}

export async function confirmOverlay(page: ShellDriver): Promise<void> {
  await page.keyboard.press("Meta+Enter")
}

/** Platform primary chord modifier for Playwright (`Meta` on macOS, `Control` elsewhere). */
export function modChord(): "Meta" | "Control" {
  return process.platform === "darwin" ? "Meta" : "Control"
}

export async function pressMod(
  page: ShellDriver,
  key: string,
  opts?: { shift?: boolean },
): Promise<void> {
  const mods = [modChord()]
  if (opts?.shift) mods.push("Shift")
  await page.keyboard.press(`${mods.join("+")}+${key}`)
}

export async function execCommand(page: ShellDriver, commandId: string): Promise<void> {
  await page.evaluate(async (cmd: string) => {
    await window.__yaadeAgent!.executeCommand(cmd)
  }, commandId)
}

export async function clickNewSession(page: ShellDriver): Promise<void> {
  const sidebarNew = page.locator("[data-yaade-sidebar-new-session]")
  if ((await sidebarNew.count()) > 0 && (await sidebarNew.first().isVisible())) {
    await sidebarNew.first().click()
    return
  }
  await page.getByRole("button", { name: /New session/i }).first().click()
}

/** Pick an agent CLI from the new-session lister (default: Codex). */
export async function pickAgentCli(
  page: ShellDriver,
  agentId: string = "codex",
): Promise<void> {
  const option = page.locator(`[data-yaade-agent-cli-option="${agentId}"]`)
  await option.waitFor({ state: "visible", timeout: 20_000 })
  await option.click()
}

/** Open a CLI-driven ADE session (picker → Agent surface / PTY). */
export async function openNewCliSession(
  page: ShellDriver,
  agentId: string = "codex",
): Promise<ReturnType<ShellDriver["locator"]>> {
  await clickNewSession(page)
  await pickAgentCli(page, agentId)
  const modal = page.locator("[data-yaade-terminal-modal]")
  await modal.waitFor({ state: "visible", timeout: 20_000 })
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-yaade-terminal-modal]")
        ?.getAttribute("data-yaade-session-mode") === "agent",
    null,
    { timeout: 20_000 },
  )
  return modal
}

/** @deprecated Use {@link openNewCliSession}. */
export async function openNewAgentSession(
  page: ShellDriver,
  providerId?: string,
): Promise<ReturnType<ShellDriver["locator"]>> {
  return openNewCliSession(page, providerId ?? "codex")
}
