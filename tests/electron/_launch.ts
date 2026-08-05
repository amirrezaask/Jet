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
  /**
   * Stay on the GitHub-style project page (session list) instead of opening a
   * session workspace. Default false — most mux/terminal E2E specs need a session.
   */
  projectPage?: boolean
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

/**
 * Shared E2E entry. Historical specs remain under tests/electron/.
 *
 * Parallelism note: speed now comes from Playwright `fullyParallel: true`, which
 * runs distinct spec *files* concurrently across workers (see
 * `playwright.config.ts`). Each `launchJet()` call still spins up its own
 * `@yaade/host-server` + browser context and tears it down in the test's
 * `finally` via `app.close()`.
 *
 * A shared host-per-worker fixture was intentionally NOT adopted: several active
 * specs assert against fresh host state — e.g. `mux.electron.spec.ts` /
 * `url-session.electron.spec.ts` reload to restore persisted layouts and expect
 * to start from a single pane, and PTYs/workspace-sessions would leak between
 * tests sharing a host. Reusing one host across tests in a worker would make
 * these order-dependent and flaky. Keep the per-test host lifecycle; parallelize
 * at the file level instead. If a shared host is ever revisited, migrate one
 * spec (mux) as a pilot behind a worker-scoped Playwright fixture and prove
 * isolation (reset sessions + dispose PTYs between tests) before expanding.
 */
export async function launchJet(
  workspaceRelOrOpts: string | LaunchJetOptions = SAMPLE,
): Promise<LaunchShellResult> {
  const opts: LaunchJetOptions =
    typeof workspaceRelOrOpts === "string" ? { workspaceRel: workspaceRelOrOpts } : workspaceRelOrOpts
  const result = await launchWeb(opts)
  if (!opts.projectPage) {
    await waitForMux(result.page)
  } else {
    await waitForProjectPage(result.page)
  }
  return result
}

export async function waitForHome(page: ShellDriver, timeoutMs = 30_000): Promise<void> {
  await waitForMux(page, timeoutMs)
}

/** Wait for the terminal mux shell, creating a session from the project page if needed. */
export async function waitForMux(page: ShellDriver, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const mux = await page.locator("[data-yaade-mux]").count()
    if (mux > 0) {
      await page.evaluate(() => window.__yaadeAgent!.waitForReady())
      return
    }
    const project = await page.locator("[data-yaade-shell='project']").count()
    if (project > 0) {
      // A create dialog may already be in flight (caller clicked Create).
      const dialogOpen =
        (await page.locator("[data-yaade-new-session-dialog]").count()) > 0
      if (dialogOpen) {
        await page.waitForTimeout(100)
        continue
      }
      // Prefer an existing session row; otherwise create one.
      const row = page.locator("[data-yaade-session-row]").first()
      if ((await row.count()) > 0) {
        await row.click()
      } else {
        await page.locator("[data-yaade-new-session]").click()
        await page.locator("[data-yaade-new-session-dialog]").waitFor({
          state: "visible",
          timeout: 5_000,
        })
        await page.locator("[data-yaade-create-session]").click()
      }
      await page.locator("[data-yaade-mux]").waitFor({
        state: "visible",
        timeout: Math.max(1_000, deadline - Date.now()),
      })
      await page.evaluate(() => window.__yaadeAgent!.waitForReady())
      return
    }
    await page.waitForTimeout(100)
  }
  throw new Error("waitForMux: timed out waiting for project page or mux shell")
}

/** Wait for the GitHub-style project landing page (session list). */
export async function waitForProjectPage(
  page: ShellDriver,
  timeoutMs = 30_000,
): Promise<void> {
  await page.waitForSelector("[data-yaade-shell='project']", {
    timeout: timeoutMs,
  })
}

/** @deprecated Alias — mux shell is the session workspace. */
export async function waitForMuxAlias(page: ShellDriver, timeoutMs = 30_000): Promise<void> {
  await waitForMux(page, timeoutMs)
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

/**
 * Mux actions live behind a tmux-style prefix because the browser owns nearly
 * every `Mod-` chord a multiplexer wants. Playwright's CDP input bypasses
 * browser chrome, so a spec pressing `Meta+KeyT` would pass while the same key
 * does nothing for a real user — always drive mux actions through the prefix.
 */
export async function pressMuxPrefix(
  page: ShellDriver,
  key: string,
): Promise<void> {
  await page.keyboard.press("Control+KeyA")
  await page.keyboard.press(key)
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
