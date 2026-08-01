import { expect, test } from "@playwright/test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expectLocatorContainsText, expectLocatorVisible } from "../shell/assert.js"
import { ensureCardsLayout, hasPtySpawn, launchJet } from "./_launch.js"

const ptyAvailable = hasPtySpawn()
const CLI_ID = "11111111-1111-4111-8111-111111111111"

test.describe("active agent background resume", () => {
  test.skip(!ptyAvailable, "node-pty cannot spawn a shell on this machine")

  test("warms active CLI sessions, excludes archived, and reuses the PTY on open", async () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "gharargah-warm-resume-e2e-"),
    )
    const binDir = path.join(temporaryRoot, "bin")
    const launchLog = path.join(temporaryRoot, "launches.log")
    fs.mkdirSync(binDir)
    const mockCodex = path.join(binDir, "codex")
    fs.writeFileSync(
      mockCodex,
      [
        "#!/bin/sh",
        'printf "%s\\n" "$*" >> "$GHARARGAH_WARM_RESUME_LOG"',
        'printf "WARM_RESUME_READY\\r\\n"',
        "trap 'exit 0' TERM INT",
        "while :; do sleep 1; done",
      ].join("\n"),
      { mode: 0o755 },
    )

    const { app, page } = await launchJet({
      userDataDir: path.join(temporaryRoot, "user-data"),
      env: {
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        GHARARGAH_WARM_RESUME_LOG: launchLog,
      },
    })
    try {
      await ensureCardsLayout(page)
      const workspace = await page.evaluate(() => {
        const item = window.__gharargahAgent!.getState().workspaces[0]
        if (!item?.path) throw new Error("workspace unavailable")
        return {
          name: item.name,
          uri: item.path.startsWith("/") ? `file://${item.path}` : `file:///${item.path}`,
        }
      })

      await page.evaluate(
        async ({ rootUri, cliSessionId }) => {
          const entries = [
            { tabId: "gharargah:terminal:warm-one", label: "Warm one" },
            { tabId: "gharargah:terminal:warm-two", label: "Warm two" },
            {
              tabId: "gharargah:terminal:archived-cold",
              label: "Archived cold",
              doneAt: "2026-08-01T00:00:00.000Z",
            },
          ].map(entry => ({
            ...entry,
            cwdRootUri: rootUri,
            status: entry.doneAt ? "exited" : "running",
            launchCommand: "codex",
            launchArgs: ["resume", cliSessionId],
            agentId: "codex",
            agentDriverId: "codex:cli",
            agentCliSessionId: cliSessionId,
          }))
          const response = await fetch("/api/v1/sessions", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ version: 2, sessions: entries, modal: null }),
          })
          if (!response.ok) throw new Error(`seed failed: ${response.status}`)
        },
        { rootUri: workspace.uri, cliSessionId: CLI_ID },
      )

      await page.reload({ waitUntil: "domcontentloaded" })
      await page.waitForFunction(() => window.__gharargahAgent != null, null, {
        timeout: 30_000,
      })
      await page.evaluate(() => window.__gharargahAgent!.waitForReady())
      await ensureCardsLayout(page)

      const summary = await expect
        .poll(
          () =>
            page.evaluate(() => {
              const entry = performance
                .getEntriesByName("gharargah:active-agent-warm-resume")
                .at(-1)
              if (!entry) return null
              const detail = Reflect.get(entry, "detail")
              if (!detail || typeof detail !== "object") return null
              return {
                durationMs: entry.duration,
                eligible: Reflect.get(detail, "eligible"),
                resumed: Reflect.get(detail, "resumed"),
                failed: Reflect.get(detail, "failed"),
                maxInFlight: Reflect.get(detail, "maxInFlight"),
              }
            }),
          { timeout: 20_000 },
        )
        .toMatchObject({
          eligible: 2,
          resumed: 2,
          failed: 0,
          maxInFlight: 2,
        })
      void summary

      await expect
        .poll(
          () =>
            fs.existsSync(launchLog)
              ? fs.readFileSync(launchLog, "utf8").trim().split("\n").filter(Boolean)
                  .length
              : 0,
          { timeout: 10_000 },
        )
        .toBe(2)
      const launchesBeforeOpen = fs.readFileSync(launchLog, "utf8")
      expect(launchesBeforeOpen).toContain(`resume ${CLI_ID}`)

      const project = page.locator(
        `[data-gharargah-project-section][data-gharargah-project-name="${workspace.name}"]`,
      )
      await expectLocatorVisible(project)
      const warmCard = project
        .locator("[data-gharargah-terminal-card]:not([data-gharargah-new-session])")
        .filter({ hasText: "Warm one" })
      await expectLocatorVisible(warmCard)

      const openedAt = Date.now()
      await warmCard.click()
      const terminal = page.locator(
        '[data-gharargah-terminal-panel][data-gharargah-terminal-status="running"]',
      )
      await expectLocatorVisible(terminal, { timeout: 5_000 })
      await expectLocatorContainsText(terminal.locator(".xterm-rows"), "WARM_RESUME_READY")
      const replayReadyMs = Date.now() - openedAt
      expect(replayReadyMs).toBeLessThan(2_000)

      // Opening attaches/replays the warmed PTY; it must not spawn a third CLI.
      await expect
        .poll(() => fs.readFileSync(launchLog, "utf8"), { timeout: 2_000 })
        .toBe(launchesBeforeOpen)
    } finally {
      await app.close()
      fs.rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })

  test("opening during warm resume does not stick on Resuming overlay", async () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "gharargah-warm-open-e2e-"),
    )
    const binDir = path.join(temporaryRoot, "bin")
    const launchLog = path.join(temporaryRoot, "launches.log")
    const gate = path.join(temporaryRoot, "gate")
    fs.mkdirSync(binDir)
    // Block the CLI body so warm work stays in-flight while create still returns.
    // The stall we care about is UI deferral, not PTY spawn latency.
    fs.writeFileSync(
      path.join(binDir, "codex"),
      [
        "#!/bin/sh",
        'printf "%s\\n" "$*" >> "$GHARARGAH_WARM_RESUME_LOG"',
        'printf "WARM_RESUME_READY\\r\\n"',
        "trap 'exit 0' TERM INT",
        'while [ ! -f "$GHARARGAH_WARM_RESUME_GATE" ]; do sleep 0.05; done',
        "while :; do sleep 1; done",
      ].join("\n"),
      { mode: 0o755 },
    )

    const { app, page } = await launchJet({
      userDataDir: path.join(temporaryRoot, "user-data"),
      env: {
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        GHARARGAH_WARM_RESUME_LOG: launchLog,
        GHARARGAH_WARM_RESUME_GATE: gate,
      },
    })
    try {
      await ensureCardsLayout(page)
      const workspace = await page.evaluate(() => {
        const item = window.__gharargahAgent!.getState().workspaces[0]
        if (!item?.path) throw new Error("workspace unavailable")
        return {
          name: item.name,
          uri: item.path.startsWith("/") ? `file://${item.path}` : `file:///${item.path}`,
        }
      })

      await page.evaluate(
        async ({ rootUri, cliSessionId }) => {
          const entries = [1, 2, 3, 4].map(n => ({
            tabId: `gharargah:terminal:warm-open-${n}`,
            label: `Warm open ${n}`,
            cwdRootUri: rootUri,
            status: "running",
            launchCommand: "codex",
            launchArgs: ["resume", cliSessionId],
            agentId: "codex",
            agentDriverId: "codex:cli",
            agentCliSessionId: cliSessionId,
          }))
          const response = await fetch("/api/v1/sessions", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ version: 2, sessions: entries, modal: null }),
          })
          if (!response.ok) throw new Error(`seed failed: ${response.status}`)
        },
        { rootUri: workspace.uri, cliSessionId: CLI_ID },
      )

      await page.reload({ waitUntil: "domcontentloaded" })
      await page.waitForFunction(() => window.__gharargahAgent != null, null, {
        timeout: 30_000,
      })
      await page.evaluate(() => window.__gharargahAgent!.waitForReady())
      await ensureCardsLayout(page)

      const project = page.locator(
        `[data-gharargah-project-section][data-gharargah-project-name="${workspace.name}"]`,
      )
      await expectLocatorVisible(project)
      const lateCard = project
        .locator("[data-gharargah-terminal-card]:not([data-gharargah-new-session])")
        .filter({ hasText: "Warm open 4" })
      await expectLocatorVisible(lateCard)
      await lateCard.click()

      const terminal = page.locator("[data-gharargah-terminal-panel]")
      await expectLocatorVisible(terminal, { timeout: 5_000 })
      // Must not remain stuck on warm-resume deferral after open.
      await expect
        .poll(
          async () =>
            terminal.getAttribute("data-gharargah-terminal-defer-pty"),
          { timeout: 3_000 },
        )
        .toBeNull()
      await expect
        .poll(async () => terminal.getAttribute("data-gharargah-terminal-status"), {
          timeout: 8_000,
        })
        .toBe("running")
      await expect
        .poll(
          () =>
            page.locator("[data-gharargah-terminal-starting]").count(),
          { timeout: 3_000 },
        )
        .toBe(0)
    } finally {
      fs.writeFileSync(gate, "1")
      await app.close()
      fs.rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })
})

