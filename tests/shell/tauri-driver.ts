/**
 * Tauri shell driver — WebDriver execute + DOM helpers.
 */
import { createRequire } from "node:module"
import type { ShellDriver, ShellLocator } from "./driver.js"

const { browserFn } = createRequire(__filename)("./browser-fn.cjs") as {
  browserFn: (source: string) => string
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
  ) {}

  toSelector(): string {
    return this.selector
  }

  private resolveIndex(list: Element[]): number {
    if (this.index < 0) return Math.max(0, list.length + this.index)
    return this.index
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
    const pattern =
      this.textFilter instanceof RegExp
        ? `new RegExp(${JSON.stringify(this.textFilter.source)}, ${JSON.stringify(this.textFilter.flags)})`
        : "null"
    const idxExpr = this.index < 0 ? `Math.max(0, list.length + ${this.index})` : String(this.index)
    const prelude = `
      var nodes = [...document.querySelectorAll(${JSON.stringify(this.selector)})];
      var list = nodes;
      var pattern = ${pattern};
      if (pattern) list = nodes.filter(function(n){ return pattern.test(n.getAttribute("aria-label") || n.textContent || ""); });
      var el = list[${idxExpr}];
      if (!el) throw new Error("no element for ${this.selector}");
    `
    if (!isAsync) {
      return this.wd.execute(`${prelude} return (${fnBody})(el);`) as Promise<R>
    }
    const script = `${prelude} var cb = arguments[arguments.length - 1]; Promise.resolve((${fnBody})(el)).then(cb).catch(function(e){ cb({ __error: String(e) }); });`
    return runAsync<R>(this.wd, script)
  }

  click(options?: { timeout?: number; button?: "left" | "right" | "middle" }): Promise<void> {
    const timeout = options?.timeout ?? 10_000
    return this.wd.waitUntil(
      async () => {
        await this.wd.execute(
          (sel, idx, pattern, flags, button) => {
            const nodes = [...document.querySelectorAll(sel)]
            let list = nodes
            if (pattern) {
              const re = new RegExp(pattern, flags)
              list = nodes.filter(n => re.test(n.getAttribute("aria-label") ?? n.textContent ?? ""))
            }
            const resolved = idx < 0 ? Math.max(0, list.length + idx) : idx
            const el = list[resolved] as HTMLElement | undefined
            if (!el) throw new Error("missing element")
            el.scrollIntoView({ block: "nearest", inline: "nearest" })
            const rect = el.getBoundingClientRect()
            const x = rect.left + rect.width / 2
            const y = rect.top + rect.height / 2
            if (button === "right") {
              el.dispatchEvent(new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                button: 2,
                buttons: 2,
                clientX: x,
                clientY: y,
              }))
            } else {
              el.focus({ preventScroll: true })
              const eventInit = { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: x, clientY: y }
              el.dispatchEvent(new MouseEvent("mousedown", eventInit))
              el.dispatchEvent(new MouseEvent("mouseup", { ...eventInit, buttons: 0 }))
              el.dispatchEvent(new MouseEvent("click", { ...eventInit, buttons: 0 }))
            }
          },
          this.selector,
          this.index,
          this.textFilter instanceof RegExp ? this.textFilter.source : (this.textFilter ?? ""),
          this.textFilter instanceof RegExp ? this.textFilter.flags : "",
          options?.button ?? "left",
        )
        return true
      },
      { timeout, timeoutMsg: `click timeout ${this.selector}` },
    ).then(() => undefined)
  }

  async fill(value: string): Promise<void> {
    await this.wd.execute(
      (sel, idx, pattern, flags, text) => {
        const nodes = [...document.querySelectorAll(sel)]
        let list = nodes
        if (pattern) {
          const re = new RegExp(pattern, flags)
          list = nodes.filter(n => re.test(n.getAttribute("aria-label") ?? n.textContent ?? ""))
        }
        const resolved = idx < 0 ? Math.max(0, list.length + idx) : idx
        const el = list[resolved] as HTMLElement | undefined
        if (!el) throw new Error("missing input")
        el.focus()
        const fillable =
          el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable
            ? el
            : (el.querySelector("input,textarea,[contenteditable=true]") as HTMLElement | null)
        if (!fillable) {
          el.focus()
          document.execCommand("insertText", false, text)
        } else if (fillable instanceof HTMLInputElement || fillable instanceof HTMLTextAreaElement) {
          const setter = Object.getOwnPropertyDescriptor(
            fillable instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
            "value",
          )?.set
          setter?.call(fillable, text)
          fillable.dispatchEvent(new Event("input", { bubbles: true }))
          fillable.dispatchEvent(new Event("change", { bubbles: true }))
          return
        } else {
          fillable.textContent = text
        }
        el.dispatchEvent(new Event("input", { bubbles: true }))
        el.dispatchEvent(new Event("change", { bubbles: true }))
      },
      this.selector,
      this.index,
      this.textFilter instanceof RegExp ? this.textFilter.source : (this.textFilter ?? ""),
      this.textFilter instanceof RegExp ? this.textFilter.flags : "",
      value,
    )
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
    return new TauriLocator(this.wd, this.selector, 0, this.textFilter)
  }

  nth(index: number): ShellLocator {
    return new TauriLocator(this.wd, this.selector, index, this.textFilter)
  }

  filter(options: { hasText?: string | RegExp }): ShellLocator {
    return new TauriLocator(this.wd, this.selector, this.index, options.hasText)
  }

  last(): ShellLocator {
    return new TauriLocator(this.wd, this.selector, -1, this.textFilter)
  }

  async getAttribute(name: string): Promise<string | null> {
    return this.wd.execute(
      (sel, idx, pattern, flags, attr) => {
        const nodes = [...document.querySelectorAll(sel)]
        let list = nodes
        if (pattern) {
          const re = new RegExp(pattern, flags)
          list = nodes.filter(n => re.test(n.getAttribute("aria-label") ?? n.textContent ?? ""))
        }
        const resolved = idx < 0 ? Math.max(0, list.length + idx) : idx
        const el = list[resolved]
        return el?.getAttribute(attr) ?? null
      },
      this.selector,
      this.index,
      this.textFilter instanceof RegExp ? this.textFilter.source : (this.textFilter ?? ""),
      this.textFilter instanceof RegExp ? this.textFilter.flags : "",
      name,
    ) as Promise<string | null>
  }

  async textContent(): Promise<string | null> {
    return this.withElement(el => el.textContent)
  }

  getByRole(role: string, options?: { name?: string | RegExp }): ShellLocator {
    const name = options?.name
    const namePattern = name instanceof RegExp ? name.source : name ?? ""
    const flags = name instanceof RegExp ? name.flags : "i"
    const sel = `${this.selector} [role="${role}"]`
    return new TauriLocator(this.wd, sel, 0, namePattern ? new RegExp(namePattern, flags) : undefined)
  }

  locator(selector: string): ShellLocator {
    const scoped = `${this.selector} ${selector}`
    return new TauriLocator(this.wd, scoped, 0, this.textFilter)
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
    const isAsync = /\basync\b/.test(pageFunction.toString())
    const pattern =
      this.textFilter instanceof RegExp
        ? `new RegExp(${JSON.stringify(this.textFilter.source)}, ${JSON.stringify(this.textFilter.flags)})`
        : "null"
    const idxExpr = this.index < 0 ? `Math.max(0, list.length + ${this.index})` : String(this.index)
    const argLiteral = arg === undefined ? "" : JSON.stringify(arg)
    const prelude = `
      var nodes = [...document.querySelectorAll(${JSON.stringify(this.selector)})];
      var list = nodes;
      var pattern = ${pattern};
      if (pattern) list = nodes.filter(function(n){ return pattern.test(n.getAttribute("aria-label") || n.textContent || ""); });
      var el = list[${idxExpr}];
      if (!el) throw new Error("no element for ${this.selector}");
    `
    if (!isAsync) {
      const call = arg === undefined ? `(${fnBody})(el)` : `(${fnBody})(el, ${argLiteral})`
      const script = `${prelude} var cb = arguments[arguments.length - 1]; try { Promise.resolve(${call}).then(cb).catch(function(e){ cb({ __error: String(e) }); }); } catch (e) { cb({ __error: String(e) }); }`
      return runAsync<R>(this.wd, script)
    }
    const call = arg === undefined ? `(${fnBody})(el)` : `(${fnBody})(el, ${argLiteral})`
    const script = `${prelude} var cb = arguments[arguments.length - 1]; Promise.resolve(${call}).then(cb).catch(function(e){ cb({ __error: String(e) }); });`
    return runAsync<R>(this.wd, script)
  }

  async isVisible(): Promise<boolean> {
    return this.wd.execute(
      (sel, idx, pattern, flags) => {
        const nodes = [...document.querySelectorAll(sel)]
        let list = nodes
        if (pattern) {
          const re = new RegExp(pattern, flags)
          list = nodes.filter(n => re.test(n.getAttribute("aria-label") ?? n.textContent ?? ""))
        }
        const resolved = idx < 0 ? Math.max(0, list.length + idx) : idx
        const el = list[resolved] as HTMLElement | undefined
        if (!el) return false
        const cs = getComputedStyle(el)
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      },
      this.selector,
      this.index,
      this.textFilter instanceof RegExp ? this.textFilter.source : (this.textFilter ?? ""),
      this.textFilter instanceof RegExp ? this.textFilter.flags : "",
    ) as Promise<boolean>
  }

  async count(): Promise<number> {
    return this.wd.execute(
      (sel, pattern, flags) => {
        const nodes = [...document.querySelectorAll(sel)]
        if (!pattern) return nodes.length
        const re = new RegExp(pattern, flags)
        return nodes.filter(n => re.test(n.getAttribute("aria-label") ?? n.textContent ?? "")).length
      },
      this.selector,
      this.textFilter instanceof RegExp ? this.textFilter.source : (this.textFilter ?? ""),
      this.textFilter instanceof RegExp ? this.textFilter.flags : "",
    ) as Promise<number>
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

async function ensureKeyboardFocus(wd: TauriWebDriver): Promise<void> {
  await wd.execute(() => {
    const active = document.activeElement as HTMLElement | null
    if (active && active !== document.body && active !== document.documentElement) return
    const candidates = [
      document.querySelector<HTMLElement>("[data-jet-terminal-panel] .xterm-helper-textarea"),
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

function dispatchKey(wd: TauriWebDriver, key: string): Promise<void> {
  const parts = key.split("+")
  const mainName = parts.pop() ?? key
  const main = keyValue(mainName)
  const modifiers = parts.map(keyValue)
  if (modifiers.length > 0 || mainName === "Escape") {
    return ensureKeyboardFocus(wd).then(() => wd.execute(
      (pressedKey, modifierNames) => {
        const target = document.activeElement ?? document.body
        const init = {
          bubbles: true,
          cancelable: true,
          key: pressedKey === "Space" ? " " : pressedKey,
          code: pressedKey === "Space" ? "Space" : pressedKey,
          altKey: modifierNames.includes("Alt"),
          ctrlKey: modifierNames.includes("Control") || modifierNames.includes("Ctrl"),
          metaKey: modifierNames.includes("Meta"),
          shiftKey: modifierNames.includes("Shift"),
        }
        target.dispatchEvent(new KeyboardEvent("keydown", init))
        target.dispatchEvent(new KeyboardEvent("keyup", init))
      },
      mainName,
      parts,
    ))
  }
  return ensureKeyboardFocus(wd).then(() => wd.sendKeys(main))
}

export function wrapTauriWebDriver(wd: TauriWebDriver): ShellDriver {
  const heldModifiers = new Set<string>()
  const keyboard = {
    press: (key: string) => dispatchKey(wd, key),
    type: async (text: string) => {
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
          const el = document.elementFromPoint(px, py)
          el?.dispatchEvent(new MouseEvent("mousemove", {
            bubbles: true,
            clientX: px,
            clientY: py,
            ...modifiers,
          }))
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
          const el = document.elementFromPoint(px, py) as HTMLElement | null
          const init = { bubbles: true, clientX: px, clientY: py, ...modifiers }
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
      const script = `var cb = arguments[arguments.length - 1]; Promise.resolve(${call}).then(cb).catch(function(e){ cb({ __error: String(e) }); });`
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
      const sel = `[role="${role}"]`
      const filter = name instanceof RegExp ? name : name ? new RegExp(name, "i") : undefined
      return new TauriLocator(wd, sel, 0, filter)
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
  }
}

export { serializeScript }
