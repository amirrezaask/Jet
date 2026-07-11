#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const specDir = path.resolve(__dirname, "../electron")
const files = fs.readdirSync(specDir).filter(f => f.endsWith(".electron.spec.ts"))

for (const file of files) {
  const fp = path.join(specDir, file)
  let src = fs.readFileSync(fp, "utf8")

  src = src.replace(
    /await expect\(([^)]+)\)\.toBeVisible\(\{ timeout: ([^}]+) \}\)/g,
    "await expectLocatorVisible($1, { timeout: $2 })",
  )
  src = src.replace(/await expect\(([^)]+)\)\.toBeVisible\(\)/g, "await expectLocatorVisible($1)")

  src = src.replace(
    /await expect\(([^)]+)\)\.toContainText\(([^)]+), \{ timeout: ([^}]+) \}\)/g,
    "await expectLocatorContainsText($1, $2, { timeout: $3 })",
  )
  src = src.replace(/await expect\(([^)]+)\)\.toContainText\(([^)]+)\)/g, "await expectLocatorContainsText($1, $2)")

  src = src.replace(
    /await expect\(([^)]+)\)\.not\.toContainText\(([^)]+)(?:, \{ timeout: ([^}]+) \})?\)/g,
    (_m, loc, text, t) =>
      t
        ? `await expect.poll(async () => !(await ${loc}.evaluate(el => el.textContent ?? \"\")).includes(${text}), { timeout: ${t} }).toBe(true)`
        : `await expect.poll(async () => !(await ${loc}.evaluate(el => el.textContent ?? \"\")).includes(${text})).toBe(true)`,
  )

  src = src.replace(
    /await expect\(([^)]+)\)\.toHaveCount\((\d+)(?:, \{ timeout: ([^}]+) \})?\)/g,
    (_m, loc, n, t) =>
      t ? `await expectLocatorCount(${loc}, ${n}, { timeout: ${t} })` : `await expectLocatorCount(${loc}, ${n})`,
  )

  src = src.replace(
    /await expect\(([^)]+)\)\.toHaveAttribute\(\s*([^,]+),\s*([^,)]+)(?:, \{ timeout: ([^}]+) \})?\)/g,
    (_m, loc, attr, val, t) =>
      t
        ? `await expectLocatorAttribute(${loc}, ${attr}, ${val}, { timeout: ${t} })`
        : `await expectLocatorAttribute(${loc}, ${attr}, ${val})`,
  )

  src = src.replace(/await expect\(([^)]+)\)\.not\.toHaveCount\(0\)/g, "await expect.poll(() => $1.count()).toBeGreaterThan(0)")

  src = src.replace(/await expect\(([^)]+)\)\.not\.toBeEmpty\(\)/g, "await expect.poll(() => $1.evaluate(el => (el.textContent ?? \"\").trim().length)).toBeGreaterThan(0)")

  src = src.replace(
    /await expect\(page\.locator\(([^)]+)\)\)\.not\.toContainText\(([^)]+)\)/g,
    "await expectNotContainsText(page, $1, $2)",
  )

  src = src.replace(
    /await expect\(page\.getByRole\(([^)]+)\)\)\.toContainText\(([^)]+)\)/g,
    "await expectLocatorContainsText(page.getByRole($1), $2)",
  )

  src = src.replace(
    /await expect\(page\.locator\(([^)]+)\)\.first\(\)\)\.toBeVisible\(\)/g,
    "await expectLocatorVisible(page.locator($1).first())",
  )

  src = src.replace(
    /await expect\(page\.locator\(([^)]+)\)\)\.toHaveAttribute\(/g,
    "await expectLocatorAttribute(page.locator($1), ",
  )

  // fix broken toHaveAttribute from previous pass - already handled

  if (!src.includes("expectLocatorContainsText")) {
    src = src.replace(
      /from "\.\.\/shell\/assert\.js"/,
      'from "../shell/assert.js"\nimport { expectLocatorContainsText, expectNotContainsText } from "../shell/assert.js"',
    )
  }

  if (!src.includes("expectLocatorContainsText,") && src.includes("expectLocatorContainsText(")) {
    src = src.replace(
      /(import \{[^}]*)(} from "\.\.\/shell\/assert\.js")/,
      "$1,\n  expectLocatorContainsText,\n  expectNotContainsText$2",
    )
  }

  fs.writeFileSync(fp, src)
  console.log("pass2", file)
}
