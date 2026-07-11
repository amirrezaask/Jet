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

  private async withElement<R>(fn: (el: Element) => R | Promise<R>): Promise<R> {
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
      if (pattern) list = nodes.filter(function(n){ return pattern.test(n.textContent || ""); });
      var el = list[${idxExpr}];
      if (!el) throw new Error("no element for ${this.selector}");
    `
    if (!isAsync) {
      return this.wd.execute(`${prelude} return (${fnBody})(el);`) as Promise<R>
    }
    const script = `${prelude} var cb = arguments[arguments.length - 1]; Promise.resolve((${fnBody})(el)).then(cb).catch(function(e){ cb({ __error: String(e) }); });`
    return runAsync<R>(this.wd, script)
  }

  click(options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? 10_000
    return this.wd.waitUntil(
      async () => {
        await this.wd.execute(
          (sel, idx, pattern, flags) => {
            const nodes = [...document.querySelectorAll(sel)]
            let list = nodes
            if (pattern) {
              const re = new RegExp(pattern, flags)
              list = nodes.filter(n => re.test(n.textContent ?? ""))
            }
            const resolved = idx < 0 ? Math.max(0, list.length + idx) : idx
            const el = list[resolved] as HTMLElement | undefined
            if (!el) throw new Error("missing element")
            el.click()
          },
          this.selector,
          this.index,
          this.textFilter instanceof RegExp ? this.textFilter.source : (this.textFilter ?? ""),
          this.textFilter instanceof RegExp ? this.textFilter.flags : "",
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
          list = nodes.filter(n => re.test(n.textContent ?? ""))
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
    return dispatchKey(this.wd, key)
  }

  async focus(): Promise<void> {
    await this.withElement(el => {
      ;(el as HTMLElement).focus()
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
          list = nodes.filter(n => re.test(n.textContent ?? ""))
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
  evaluate<R, Arg>(
    pageFunction: ((arg: Arg, element: Element) => R | Promise<R>) | ((element: Element) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
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
      if (pattern) list = nodes.filter(function(n){ return pattern.test(n.textContent || ""); });
      var el = list[${idxExpr}];
      if (!el) throw new Error("no element for ${this.selector}");
    `
    if (!isAsync) {
      const script =
        arg === undefined
          ? `${prelude} var cb = arguments[arguments.length - 1]; Promise.resolve((${fnBody})(el)).then(cb).catch(function(e){ cb({ __error: String(e) }); });`
          : `${prelude} var cb = arguments[arguments.length - 1]; Promise.resolve((${fnBody})(el, ${argLiteral})).then(cb).catch(function(e){ cb({ __error: String(e) }); });`
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
          list = nodes.filter(n => re.test(n.textContent ?? ""))
        }
        const el = list[idx] as HTMLElement | undefined
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
        return nodes.filter(n => re.test(n.textContent ?? "")).length
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

function dispatchKey(wd: TauriWebDriver, key: string): Promise<void> {
  const map: Record<string, { key: string; code?: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }> = {
    Enter: { key: "Enter", code: "Enter" },
    Escape: { key: "Escape", code: "Escape" },
    Tab: { key: "Tab", code: "Tab" },
    Home: { key: "Home", code: "Home" },
    ArrowRight: { key: "ArrowRight", code: "ArrowRight" },
    ArrowDown: { key: "ArrowDown", code: "ArrowDown" },
    ArrowUp: { key: "ArrowUp", code: "ArrowUp" },
    ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft" },
    Backspace: { key: "Backspace", code: "Backspace" },
    "Meta+Enter": { key: "Enter", code: "Enter", metaKey: true },
    "Control+Space": { key: " ", code: "Space", ctrlKey: true },
    "Meta+z": { key: "z", code: "KeyZ", metaKey: true },
    "Meta+Shift+z": { key: "z", code: "KeyZ", metaKey: true, shiftKey: true },
    F12: { key: "F12", code: "F12" },
  }
  if (key.includes("+") && !map[key]) {
    const parts = key.split("+")
    const main = parts[parts.length - 1]!
    const chord = {
      key: main.length === 1 ? main : main,
      code: main.length === 1 ? `Key${main.toUpperCase()}` : main,
      metaKey: parts.includes("Meta"),
      ctrlKey: parts.includes("Control") || parts.includes("Ctrl"),
      shiftKey: parts.includes("Shift"),
      altKey: parts.includes("Alt"),
    }
    return wd.execute(ch => {
      const cm = document.querySelector(".cm-content")
      const term = document.querySelector("[data-jet-terminal-panel] .xterm-helper-textarea")
      const target = (term ?? cm ?? document.activeElement ?? document.body) as HTMLElement
      target.focus()
      const opts = {
        key: ch.key,
        code: ch.code,
        bubbles: true,
        cancelable: true,
        metaKey: !!ch.metaKey,
        ctrlKey: !!ch.ctrlKey,
        shiftKey: !!ch.shiftKey,
        altKey: !!ch.altKey,
      }
      target.dispatchEvent(new KeyboardEvent("keydown", opts))
      target.dispatchEvent(new KeyboardEvent("keyup", opts))
    }, chord) as Promise<void>
  }
  const chord = map[key] ?? { key, code: key }
  return wd.execute(ch => {
    const cm = document.querySelector(".cm-content")
    const term = document.querySelector("[data-jet-terminal-panel] .xterm-helper-textarea")
    const target = (term ?? cm ?? document.activeElement ?? document.body) as HTMLElement
    target.focus()
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ch.key,
        code: ch.code,
        bubbles: true,
        cancelable: true,
        metaKey: !!ch.metaKey,
        ctrlKey: !!ch.ctrlKey,
        shiftKey: !!ch.shiftKey,
        altKey: !!ch.altKey,
      }),
    )
    if (ch.key.length === 1 && !ch.metaKey && !ch.ctrlKey && !ch.shiftKey && !ch.altKey) {
      target.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: ch.key }))
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ch.key }))
    }
    target.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: ch.key,
        code: ch.code,
        bubbles: true,
        metaKey: !!ch.metaKey,
        ctrlKey: !!ch.ctrlKey,
        shiftKey: !!ch.shiftKey,
        altKey: !!ch.altKey,
      }),
    )
  }, chord) as Promise<void>
}

