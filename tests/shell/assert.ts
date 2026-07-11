import { expect } from "@playwright/test"
import type { ShellDriver, ShellLocator } from "./driver.js"

export async function expectLocatorVisible(loc: ShellLocator, options?: { timeout?: number }): Promise<void> {
  const timeout = options?.timeout ?? 10_000
  await expect.poll(() => loc.isVisible(), { timeout }).toBe(true)
}

export async function expectLocatorHidden(loc: ShellLocator, options?: { timeout?: number }): Promise<void> {
  const timeout = options?.timeout ?? 10_000
  await expect.poll(() => loc.isVisible(), { timeout }).toBe(false)
}

export async function expectLocatorCount(loc: ShellLocator, count: number, options?: { timeout?: number }): Promise<void> {
  const timeout = options?.timeout ?? 10_000
  await expect.poll(() => loc.count(), { timeout }).toBe(count)
}

export async function expectLocatorAttached(loc: ShellLocator, options?: { timeout?: number }): Promise<void> {
  const timeout = options?.timeout ?? 10_000
  await expect.poll(() => loc.count(), { timeout }).toBeGreaterThan(0)
}

export async function expectSelectorVisible(page: ShellDriver, selector: string, options?: { timeout?: number }): Promise<void> {
  await expectLocatorVisible(page.locator(selector), options)
}

export async function expectSelectorHidden(page: ShellDriver, selector: string, options?: { timeout?: number }): Promise<void> {
  await expectLocatorHidden(page.locator(selector), options)
}

export async function expectContainsText(
  page: ShellDriver,
  selector: string,
  text: string | RegExp,
  options?: { timeout?: number },
): Promise<void> {
  const timeout = options?.timeout ?? 10_000
  await expect
    .poll(async () => {
      const body = await page.textContent(selector)
      return typeof text === "string" ? body.includes(text) : text.test(body)
    }, { timeout })
    .toBe(true)
}

export async function expectNotContainsText(
  page: ShellDriver,
  selector: string,
  text: string,
  options?: { timeout?: number },
): Promise<void> {
  const timeout = options?.timeout ?? 10_000
  await expect.poll(async () => !(await page.textContent(selector)).includes(text), { timeout }).toBe(true)
}

export async function expectLocatorContainsText(
  loc: ShellLocator,
  text: string | RegExp,
  options?: { timeout?: number },
): Promise<void> {
  const timeout = options?.timeout ?? 10_000
  await expect
    .poll(async () => {
      const body = await loc.evaluate(el => el.textContent ?? "")
      return typeof text === "string" ? body.includes(text) : text.test(body)
    }, { timeout })
    .toBe(true)
}

export async function expectLocatorFocused(loc: ShellLocator, options?: { timeout?: number }): Promise<void> {
  const timeout = options?.timeout ?? 10_000
  await expect
    .poll(() => loc.evaluate(el => document.activeElement === el || el.contains(document.activeElement)), { timeout })
    .toBe(true)
}

export async function expectLocatorAttribute(
  loc: ShellLocator,
  name: string,
  value: string,
  options?: { timeout?: number },
): Promise<void> {
  const timeout = options?.timeout ?? 10_000
  await expect.poll(() => loc.evaluate((el, attr) => el.getAttribute(attr), name), { timeout }).toBe(value)
}

export async function expectRoleCount(page: ShellDriver, role: string, count: number, options?: { timeout?: number }): Promise<void> {
  const timeout = options?.timeout ?? 10_000
  await expect.poll(() => page.count(`[role="${role}"]`), { timeout }).toBe(count)
}

export async function expectRoleVisible(page: ShellDriver, role: string, options?: { timeout?: number }): Promise<void> {
  await expectSelectorVisible(page, `[role="${role}"]`, options)
}

export async function expectDialogCount(page: ShellDriver, count: number, options?: { timeout?: number }): Promise<void> {
  await expectRoleCount(page, "dialog", count, options)
}
