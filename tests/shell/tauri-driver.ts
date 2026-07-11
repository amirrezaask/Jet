/**
 * Tauri shell driver — WebDriver execute + DOM helpers.
 */
import { createRequire } from "node:module"
import type { ShellDriver, ShellLocator } from "./driver.js"

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function textFilterPattern(filter?: string | RegExp): string {
  if (!filter) return ""
  if (filter instanceof RegExp) return filter.source
  return escapeRegExp(filter)
}

function textFilterFlags(filter?: string | RegExp): string {
  return filter instanceof RegExp ? filter.flags : "i"
}

function roleSelector(role: string): string {
  switch (role) {
    case "button":
      return 'button:not([disabled]), [role="button"]:not([aria-disabled="true"])'
    case "textbox":
      return 'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea, [role="textbox"]'
    case "treeitem":
      return '[role="treeitem"]'
    case "menuitem":
      return '[role="menuitem"]'
    case "menu":
      return '[role="menu"]'
    case "option":
      return '[role="option"]'
    case "listbox":
      return '[role="listbox"]'
    case "dialog":
      return '[role="dialog"][data-state="open"], [data-slot="dialog-content"][data-state="open"]'
    default:
      return `[role="${role}"]`
  }
}

const { browserFn } = createRequire(__filename)("./browser-fn.cjs") as {
  browserFn: (source: string) => string
}
const { waitForJetReady } = createRequire(__filename)("../tauri/webdriver.cjs") as {
  waitForJetReady: (wd: TauriWebDriver) => Promise<void>
}

export type TauriWebDriver = {
  execute<R>(script: string | ((...args: unknown[]) => R), ...args: unknown[]): Promise<R>
  executeAsync<R>(script: string | ((...args: unknown[]) => void), ...args: unknown[]): Promise<R>
  performActions(actions: unknown[]): Promise<void>
  releaseActions(): Promise<void>
  sendKeys(text: string): Promise<void>
  waitUntil(fn: () => Promise<boolean>, options?: { timeout?: number; interval?: number; timeoutMsg?: string }): Promise<unknown>
}

function unwrapAsyncResult<R>(result: R | { __error?: string }): R {
  if (result && typeof result === "object" && "__error" in result && result.__error) {
    throw new Error(result.__error)
  }
  return result as R
}

function serializeScript(script: string | ((...args: unknown[]) => unknown)): string {
  if (typeof script === "function") {
    return `return (${script}).apply(null, arguments)`
  }
  return script
}

class TauriLocator implements ShellLocator {
  constructor(
    private readonly wd: TauriWebDriver,
    private readonly selector: string,
    private readonly index = 0,
    private readonly textFilter?: string | RegExp,
    private readonly parent?: TauriLocator,
  ) {}

  toSelector(): string {
    return this.parent ? `${this.parent.toSelector()} >> ${this.selector}` : this.selector
  }

  private resolveIndex(list: Element[]): number {
    if (this.index < 0) return Math.max(0, list.length + this.index)
    return this.index
  }

  private patternExpr(): string {
    return this.textFilter
      ? `new RegExp(${JSON.stringify(textFilterPattern(this.textFilter))}, ${JSON.stringify(textFilterFlags(this.textFilter))})`
      : "null"
  }

  private indexExpr(): string {
    return this.index < 0 ? `Math.max(0, list.length + ${this.index})` : String(this.index)
  }

  private buildListBlock(): string {
    const pattern = this.patternExpr()
    const idxExpr = this.indexExpr()
    if (!this.parent) {
      return `
        var nodes = [...document.querySelectorAll(${JSON.stringify(this.selector)})];
        var list = nodes;
        var pattern = ${pattern};
        if (pattern) list = nodes.filter(function(n){ return pattern.test(n.getAttribute("aria-label") || n.textContent || ""); });
      `
    }
    return `
      ${this.parent.buildResolveBlock("root")}
      var list = [];
      if (root) {
        var nodes = [...root.querySelectorAll(${JSON.stringify(this.selector)})];
        list = nodes;
        var pattern = ${pattern};
        if (pattern) list = nodes.filter(function(n){ return pattern.test(n.getAttribute("aria-label") || n.textContent || ""); });
      }
    `
  }

  private buildResolveBlock(resultVar = "el"): string {
    const pattern = this.patternExpr()
    const idxExpr = this.indexExpr()
    return `
      ${this.buildListBlock()}
      var ${resultVar} = list[${idxExpr}];
    `
  }

