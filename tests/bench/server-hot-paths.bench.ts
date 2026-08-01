import { DatabaseSync } from "node:sqlite"
import { performance } from "node:perf_hooks"
import { test } from "@playwright/test"
import { EventHub } from "../../apps/host-server/src/events.js"
import { NotificationService } from "../../apps/host-server/src/notifications/service.js"
import { assertBudget, logBenchResult, runBench } from "./_bench.js"

test("bench server event replay ingestion", async () => {
  const result = await runBench({
    name: "server-event-replay-ingest",
    rounds: 7,
    measure: async () => {
      const events = new EventHub(1_024, 16 * 1024 * 1024)
      const payload = "x".repeat(1_024)
      const startedAt = performance.now()
      for (let index = 0; index < 200_000; index += 1) {
        events.emit("terminal:data", ["pty", payload, index])
      }
      return performance.now() - startedAt
    },
  })
  logBenchResult(result)
  assertBudget(result)
})

test("bench server notification retention", async () => {
  const result = await runBench({
    name: "server-notification-retention-10k",
    rounds: 7,
    measure: async () => {
      const db = new DatabaseSync(":memory:")
      const notifications = new NotificationService(db)
      const insert = db.prepare(
        `INSERT INTO app_notifications(
          id, type, severity, status, title, source,
          created_at, updated_at, metadata_json
        ) VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      db.exec("BEGIN")
      for (let index = 0; index < 10_000; index += 1) {
        insert.run(
          `notification-${index}`,
          "turn-completed",
          "info",
          "dismissed",
          "done",
          "system",
          "2000-01-01T00:00:00.000Z",
          "2000-01-01T00:00:00.000Z",
          "{}",
        )
      }
      db.exec("COMMIT")

      const startedAt = performance.now()
      notifications.runRetention(new Date("2026-01-01T00:00:00.000Z"))
      const elapsed = performance.now() - startedAt
      db.close()
      return elapsed
    },
  })
  logBenchResult(result)
  assertBudget(result)
})
