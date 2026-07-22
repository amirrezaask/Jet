import type { Page } from "@playwright/test"
import type { ShellDriver, ShellLocator } from "./driver.js"

class PlaywrightLocator implements ShellLocator {
  constructor(
    private readonly page: Page,
    private readonly selector: string,
    readonly pw = page.locator(selector),
  ) {}

  toSelector(): string {
    return this.selector
  }

  click(options?: { timeout?: number }): Promise<void> {
    return this.pw.first().click(options)
  }

  fill(value: string): Promise<void> {
    return this.pw.first().fill(value)
  }

  press(key: string): Promise<void> {
    return this.pw.first().press(key)
  }

  focus(): Promise<void> {
    return this.pw.first().focus()
  }

  hover(): Promise<void> {
    return this.pw.first().hover()
  }

  first(): ShellLocator {
    return new PlaywrightLocator(this.page, this.selector, this.pw.first())
  }

  nth(index: number): ShellLocator {
    return new PlaywrightLocator(this.page, this.selector, this.pw.nth(index))
  }

  filter(
    options: { hasText?: string | RegExp } | { has?: ShellLocator; hasNot?: ShellLocator },
  ): ShellLocator {
    if ("hasText" in options && options.hasText != null) {
      return new PlaywrightLocator(this.page, this.selector, this.pw.filter({ hasText: options.hasText }))
    }
    const pwOpts: { has?: ReturnType<Page["locator"]>; hasNot?: ReturnType<Page["locator"]> } = {}
    if ("has" in options && options.has instanceof PlaywrightLocator) pwOpts.has = options.has.pw
    if ("hasNot" in options && options.hasNot instanceof PlaywrightLocator) pwOpts.hasNot = options.hasNot.pw
    return new PlaywrightLocator(this.page, this.selector, this.pw.filter(pwOpts))
  }

  last(): ShellLocator {
    return new PlaywrightLocator(this.page, this.selector, this.pw.last())
  }

  getAttribute(name: string): Promise<string | null> {
    return this.pw.first().getAttribute(name)
  }

  textContent(): Promise<string | null> {
    return this.pw.first().textContent()
  }

  waitFor(options?: { state?: "visible" | "attached" | "hidden"; timeout?: number }): Promise<void> {
    return this.pw.first().waitFor(options)
  }

  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return this.pw.first().boundingBox()
  }

  evaluate<R, Arg>(pageFunction: (arg: Arg, element: Element) => R | Promise<R>, arg: Arg): Promise<R>
  evaluate<R>(pageFunction: (element: Element) => R | Promise<R>): Promise<R>
  evaluate<R, Arg>(
    pageFunction: ((arg: Arg, element: Element) => R | Promise<R>) | ((element: Element) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    if (arg === undefined) {
      return this.pw.first().evaluate(pageFunction as (element: Element) => R | Promise<R>)
    }
    return this.pw.first().evaluate(pageFunction as (arg: Arg, element: Element) => R | Promise<R>, arg)
  }

  isVisible(): Promise<boolean> {
    return this.pw.first().isVisible()
  }

  count(): Promise<number> {
    return this.pw.count()
  }

  getByRole(role: string, options?: { name?: string | RegExp }): ShellLocator {
    const inner = this.pw.getByRole(role as Parameters<Page["getByRole"]>[0], {
      ...options,
      exact: typeof options?.name === "string",
    })
    return new PlaywrightLocator(
      this.page,
      `${this.selector} >> role=${role}`,
      inner as ReturnType<Page["locator"]>,
    )
  }

  locator(selector: string): ShellLocator {
    return new PlaywrightLocator(
      this.page,
      `${this.selector} >> ${selector}`,
      this.pw.locator(selector),
    )
  }
}

export function wrapPlaywrightPage(page: Page): ShellDriver {
  return {
    evaluate<R, Arg>(pageFunction: ((arg: Arg) => R | Promise<R>) | (() => R | Promise<R>), arg?: Arg): Promise<R> {
      if (arg === undefined) {
        return page.evaluate(pageFunction as () => R | Promise<R>)
      }
      return page.evaluate(pageFunction as (arg: Arg) => R | Promise<R>, arg)
    },
    waitForFunction(pageFunction, arg, options) {
      return page.waitForFunction(pageFunction, arg, options).then(() => undefined)
    },
    waitForSelector(selector, options) {
      return page.waitForSelector(selector, options).then(() => undefined)
    },
    waitForTimeout(ms) {
      return page.waitForTimeout(ms)
    },
    waitForLoadState(state) {
      return page.waitForLoadState(state)
    },
    keyboard: page.keyboard,
    mouse: page.mouse,
    locator(selector) {
      return new PlaywrightLocator(page, selector)
    },
    getByRole(role, options) {
      const pw = page.getByRole(role as Parameters<Page["getByRole"]>[0], {
        ...options,
        exact: typeof options?.name === "string",
      })
      return new PlaywrightLocator(page, `[role="${role}"]`, pw as ReturnType<Page["locator"]>)
    },
    getByPlaceholder(text) {
      const pw = page.getByPlaceholder(text)
      return new PlaywrightLocator(page, "placeholder", pw as ReturnType<Page["locator"]>)
    },
    getByLabel(text) {
      const pw = page.getByLabel(text)
      return new PlaywrightLocator(page, "label", pw as ReturnType<Page["locator"]>)
    },
    async isVisible(selector) {
      return page.locator(selector).first().isVisible()
    },
    async count(selector) {
      return page.locator(selector).count()
    },
    async textContent(selector) {
      return (await page.locator(selector).textContent()) ?? ""
    },
    async clickSelector(selector) {
      await page.locator(selector).click()
    },
    async fillSelector(selector, value) {
      await page.locator(selector).fill(value)
    },
    async screenshot() {
      return (await page.screenshot({ type: "png" })).toString("base64")
    },
    reload() {
      return page.reload().then(() => undefined)
    },
  }
}
