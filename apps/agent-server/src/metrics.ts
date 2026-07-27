import fs from "node:fs"

/** Env-gated NDJSON turn metrics: set GHARARGAH_AGENT_METRICS=1 or GHARARGAH_AGENT_METRICS_FILE. */
export function logTurnMetric(event: Record<string, unknown>): void {
  const enabled =
    process.env.GHARARGAH_AGENT_METRICS === "1" || Boolean(process.env.GHARARGAH_AGENT_METRICS_FILE)
  if (!enabled) return
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event })
  const file = process.env.GHARARGAH_AGENT_METRICS_FILE
  if (file) {
    try {
      fs.appendFileSync(file, line + "\n")
      return
    } catch {
      /* fall through */
    }
  }
  console.error(line)
}
