#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repo = path.resolve(root, "../..")
const mode = process.argv.includes("--debug") ? "debug" : "release"
const roundsArg = process.argv.find(arg => arg.startsWith("--rounds="))
const rounds = Number(roundsArg?.split("=")[1] ?? 5)
if (!Number.isInteger(rounds) || rounds < 1) {
  throw new Error("--rounds must be a positive integer")
}
const target = path.join(root, "src-tauri", "target", mode)
const binary = path.join(target, process.platform === "win32" ? "jet-tauri.exe" : "jet-tauri")
const sample = path.join(repo, "fixtures", "sample-workspace")
const perfDir = path.join(os.homedir(), ".jet", "perf")
const logPath = path.join(perfDir, "startup.jsonl")
const summaryPath = path.join(perfDir, "startup-summary.json")
const runId = `${Date.now()}-${mode}`
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: repo,
  encoding: "utf8",
}).trim()

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: "inherit", env: process.env })
}

function readRunRecord(sampleIndex) {
  if (!fs.existsSync(logPath)) return null
  const lines = fs.readFileSync(logPath, "utf8").trim().split("\n").reverse()
  for (const line of lines) {
    if (!line) continue
    const record = JSON.parse(line)
    if (record.runId === runId && record.sample === String(sampleIndex)) return record
  }
  return null
}

async function waitForRecord(sampleIndex, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const record = readRunRecord(sampleIndex)
    if (record) return record
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`startup sample ${sampleIndex} did not reach Jet ready in ${timeoutMs}ms`)
}

function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]
}

run("pnpm", ["exec", "tauri", "build", "--no-bundle", ...(mode === "debug" ? ["--debug"] : [])])
fs.mkdirSync(perfDir, { recursive: true })

const records = []
for (let sampleIndex = 0; sampleIndex < rounds; sampleIndex++) {
  const child = spawn(binary, [sample], {
    cwd: root,
    stdio: "ignore",
    env: {
      ...process.env,
      JET_STARTUP_RUN_ID: runId,
      JET_STARTUP_SAMPLE: String(sampleIndex),
      JET_STARTUP_RUN_KIND: sampleIndex === 0 ? "cold" : "warm",
      JET_BUILD_COMMIT: commit,
    },
  })
  try {
    const record = await waitForRecord(sampleIndex)
    records.push(record)
    console.log(
      `[startup:${mode}] ${sampleIndex === 0 ? "cold" : "warm"} ` +
        `host=${Number(record.hostProcessElapsedMs).toFixed(1)}ms ` +
        `renderer=${Number(record.rendererReadyMs).toFixed(1)}ms`,
    )
  } finally {
    if (child.exitCode == null) {
      const exited = new Promise(resolve => child.once("exit", resolve))
      child.kill("SIGTERM")
      await exited
    }
  }
}

const values = records.map(record => Number(record.hostProcessElapsedMs))
const rendererValues = records.map(record => Number(record.rendererReadyMs))
const coldMs = values[0]
const warmValues = values.slice(1)
const warmMedian = warmValues.length > 0 ? percentile(warmValues, 0.5) : percentile(values, 0.5)
const rendererMedian = percentile(rendererValues, 0.5)
const summary = fs.existsSync(summaryPath)
  ? JSON.parse(fs.readFileSync(summaryPath, "utf8"))
  : {}
summary[mode] = {
  commit,
  recordedAt: new Date().toISOString(),
  rounds,
  coldMs,
  warmMedianMs: warmMedian,
  medianMs: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
  rendererMedianMs: rendererMedian,
  rendererP95Ms: percentile(rendererValues, 0.95),
  samplesMs: values,
}
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
console.log(`[startup:${mode}] persisted ${summaryPath}`)

if (mode === "release") {
  const budgetsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "startup-budgets.json")
  const budgets = JSON.parse(fs.readFileSync(budgetsPath, "utf8")).release
  const failures = []
  if (coldMs > budgets.coldHostMs) {
    failures.push(`cold host ${coldMs.toFixed(1)}ms > ${budgets.coldHostMs}ms`)
  }
  if (warmMedian > budgets.warmHostMedianMs) {
    failures.push(`warm host median ${warmMedian.toFixed(1)}ms > ${budgets.warmHostMedianMs}ms`)
  }
  if (rendererMedian > budgets.rendererMedianMs) {
    failures.push(
      `renderer median ${rendererMedian.toFixed(1)}ms > ${budgets.rendererMedianMs}ms`,
    )
  }
  if (failures.length > 0) {
    console.error(`[startup:${mode}] budget failures:\n- ${failures.join("\n- ")}`)
    process.exitCode = 1
  } else {
    console.log(`[startup:${mode}] budgets ok (cold<=${budgets.coldHostMs} warm<=${budgets.warmHostMedianMs})`)
  }
}