  private missingTargetMsg(): string {
    return `no element for ${this.toSelector()}`
  }

  private async waitForElement(timeout = 10_000): Promise<void> {
    await this.wd.waitUntil(async () => (await this.count()) > this.resolveIndex([]), {
      timeout,
      timeoutMsg: `no element for ${this.selector}`,
    })
  }

  private async withElement<R>(fn: (el: Element) => R | Promise<R>): Promise<R> {
    await this.waitForElement()
    const fnBody = browserFn(fn.toString())
    const isAsync = /\basync\b/.test(fn.toString())
    const resolveBlock = this.buildResolveBlock("el")
    if (!isAsync) {
      return this.wd.execute(`${resolveBlock} if (!el) throw new Error(${JSON.stringify(this.missingTargetMsg())}); return (${fnBody})(el);`) as Promise<R>
    }
    const script = `
      var cb = arguments[arguments.length - 1];
      ${resolveBlock}
      if (!el) { cb({ __error: ${JSON.stringify(this.missingTargetMsg())} }); return; }
      Promise.resolve((${fnBody})(el)).then(cb).catch(function(e){ cb({ __error: String(e) }); });
    `
    return runAsync<R>(this.wd, script)
  }

  click(options?: { timeout?: number; button?: "left" | "right" | "middle" }): Promise<void> {
    const timeout = options?.timeout ?? 10_000
    const button = options?.button ?? "left"
    if (button === "right") {
      return this.evaluate(el => {
        const target = el as HTMLElement
        const rect = target.getBoundingClientRect()
        target.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            button: 2,
            buttons: 2,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
          }),
        )
      })
    }
    return this.wd.waitUntil(
      async () => {
        await this.evaluate(el => {
          ;(el as HTMLElement).click()
        })
        return true
      },
      { timeout, timeoutMsg: `click timeout ${this.selector}` },
    ).then(() => undefined)
  }

  async fill(value: string): Promise<void> {
    await this.wd.execute(`${this.buildResolveBlock("el")}
      if (!el) throw new Error(${JSON.stringify(this.missingTargetMsg())});
      el.focus();
      var fillable = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)
        ? el
        : el.querySelector("input,textarea,[contenteditable=true]");
      if (!fillable) {
        document.execCommand("insertText", false, ${JSON.stringify(value)});
      } else if (fillable instanceof HTMLInputElement || fillable instanceof HTMLTextAreaElement) {
        var proto = fillable instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, "value");
        if (desc && desc.set) desc.set.call(fillable, ${JSON.stringify(value)});
        fillable.dispatchEvent(new Event("input", { bubbles: true }));
        fillable.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        fillable.textContent = ${JSON.stringify(value)};
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    `)
  }

  press(key: string): Promise<void> {
    return this.focus().then(() => dispatchKey(this.wd, key))
  }

  async focus(): Promise<void> {
    await this.withElement(el => {
      ;(el as HTMLElement).focus()
    })
  }

  async hover(): Promise<void> {
    await this.withElement(el => {
      const rect = el.getBoundingClientRect()
      el.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }))
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    })
  }

  first(): ShellLocator {
    return new TauriLocator(this.wd, this.selector, 0, this.textFilter, this.parent)
  }

  nth(index: number): ShellLocator {
    return new TauriLocator(this.wd, this.selector, index, this.textFilter, this.parent)
  }

  filter(options: { hasText?: string | RegExp }): ShellLocator {
    return new TauriLocator(this.wd, this.selector, this.index, options.hasText, this.parent)
  }

  last(): ShellLocator {
    return new TauriLocator(this.wd, this.selector, -1, this.textFilter, this.parent)
  }

  async getAttribute(name: string): Promise<string | null> {
    return this.wd.execute(`${this.buildResolveBlock("el")} return el ? el.getAttribute(${JSON.stringify(name)}) : null;`) as Promise<string | null>
  }

  async textContent(): Promise<string | null> {
    return this.withElement(el => el.textContent)
  }

  getByRole(role: string, options?: { name?: string | RegExp }): ShellLocator {
    const name = options?.name
    const namePattern = name instanceof RegExp ? name : name ? new RegExp(escapeRegExp(name), "i") : undefined
    return new TauriLocator(this.wd, roleSelector(role), 0, namePattern, this)
  }

  locator(selector: string): ShellLocator {
    return new TauriLocator(this.wd, selector, 0, this.textFilter, this)
  }

  async waitFor(options?: { state?: "visible" | "attached" | "hidden"; timeout?: number }): Promise<void> {
    const state = options?.state ?? "visible"
    const timeout = options?.timeout ?? 10_000
    await this.wd.waitUntil(
      async () => {
        const visible = await this.isVisible()
        if (state === "hidden") return !visible
        if (state === "attached") return (await this.count()) > 0
        return visible
      },
      { timeout, timeoutMsg: `waitFor ${state} ${this.selector}` },
    )
  }

  async boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return this.withElement(el => {
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, width: r.width, height: r.height }
    })
  }

  evaluate<R, Arg>(pageFunction: (arg: Arg, element: Element) => R | Promise<R>, arg: Arg): Promise<R>
  evaluate<R>(pageFunction: (element: Element) => R | Promise<R>): Promise<R>
  async evaluate<R, Arg>(
    pageFunction: ((arg: Arg, element: Element) => R | Promise<R>) | ((element: Element) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    await this.waitForElement()
    const fnBody = browserFn(pageFunction.toString())
    const argLiteral = arg === undefined ? "" : JSON.stringify(arg)
    const call = arg === undefined ? `(${fnBody})(el)` : `(${fnBody})(el, ${argLiteral})`
    const script = `
      var cb = arguments[arguments.length - 1];
      ${this.buildResolveBlock("el")}
      if (!el) { cb({ __error: ${JSON.stringify(this.missingTargetMsg())} }); return; }
      try { Promise.resolve(${call}).then(cb).catch(function(e){ cb({ __error: String(e) }); }); }
      catch (e) { cb({ __error: String(e) }); }
    `
    return runAsync<R>(this.wd, script)
  }

  async isVisible(): Promise<boolean> {
    return this.wd.execute(`${this.buildResolveBlock("el")}
      if (!el) return false;
      var cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    `) as Promise<boolean>
  }

  async count(): Promise<number> {
    return this.wd.execute(`${this.buildListBlock()} return list.length;`) as Promise<number>
  }
}

