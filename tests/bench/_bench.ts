import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect } from "@playwright/test"

export type BenchResult = {
  name: string
  median: number
  p95: number
  samples: number[]
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

export function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
  return sorted[idx]!
}

export type RunBenchOptions = {
  name: string
  warmup?: number
  rounds?: number
  measure: () => Promise<number>
}

export async function runBench(opts: RunBenchOptions): Promise<BenchResult> {
  const warmup = opts.warmup ?? 2
  const rounds = opts.rounds ?? 5
  for (let i = 0; i < warmup; i++) await opts.measure()
  const samples: number[] = []
  for (let i = 0; i < rounds; i++) samples.push(await opts.measure())
  return { name: opts.name, median: median(samples), p95: p95(samples), samples }
}

const budgetsPath = resolve(process.cwd(), "tests/bench/budgets.json")
const budgets = JSON.parse(readFileSync(budgetsPath, "utf8")) as Record<string, number>

export function assertBudget(result: BenchResult): void {
  const budget = budgets[result.name]
  if (budget == null) return
  const slack = Number(process.env.JET_BENCH_SLACK ?? 1.5)
  expect(result.median, `${result.name} median ${result.median}ms > budget ${budget}ms`).toBeLessThanOrEqual(
    budget * slack,
  )
}

export function logBenchResult(result: BenchResult): void {
  console.log(`[bench] ${result.name} median=${result.median.toFixed(1)}ms p95=${result.p95.toFixed(1)}ms`)
}
