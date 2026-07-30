import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { notificationLaunchForProvider } from "./notification-provider-launch.js"

describe("notificationLaunchForProvider", () => {
  const context = {
    sessionId: "session with spaces",
    origin: "http://127.0.0.1:4747",
  }

  it("adds session-scoped Claude HTTP hooks without touching global settings", () => {
    const launch = notificationLaunchForProvider("claude", "claude", context)
    assert.equal(launch.driver, "hook")
    assert.deepEqual(launch.args.slice(0, 1), ["--settings"])
    const settings = JSON.parse(launch.args[1]!) as {
      hooks: Record<string, Array<{ hooks: Array<{ url: string }> }>>
    }
    assert.match(
      settings.hooks.Stop![0]!.hooks[0]!.url,
      /provider=claude&sessionId=session\+with\+spaces/,
    )
    assert.ok(settings.hooks.Notification)
    assert.ok(settings.hooks.StopFailure)
  })

  it("adds a Codex notify command that forwards the appended JSON argument", () => {
    const launch = notificationLaunchForProvider("codex", "codex", context)
    assert.equal(launch.driver, "hook")
    assert.deepEqual(launch.args.slice(0, 1), ["-c"])
    assert.match(launch.args[1]!, /^notify=/)
    assert.match(launch.args[1]!, /--data-binary/)
    assert.match(launch.args[1]!, /provider=codex/)
  })

  it("keeps OSC fallback for providers without session-scoped hooks", () => {
    for (const provider of ["opencode", "grok"] as const) {
      const launch = notificationLaunchForProvider(provider, provider, context)
      assert.equal(launch.driver, "osc")
      assert.deepEqual(launch.args, [])
    }
  })

  it("auto-trusts the workspace for Cursor Agent CLI", () => {
    const launch = notificationLaunchForProvider("cursor", "cursor-agent", context)
    assert.equal(launch.driver, "osc")
    assert.deepEqual(launch.args, ["--trust"])
  })
})