function runAsync<R>(wd: TauriWebDriver, script: string): Promise<R> {
  return wd.executeAsync(script).then(result => unwrapAsyncResult<R>(result))
}

const WEBDRIVER_KEYS: Record<string, string> = {
  Backspace: "\uE003",
  Tab: "\uE004",
  Enter: "\uE007",
  Shift: "\uE008",
  Control: "\uE009",
  Ctrl: "\uE009",
  Alt: "\uE00A",
  Escape: "\uE00C",
  Space: "\uE00D",
  PageUp: "\uE00E",
  PageDown: "\uE00F",
  End: "\uE010",
  Home: "\uE011",
  ArrowLeft: "\uE012",
  ArrowUp: "\uE013",
  ArrowRight: "\uE014",
  ArrowDown: "\uE015",
  Insert: "\uE016",
  Delete: "\uE017",
  F12: "\uE03C",
  Meta: "\uE03D",
}

function keyValue(key: string): string {
  return WEBDRIVER_KEYS[key] ?? key
}

async function writeTerminalInput(wd: TauriWebDriver, payload: string): Promise<boolean> {
  return wd.execute(async (text: string) => {
    const panel = document.querySelector("[data-jet-terminal-panel][data-jet-terminal-pty-id]")
    const id = panel?.getAttribute("data-jet-terminal-pty-id")
    const textarea = document.querySelector("[data-jet-terminal-panel] .xterm-helper-textarea")
    const active = document.activeElement
    if (!panel || !id || !window.jet?.terminal) return false
    const inTerminal =
      active === textarea ||
      active === panel ||
      (active instanceof Element && active.closest("[data-jet-terminal-panel]") != null)
    if (!inTerminal) return false
    await window.jet.terminal.write(id, text)
    return true
  }, payload) as Promise<boolean>
}

async function ensureKeyboardFocus(wd: TauriWebDriver): Promise<void> {
  await wd.execute(() => {
    const active = document.activeElement as HTMLElement | null
    if (active && active !== document.body && active !== document.documentElement) return
    const candidates = [
      document.querySelector<HTMLElement>("[data-jet-terminal-panel] .xterm-helper-textarea"),
      document.querySelector<HTMLElement>('[role="dialog"] input:not([disabled])'),
      document.querySelector<HTMLElement>(".cm-content"),
    ]
    const target = candidates.find(element => {
      if (!element) return false
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    })
    target?.focus()
  })
}