export function wrapTauriWebDriver(wd: TauriWebDriver): ShellDriver {
  const keyboard = {
    press: (key: string) => dispatchKey(wd, key),
    type: async (text: string) => {
      await wd.execute(t => {
        const cm = document.querySelector(".cm-content")
        const term = document.querySelector("[data-jet-terminal-panel] .xterm-helper-textarea")
        const target = (term ?? cm ?? document.activeElement ?? document.body) as HTMLElement
        target.focus()
        for (const ch of t) {
          target.dispatchEvent(
            new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true }),
          )
          const inserted = document.execCommand("insertText", false, ch)
          if (!inserted) {
            target.dispatchEvent(
              new InputEvent("beforeinput", {
                bubbles: true,
                cancelable: true,
                inputType: "insertText",
                data: ch,
              }),
            )
            target.dispatchEvent(
              new InputEvent("input", { bubbles: true, inputType: "insertText", data: ch }),
            )
          }
          target.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }))
        }
      }, text)
    },
    down: (key: string) =>
      wd.execute(k => {
        const target = document.activeElement ?? document.body
        target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, [`${k.toLowerCase()}Key`]: true }))
      }, key === "Meta" ? "Meta" : key),
    up: (key: string) =>
      wd.execute(k => {
        const target = document.activeElement ?? document.body
        target.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true }))
      }, key === "Meta" ? "Meta" : key),
  }

  const mouse = {
    move: async (x: number, y: number) => {
      await wd.execute(
        (px, py) => {
          const el = document.elementFromPoint(px, py)
          el?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: px, clientY: py }))
        },
        x,
        y,
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
        (px, py) => {
          const el = document.elementFromPoint(px, py) as HTMLElement | null
          el?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: px, clientY: py }))
          el?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: px, clientY: py }))
          el?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: px, clientY: py }))
        },
        x,
        y,
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
