/** Minimal page surface shared by Electron Playwright and Tauri WebDriver shells. */
export type ShellDriver = {
  evaluate<R, Arg>(pageFunction: (arg: Arg) => R | Promise<R>, arg: Arg): Promise<R>
  evaluate<R>(pageFunction: () => R | Promise<R>): Promise<R>
  waitForFunction<R>(
    pageFunction: (arg: R) => boolean | Promise<boolean>,
    arg: R,
    options?: { timeout?: number },
  ): Promise<void>
  waitForSelector(selector: string, options?: { timeout?: number; state?: "attached" | "visible" }): Promise<void>
  waitForTimeout(ms: number): Promise<void>
  waitForLoadState(state?: "load" | "domcontentloaded"): Promise<void>
  keyboard: {
    press(key: string): Promise<void>
    type(text: string): Promise<void>
    down(key: string): Promise<void>
    up(key: string): Promise<void>
  }
  mouse: {
    move(x: number, y: number, options?: { steps?: number }): Promise<void>
    down(): Promise<void>
    up(): Promise<void>
    click(x: number, y: number): Promise<void>
  }
  locator(selector: string): ShellLocator
  getByRole(role: string, options?: { name?: string | RegExp }): ShellLocator
  getByPlaceholder(text: string | RegExp): ShellLocator
  getByLabel(text: string | RegExp): ShellLocator
  isVisible(selector: string): Promise<boolean>
  count(selector: string): Promise<number>
  textContent(selector: string): Promise<string>
  clickSelector(selector: string): Promise<void>
  fillSelector(selector: string, value: string): Promise<void>
}

export type ShellLocator = {
  click(options?: { timeout?: number; button?: "left" | "right" | "middle" }): Promise<void>
  fill(value: string): Promise<void>
  press(key: string): Promise<void>
  focus(): Promise<void>
  hover(): Promise<void>
  first(): ShellLocator
  nth(index: number): ShellLocator
  filter(
    options: { hasText?: string | RegExp } | { has?: ShellLocator; hasNot?: ShellLocator },
  ): ShellLocator
  last(): ShellLocator
  getAttribute(name: string): Promise<string | null>
  textContent(): Promise<string | null>
  getByRole(role: string, options?: { name?: string | RegExp }): ShellLocator
  locator(selector: string): ShellLocator
  waitFor(options?: { state?: "visible" | "attached" | "hidden"; timeout?: number }): Promise<void>
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>
  evaluate<R, Arg>(pageFunction: (arg: Arg, element: Element) => R | Promise<R>, arg: Arg): Promise<R>
  evaluate<R>(pageFunction: (element: Element) => R | Promise<R>): Promise<R>
  isVisible(): Promise<boolean>
  count(): Promise<number>
  toSelector(): string
}

export type ShellApp = {
  close(): Promise<void>
}

export type LaunchShellResult = {
  app: ShellApp
  page: ShellDriver
}
