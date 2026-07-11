/**
 * Tauri UI E2E suite — node:http WebDriver (not WDIO).
 * Covers shell palette, terminal, quick-open, editor open, titlebar.
 */
import { createRequire } from "node:module"

const { createWebDriver } = createRequire(import.meta.url)("./webdriver.cjs")

const EXPLORER_PANEL = '[data-jet-list-panel="jet:explorer"]'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function waitReady(wd) {
  await wd.waitUntil(
    async () => wd.execute(() => window.__jetAgent != null),
    { timeout: 60_000, timeoutMsg: "__jetAgent not mounted" },
  )
  await wd.executeAsync(done => {
    window.__jetAgent
      .waitForReady()
      .then(() => done(true))
      .catch(err => done({ error: String(err) }))
  })
}

async function execCommand(wd, name) {
  await wd.executeAsync((cmd, done) => {
    window.__jetAgent
      .executeCommand(cmd)
      .then(() => done(true))
      .catch(err => done({ error: String(err) }))
  }, name)
}

async function testShellPalette(wd) {
  await execCommand(wd, "ui.showCommandPalette")

  await wd.waitUntil(
    async () =>
      wd.execute(() => document.querySelector('[role="dialog"]') != null),
    { timeout: 10_000, timeoutMsg: "palette dialog missing" },
  )
  await wd.waitUntil(
    async () => wd.execute(() => window.__jetAgent.getState().paletteOpen),
    { timeout: 10_000, timeoutMsg: "paletteOpen never true" },
  )

  await wd.execute(query => {
    const input = document.querySelector('[role="dialog"] [role="combobox"]')
    if (!input) throw new Error("combobox missing")
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set
    setter?.call(input, query)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }, "explorer")

  await wd.waitUntil(
    async () =>
      wd.execute(() =>
        Array.from(document.querySelectorAll('[role="option"]')).some(el =>
          /explorer/i.test(el.textContent ?? ""),
        ),
      ),
    { timeout: 10_000, timeoutMsg: "explorer option missing" },
  )

  await wd.execute(() => {
    const opt = Array.from(document.querySelectorAll('[role="option"]')).find(
      el => /explorer/i.test(el.textContent ?? ""),
    )
    opt?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })

  await wd.waitUntil(
    async () =>
      wd.execute(
        sel => document.querySelector(sel) != null,
        EXPLORER_PANEL,
      ),
    { timeout: 10_000, timeoutMsg: "explorer panel not shown" },
  )

  await execCommand(wd, "ui.showCommandPalette")
  await wd.execute(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    )
  })

  await wd.waitUntil(
    async () =>
      wd.execute(() => document.querySelectorAll('[role="dialog"]').length === 0),
    { timeout: 10_000, timeoutMsg: "palette did not close" },
  )
}

async function testTerminal(wd) {
  const result = await wd.executeAsync(done => {
    ;(async () => {
      const terminal = window.jet?.terminal
      const workspacePath = window.__jetAgent?.getState().activeWorkspace
      if (!terminal || !workspacePath) {
        done({ error: "Terminal API or workspace unavailable" })
        return
      }
      const cwdUri = `file://${workspacePath}`
      const first = await terminal.create(cwdUri)
      const second = await terminal.create(cwdUri)
      await terminal.dispose(first.id)
      await terminal.dispose(second.id)

      const direct = await terminal.create(cwdUri, {
        command: "/bin/sh",
        args: ["-c", "printf jet-direct-launch"],
      })
      const output = await new Promise((resolve, reject) => {
        let text = ""
        let unsubscribe = () => {}
        const timeout = window.setTimeout(() => {
          unsubscribe()
          reject(new Error(`Timed out waiting for direct terminal output: ${text}`))
        }, 8_000)
        unsubscribe = terminal.onData(direct.id, data => {
          text += data
          if (!text.includes("jet-direct-launch")) return
          window.clearTimeout(timeout)
          unsubscribe()
          resolve(text)
        })
      })
      await terminal.dispose(direct.id)
      done({
        firstTitle: first.title,
        secondTitle: second.title,
        output,
      })
    })().catch(err => done({ error: String(err) }))
  })

  assert(!result.error, result.error)
  assert(/^\S+(?: \d+)?$/.test(result.firstTitle ?? ""), `bad first title ${result.firstTitle}`)
  const firstMatch = result.firstTitle.match(/^(.*?)(?: (\d+))?$/)
  const firstIndex = firstMatch[2] ? Number(firstMatch[2]) : 1
  const expectedSecond = `${firstMatch[1]} ${firstIndex + 1}`
  assert(
    result.secondTitle === expectedSecond,
    `expected second title ${expectedSecond}, got ${result.secondTitle}`,
  )
  assert(result.output.includes("jet-direct-launch"), `missing launch output: ${result.output}`)
  assert(
    !result.output.includes("printf jet-direct-launch") && !result.output.includes("/bin/sh"),
    `launch command echoed: ${result.output}`,
  )
}

