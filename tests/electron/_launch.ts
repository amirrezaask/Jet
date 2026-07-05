import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test"
import { resolve } from "node:path"
import { execSync } from "node:child_process"

export const REPO_ROOT = resolve(__dirname, "..", "..")
export const DESKTOP_DIR = resolve(REPO_ROOT, "apps/jet-desktop")
export const MAIN_JS = resolve(DESKTOP_DIR, "dist-electron/main.js")
export const SAMPLE = "fixtures/sample-workspace"

export function hasTypescriptLanguageServer(): boolean {
  try {
    execSync("typescript-language-server --version", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

export async function launchJet(workspaceRel = SAMPLE): Promise<{ app: ElectronApplication; page: Page }> {
  const workspacePath = resolve(REPO_ROOT, workspaceRel)
  const app = await electron.launch({
    args: [MAIN_JS, "--", workspacePath],
    cwd: DESKTOP_DIR,
    env: { ...process.env, JET_E2E: "1" },
  })

  const page = await waitForAppPage(app)
  await page.waitForLoadState("domcontentloaded")
  await page.waitForFunction(() => window.__jetAgent != null, null, { timeout: 30_000 })
  await page.evaluate(async () => {
    await window.__jetAgent!.waitForReady()
  })
  return { app, page }
}

/** Playwright may surface DevTools as firstWindow(); pick the renderer shell. */
async function waitForAppPage(app: ElectronApplication): Promise<Page> {
  for (let i = 0; i < 80; i++) {
    for (const win of app.windows()) {
      const url = win.url()
      if (url.startsWith("devtools://")) continue
      if (url.startsWith("file://") || url.startsWith("http://")) return win
    }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error("Electron app window not found (only DevTools?)")
}

export async function openFixtureFile(page: Page, rel: string): Promise<void> {
  await page.evaluate(async (f: string) => {
    await window.__jetAgent!.openFile(f)
    await window.__jetAgent!.waitForEditor()
  }, rel)
}

export async function waitForLspConnected(page: Page, timeoutMs = 20_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const btn = document.querySelector("footer button")
      return btn?.textContent?.includes("connected") ?? false
    },
    null,
    { timeout: timeoutMs },
  )
}
