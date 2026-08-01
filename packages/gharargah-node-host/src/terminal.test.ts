import assert from "node:assert/strict"
import test from "node:test"
import { pathToFileURL } from "node:url"
import { normalizeTerminalSize, TerminalHost } from "./terminal.js"

test("normalizes valid PTY sizes to finite integer bounds", () => {
  assert.deepEqual(normalizeTerminalSize(undefined, undefined), { cols: 80, rows: 24 })
  assert.deepEqual(normalizeTerminalSize(120.8, 40.2), { cols: 120, rows: 40 })
  assert.deepEqual(normalizeTerminalSize(50_000, 50_000), { cols: 1000, rows: 1000 })
})

test("rejects invalid PTY dimensions", () => {
  assert.equal(normalizeTerminalSize(Number.NaN, 24), null)
  assert.equal(normalizeTerminalSize(80, Number.POSITIVE_INFINITY), null)
  assert.equal(normalizeTerminalSize(0, 24), null)
  assert.equal(normalizeTerminalSize(80, -1), null)
})

test("coalesces PTY output bursts and flushes all bytes before exit", async () => {
  const terminal = new TerminalHost()
  const chunks: string[] = []
  const channels: string[] = []
  let timeout: ReturnType<typeof setTimeout> | undefined
  const exited = new Promise<void>((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("terminal output timed out")), 10_000)
    terminal.setEmit((channel, args) => {
      channels.push(channel)
      if (channel === "terminal:data") chunks.push(String(args[1] ?? ""))
      if (channel === "terminal:exit") resolve()
    })
  })

  try {
    terminal.create(
      pathToFileURL(process.cwd()).href,
      {
        command: process.execPath,
        args: ["-e", "process.stdout.write('x'.repeat(256 * 1024))"],
      },
      "terminal-throughput-test",
    )
    await exited

    assert.equal(chunks.join("").length, 256 * 1024)
    assert.ok(
      chunks.length <= 8,
      `expected a bounded number of terminal frames, received ${chunks.length}`,
    )
    assert.equal(channels.at(-1), "terminal:exit")
  } finally {
    if (timeout) clearTimeout(timeout)
    terminal.stopAll()
  }
})