function keyActions(events: Array<{ type: "keyDown" | "keyUp"; value: string }>): unknown[] {
  return [{
    type: "key",
    id: "jet-keyboard",
    actions: events,
  }]
}

const DOM_KEYBOARD_KEYS = new Set([
  "Enter",
  "Escape",
  "Tab",
  "Backspace",
  "Delete",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
])

function dispatchKeyboardEvent(wd: TauriWebDriver, key: string, modifierNames: string[]): Promise<void> {
  return ensureKeyboardFocus(wd).then(() => wd.execute(
    (pressedKey, mods) => {
      const target = document.activeElement ?? document.body
      const init = {
        bubbles: true,
        cancelable: true,
        key: pressedKey === "Space" ? " " : pressedKey,
        code: pressedKey === "Space" ? "Space" : pressedKey,
        altKey: mods.includes("Alt"),
        ctrlKey: mods.includes("Control") || mods.includes("Ctrl"),
        metaKey: mods.includes("Meta"),
        shiftKey: mods.includes("Shift"),
      }
      target.dispatchEvent(new KeyboardEvent("keydown", init))
      target.dispatchEvent(new KeyboardEvent("keypress", init))
      target.dispatchEvent(new KeyboardEvent("keyup", init))
    },
    key,
    modifierNames,
  ))
}

function dispatchKey(wd: TauriWebDriver, key: string): Promise<void> {
  const parts = key.split("+")
  const mainName = parts.pop() ?? key
  const main = keyValue(mainName)
  const modifiers = parts.map(keyValue)
  if (modifiers.length > 0 || DOM_KEYBOARD_KEYS.has(mainName)) {
    return dispatchKeyboardEvent(wd, mainName, parts)
  }
  return ensureKeyboardFocus(wd).then(() => wd.sendKeys(main))
}