async function testQuickOpen(wd) {
  await execCommand(wd, "workspace.quickOpen")
  await wd.waitUntil(
    async () =>
      wd.execute(() => document.querySelector('[role="dialog"]') != null),
    { timeout: 10_000, timeoutMsg: "quick-open dialog missing" },
  )

  await wd.execute(query => {
    const input = document.querySelector('[role="dialog"] [role="combobox"]')
    if (!input) throw new Error("combobox missing")
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set
    setter?.call(input, query)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }, "utils")

  await wd.waitUntil(
    async () =>
      wd.execute(() => {
        const dialog = document.querySelector('[role="dialog"]')
        return dialog?.textContent?.includes("utils.ts") ?? false
      }),
    { timeout: 15_000, timeoutMsg: "utils.ts not in quick-open results" },
  )

  await wd.execute(() => {
    const opt = Array.from(document.querySelectorAll('[role="option"]')).find(
      el => (el.textContent ?? "").includes("utils.ts"),
    )
    if (!opt) throw new Error("utils.ts option not found")
    opt.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })

  await wd.executeAsync(done => {
    window.__jetAgent
      .waitForEditor()
      .then(() => done(true))
      .catch(err => done({ error: String(err) }))
  })

  await wd.waitUntil(
    async () =>
      wd.execute(() => {
        const editor = document.querySelector(".cm-editor")
        return editor?.textContent?.includes("export function greet") ?? false
      }),
    { timeout: 15_000, timeoutMsg: "editor did not open utils.ts" },
  )
}

async function testEditorOpen(wd) {
  await wd.executeAsync(done => {
    ;(async () => {
      await window.__jetAgent.openFile("src/index.ts")
      await window.__jetAgent.waitForEditor()
      done(true)
    })().catch(err => done({ error: String(err) }))
  })

  await wd.waitUntil(
    async () =>
      wd.execute(() => {
        const editor = document.querySelector(".cm-editor")
        return editor != null && (editor.textContent?.length ?? 0) > 0
      }),
    { timeout: 15_000, timeoutMsg: "editor buffer empty after openFile" },
  )

  const state = await wd.execute(() => window.__jetAgent.getState())
  assert(state.activeWorkspace, "activeWorkspace missing after open")
}

async function testTitlebar(wd) {
  await wd.waitUntil(
    async () =>
      wd.execute(() => document.querySelector("[data-jet-titlebar]") != null),
    { timeout: 10_000, timeoutMsg: "titlebar missing" },
  )

  const geom = await wd.execute(() => {
    const root = document.documentElement
    const insetRaw = getComputedStyle(root)
      .getPropertyValue("--jet-traffic-light-inset")
      .trim()
    const probe = document.createElement("div")
    probe.style.width = insetRaw || "7.7rem"
    document.body.appendChild(probe)
    const zone = probe.getBoundingClientRect().width
    probe.remove()

    const titlebar = document.querySelector("[data-jet-titlebar]")
    if (!titlebar) return null
    const spacer = document.querySelector("[data-jet-traffic-light-spacer]")
    const sidebar = document.querySelector("[data-jet-titlebar-sidebar]")
    return {
      visible: titlebar.getBoundingClientRect().height > 0,
      hasSpacer: spacer != null,
      spacerWidth: spacer?.getBoundingClientRect().width ?? 0,
      spacerHeight: spacer?.getBoundingClientRect().height ?? 0,
      titlebarHeight: titlebar.getBoundingClientRect().height,
      spacerDrag: spacer?.hasAttribute("data-tauri-drag-region") === true,
      sidebarDeepDrag: sidebar?.getAttribute("data-tauri-drag-region") === "deep",
      zone,
      platform: navigator.platform,
    }
  })

  assert(geom?.visible, "titlebar not visible")
  if (String(geom.platform).toLowerCase().includes("mac")) {
    assert(geom.hasSpacer, "macOS traffic-light spacer missing")
    assert(
      geom.spacerWidth >= geom.zone * 0.5,
      `traffic-light spacer too narrow: ${geom.spacerWidth} vs zone ${geom.zone}`,
    )
    assert(
      geom.spacerHeight >= geom.titlebarHeight * 0.8,
      `traffic-light spacer too short: ${geom.spacerHeight} vs titlebar ${geom.titlebarHeight}`,
    )
    assert(geom.spacerDrag, "traffic-light spacer missing data-tauri-drag-region")
    assert(geom.sidebarDeepDrag, "titlebar sidebar must use deep drag region")
  }
}

const TESTS = [
  ["shell palette", testShellPalette],
  ["terminal host", testTerminal],
  ["quick open", testQuickOpen],
  ["editor open", testEditorOpen],
  ["titlebar", testTitlebar],
]

export async function runUiSuite(port = 4445) {
  const wd = createWebDriver(port)
  await wd.newSession()
  try {
    await waitReady(wd)
    for (const [name, fn] of TESTS) {
      const started = Date.now()
      await fn(wd)
      console.log(`  ✓ ${name} (${Date.now() - started}ms)`)
    }
  } finally {
    await wd.deleteSession()
  }
}
