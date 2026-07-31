/** Print a compact pass/fail summary from a Playwright JSON report. */
import { readFileSync } from "node:fs"

const file = process.argv[2]
if (!file) {
  console.error("usage: node summarize-report.mjs <playwright-report.json>")
  process.exit(2)
}

const report = JSON.parse(readFileSync(file, "utf8"))
const failures = []

function walk(suite) {
  for (const child of suite.suites ?? []) walk(child)
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const label =
        test.status === "expected"
          ? "PASS"
          : test.status === "skipped"
            ? "SKIP"
            : test.status === "flaky"
              ? "FLAKY"
              : "FAIL"
      console.log(`${label}  ${spec.title}`)
      if (label === "PASS" || label === "SKIP") continue
      const errors = (test.results ?? []).flatMap(result =>
        (result.errors ?? []).map(error =>
          (error.message ?? "").replace(/\u001b\[[0-9;]*m/g, ""),
        ),
      )
      failures.push({ file: `${spec.file}:${spec.line}`, title: spec.title, errors })
    }
  }
}

for (const suite of report.suites ?? []) walk(suite)

for (const failure of failures) {
  console.log(`\n######## ${failure.file} :: ${failure.title}`)
  for (const error of failure.errors) {
    console.log(error.split("\n").slice(0, 18).join("\n"))
  }
}

console.log("\nSTATS", JSON.stringify(report.stats))
