#!/usr/bin/env tsx
import { readdirSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"

const SCENARIO_DIR = resolve(new URL(".", import.meta.url).pathname, "scenarios")
const RUNNER = resolve(new URL(".", import.meta.url).pathname, "runner.ts")

const scenarios = readdirSync(SCENARIO_DIR)
  .filter(f => f.endsWith(".json"))
  .map(f => resolve(SCENARIO_DIR, f))

type RunResult = {
  scenario: string
  exit: number
  screenshots: string[]
  a11y_snapshots?: string[]
  dom_dumps?: string[]
  error?: string
}

let failed = 0
const summary: RunResult[] = []

for (const s of scenarios) {
  const res = spawnSync("tsx", [RUNNER, "--scenario", s], { stdio: ["ignore", "pipe", "inherit"] })
  const out = res.stdout.toString().trim().split("\n").filter(Boolean).pop() ?? "{}"
  try {
    const parsed = JSON.parse(out) as RunResult
    summary.push(parsed)
    if (parsed.exit !== 0) failed++
  } catch {
    failed++
    summary.push({ scenario: s, exit: 1, screenshots: [], error: "unparseable runner output" })
  }
}

process.stdout.write(JSON.stringify({ total: scenarios.length, failed, results: summary }, null, 2) + "\n")
process.exit(failed > 0 ? 1 : 0)
