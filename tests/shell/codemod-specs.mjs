#!/usr/bin/env node
/**
 * Mechanical port: expect(page.locator|getByRole) → shell assert helpers.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const specDir = path.resolve(__dirname, "../electron")

const files = fs.readdirSync(specDir).filter(f => f.endsWith(".electron.spec.ts") && !f.includes("agents"))

const assertImport =
  'import {\n  expectContainsText,\n  expectLocatorAttached,\n  expectLocatorAttribute,\n  expectLocatorCount,\n  expectLocatorFocused,\n  expectLocatorHidden,\n  expectLocatorVisible,\n  expectSelectorHidden,\n  expectSelectorVisible,\n} from "../shell/assert.js"\n'

for (const file of files) {
  const fp = path.join(specDir, file)
  let src = fs.readFileSync(fp, "utf8")
  if (src.includes("../shell/assert.js")) continue

  src = src.replace(
    /import \{ expect, test \} from "@playwright\/test"/,
    'import { expect, test } from "@playwright/test"\n' + assertImport,
  )

  // expect(page.locator("sel")).toBeVisible({ timeout: N })
  src = src.replace(
    /await expect\(page\.locator\(([^)]+)\)\)\.toBeVisible\(\{ timeout: ([^}]+) \}\)/g,
    "await expectSelectorVisible(page, $1, { timeout: $2 })",
  )
  src = src.replace(
    /await expect\(page\.locator\(([^)]+)\)\)\.toBeVisible\(\)/g,
    "await expectSelectorVisible(page, $1)",
  )

  src = src.replace(
    /await expect\(page\.locator\(([^)]+)\)\)\.toBeHidden\(\)/g,
    "await expectSelectorHidden(page, $1)",
  )

  src = src.replace(
    /await expect\(page\.locator\(([^)]+)\)\)\.toBeAttached\(\)/g,
    "await expectLocatorAttached(page.locator($1))",
  )

  src = src.replace(
    /await expect\(page\.locator\(([^)]+)\)\)\.toHaveCount\((\d+)(?:, \{ timeout: ([^}]+) \})?\)/g,
    (_m, sel, n, t) =>
      t
        ? `await expectLocatorCount(page.locator(${sel}), ${n}, { timeout: ${t} })`
        : `await expectLocatorCount(page.locator(${sel}), ${n})`,
  )

  src = src.replace(
    /await expect\(page\.locator\(([^)]+)\)\)\.toContainText\(([^)]+)(?:, \{ timeout: ([^}]+) \})?\)/g,
    (_m, sel, text, t) =>
      t
        ? `await expectContainsText(page, ${sel}, ${text}, { timeout: ${t} })`
        : `await expectContainsText(page, ${sel}, ${text})`,
  )

  src = src.replace(
    /await expect\(page\.locator\(([^)]+)\)\)\.toHaveAttribute\(\s*([^,]+),\s*([^,)]+)(?:, \{ timeout: ([^}]+) \})?\)/g,
    (_m, sel, attr, val, t) =>
      t
        ? `await expectLocatorAttribute(page.locator(${sel}), ${attr}, ${val}, { timeout: ${t} })`
        : `await expectLocatorAttribute(page.locator(${sel}), ${attr}, ${val})`,
  )

  src = src.replace(
    /await expect\(page\.getByRole\(([^)]+)\)\)\.toBeVisible\(\)/g,
    "await expectLocatorVisible(page.getByRole($1))",
  )

  src = src.replace(
    /await expect\(page\.getByRole\(([^)]+)\)\)\.toHaveCount\((\d+)\)/g,
    "await expectLocatorCount(page.getByRole($1), $2)",
  )

  // locator chains: expect(page.locator(X).filter(...)).toBeVisible
  src = src.replace(
    /await expect\(page\.locator\(([^)]+)\)\.filter\(\{ hasText: ([^}]+) \}\)\.first\(\)\)\.toBeVisible\(\)/g,
    "await expectLocatorVisible(page.locator($1).filter({ hasText: $2 }).first())",
  )

  // paletteInput.toBeFocused via poll
  src = src.replace(
    /await expect\((\w+)\)\.toBeFocused\(\)/g,
    "await expectLocatorFocused($1)",
  )

  // expect(locator).not.toHaveCount(0)
  src = src.replace(
    /await expect\(([^)]+)\)\.not\.toHaveCount\(0\)/g,
    "await expect.poll(() => $1.count()).toBeGreaterThan(0)",
  )

  fs.writeFileSync(fp, src)
  console.log("updated", file)
}
