import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { resolve } from "node:path"
import { test, expect } from "@playwright/test"

const SCENARIO_DIR = resolve("tests/visual/scenarios")
const RUNNER = resolve("tests/visual/runner.ts")

const scenarios = readdirSync(SCENARIO_DIR)
  .filter(f => f.endsWith(".json"))
  .sort()

for (const scenario of scenarios) {
  test(`visual scenario: ${scenario}`, () => {
    const scenarioPath = resolve(SCENARIO_DIR, scenario)
    const res = spawnSync("tsx", [RUNNER, "--scenario", scenarioPath], {
      encoding: "utf8",
      env: { ...process.env, JET_BASE_URL: process.env.JET_BASE_URL ?? "http://localhost:5174" },
    })
    const outLine = res.stdout.trim().split("\n").filter(Boolean).pop() ?? "{}"
    let parsed: { exit?: number; error?: string }
    try {
      parsed = JSON.parse(outLine) as { exit?: number; error?: string }
    } catch {
      throw new Error(`unparseable runner output for ${scenario}: ${res.stdout}\n${res.stderr}`)
    }
    expect(parsed.exit, parsed.error ?? res.stderr).toBe(0)
  })
}