export function wrapTauriWebDriver(wd: TauriWebDriver): ShellDriver {
  const heldModifiers = new Set<string>()
  const keyboard = {
    press: async (key: string) => {
      if (key === "Enter" || key === "Return") {
        if (await writeTerminalInput(wd, "\r\n")) return
        if (await writeTerminalInput(wd, "\n")) return
      }
      return dispatchKey(wd, key)
    },
    type: async (text: string) => {
      if (await writeTerminalInput(wd, text)) return
      await ensureKeyboardFocus(wd)
      for (const char of text) await wd.sendKeys(char)
    },
    down: async (key: string) => {
      await ensureKeyboardFocus(wd)
      heldModifiers.add(key)
      await wd.performActions(keyActions([{ type: "keyDown", value: keyValue(key) }]))
    },
    up: async (key: string) => {
      await wd.performActions(keyActions([{ type: "keyUp", value: keyValue(key) }]))
      await wd.releaseActions()
      heldModifiers.delete(key)
    },
  }

  const pointerModifiers = () => ({
    altKey: heldModifiers.has("Alt"),
    ctrlKey: heldModifiers.has("Control") || heldModifiers.has("Ctrl"),
    metaKey: heldModifiers.has("Meta"),
    shiftKey: heldModifiers.has("Shift"),
  })

  const mouse = {
    move: async (x: number, y: number) => {
      await wd.execute(
        (px, py, modifiers) => {
          const editor = document.querySelector(".cm-editor")
          const content = document.querySelector(".cm-content")
          const init = {
            bubbles: true,
            clientX: px,
            clientY: py,
            metaKey: !!modifiers.metaKey,
            ctrlKey: !!modifiers.ctrlKey,
            altKey: !!modifiers.altKey,
            shiftKey: !!modifiers.shiftKey,
          }
          const el = document.elementFromPoint(px, py)
          el?.dispatchEvent(new MouseEvent("mousemove", init))
          el?.dispatchEvent(new MouseEvent("mouseover", init))
          content?.dispatchEvent(new MouseEvent("mousemove", init))
          editor?.dispatchEvent(new MouseEvent("mousemove", init))
        },
        x,
        y,
        pointerModifiers(),
      )
    },
    down: async () => {
      await wd.execute(() => {
        document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
      })
    },
    up: async () => {
      await wd.execute(() => {
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
      })
    },
    click: async (x: number, y: number) => {
      await wd.execute(
        (px, py, modifiers) => {
          const init = {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: 1,
            clientX: px,
            clientY: py,
            metaKey: !!modifiers.metaKey,
            ctrlKey: !!modifiers.ctrlKey,
            altKey: !!modifiers.altKey,
            shiftKey: !!modifiers.shiftKey,
          }
          const editor = document.querySelector(".cm-editor")
          if (editor) {
            editor.dispatchEvent(new MouseEvent("mousedown", init))
            editor.dispatchEvent(new MouseEvent("mouseup", init))
            editor.dispatchEvent(new MouseEvent("click", init))
            return
          }
          const el = document.elementFromPoint(px, py) as HTMLElement | null
          el?.dispatchEvent(new MouseEvent("mousedown", init))
          el?.dispatchEvent(new MouseEvent("mouseup", init))
          el?.dispatchEvent(new MouseEvent("click", init))
        },
        x,
        y,
        pointerModifiers(),
      )
    },
  }

  return {
    evaluate<R, Arg>(pageFunction: ((arg: Arg) => R | Promise<R>) | (() => R | Promise<R>), arg?: Arg): Promise<R> {
      const fnBody = browserFn(pageFunction.toString())
      const argLiteral = arg === undefined ? "" : `(${JSON.stringify(arg)})`
      const call = arg === undefined ? `(${fnBody})()` : `(${fnBody})${argLiteral}`
      const script = `
        var cb = arguments[arguments.length - 1];
        try { Promise.resolve(${call}).then(cb).catch(function(e){ cb({ __error: String(e) }); }); }
        catch (e) { cb({ __error: String(e) }); }
      `
      return runAsync<R>(wd, script)
    },
    waitForFunction(pageFunction, arg, options) {
      const timeout = options?.timeout ?? 15_000
      const fnBody = browserFn(pageFunction.toString())
      const argLiteral = arg === undefined ? "" : `(${JSON.stringify(arg)})`
      const script =
        arg === undefined
          ? `return !!((${fnBody})())`
          : `return !!((${fnBody})${argLiteral})`
      return wd
        .waitUntil(async () => !!(await wd.execute(script)), { timeout, timeoutMsg: "waitForFunction timed out" })
        .then(() => undefined)
    },
    waitForSelector(selector, options) {
      const timeout = options?.timeout ?? 15_000
      const state = options?.state ?? "visible"
      return wd
        .waitUntil(async () => {
          const found = await wd.execute(
            (sel, st) => {
              const el = document.querySelector(sel) as HTMLElement | null
              if (!el) return false
              if (st === "attached") return true
              const cs = getComputedStyle(el)
              const r = el.getBoundingClientRect()
              return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0
            },
            selector,
            state,
          )
          return !!found
        }, { timeout, timeoutMsg: `waitForSelector ${selector}` })
        .then(() => undefined)
    },
    waitForTimeout(ms) {
      return new Promise(r => setTimeout(r, ms))
    },
    waitForLoadState() {
      return wd.waitUntil(async () => wd.execute(() => document.readyState !== "loading"), { timeout: 30_000 }).then(() => undefined)
    },
    keyboard,
    mouse,
    locator(selector) {
      return new TauriLocator(wd, selector)
    },
    getByRole(role, options) {
      const name = options?.name
      const filter = name instanceof RegExp ? name : name ? new RegExp(escapeRegExp(name), "i") : undefined
      return new TauriLocator(wd, roleSelector(role), 0, filter)
    },
    getByPlaceholder(text) {
      const pattern = text instanceof RegExp ? text : new RegExp(text, "i")
      return new TauriLocator(wd, "input,textarea,[contenteditable=true]", 0, pattern)
    },
    getByLabel(text) {
      const pattern = text instanceof RegExp ? text : new RegExp(text, "i")
      return new TauriLocator(wd, "[aria-label]", 0, pattern)
    },
    isVisible(selector) {
      return new TauriLocator(wd, selector).isVisible()
    },
    count(selector) {
      return new TauriLocator(wd, selector).count()
    },
    async textContent(selector) {
      return wd.execute(sel => document.querySelector(sel)?.textContent ?? "", selector) as Promise<string>
    },
    clickSelector(selector) {
      return new TauriLocator(wd, selector).click()
    },
    fillSelector(selector, value) {
      return new TauriLocator(wd, selector).fill(value)
    },
    reload() {
      return (async () => {
        await wd.execute(() => {
          window.location.reload()
        })
        await wd.waitUntil(
          async () =>
            !!(await wd.execute(() => document.readyState === "complete" && window.__jetAgent != null)),
          { timeout: 60_000, timeoutMsg: "reload __jetAgent" },
        )
        await waitForJetReady(wd)
      })()
    },
  }
}

export { serializeScript }
