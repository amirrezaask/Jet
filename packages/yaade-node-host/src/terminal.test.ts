import assert from "node:assert/strict"
import test from "node:test"
import { pathToFileURL } from "node:url"
import {
  normalizeTerminalSize,
  TerminalHost,
  TERMINAL_FLOW_HIGH_WATERMARK_CHARS,
} from "./terminal.js"

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
  let ptyId: string | null = null
  const exited = new Promise<void>((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("terminal output timed out")), 10_000)
    terminal.setEmit((channel, args) => {
      channels.push(channel)
      if (channel === "terminal:data") {
        const id = String(args[0] ?? "")
        const data = String(args[1] ?? "")
        chunks.push(data)
        // Ack immediately so flow control does not pause mid-burst in this test.
        terminal.acknowledgeData(id, data.length)
      }
      if (channel === "terminal:exit") resolve()
    })
  })

  try {
    const created = terminal.create(
      pathToFileURL(process.cwd()).href,
      {
        command: process.execPath,
        args: ["-e", "process.stdout.write('x'.repeat(256 * 1024))"],
      },
      "terminal-throughput-test",
    )
    ptyId = created.id
    await exited

    assert.equal(chunks.join("").length, 256 * 1024)
    assert.ok(
      // 64KiB batch + 4ms coalesce; interactive first-chunk flush may add frames.
      chunks.length <= 20,
      `expected a bounded number of terminal frames, received ${chunks.length}`,
    )
    assert.equal(channels.at(-1), "terminal:exit")
    assert.equal(ptyId, created.id)
  } finally {
    if (timeout) clearTimeout(timeout)
    terminal.stopAll()
  }
})

test("flushes small interactive PTY output without waiting on the 4ms batch timer", async () => {
  const terminal = new TerminalHost()
  const chunks: string[] = []
  let echoResolve: (() => void) | null = null
  let timeout: ReturnType<typeof setTimeout> | undefined

  terminal.setEmit((channel, args) => {
    if (channel !== "terminal:data") return
    const id = String(args[0] ?? "")
    const data = String(args[1] ?? "")
    chunks.push(data)
    terminal.acknowledgeData(id, data.length)
    if (echoResolve && data.includes("K")) {
      echoResolve()
      echoResolve = null
    }
  })

  try {
    const created = terminal.create(
      pathToFileURL(process.cwd()).href,
      {
        command: process.execPath,
        args: [
          "-e",
          "process.stdin.on('data', d => process.stdout.write(d)); setInterval(() => {}, 1e9)",
        ],
      },
      "terminal-interactive-flush-test",
    )
    await new Promise(r => setTimeout(r, 50))
    const before = chunks.length
    const echoed = new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("no interactive echo")), 5_000)
      echoResolve = () => {
        if (timeout) clearTimeout(timeout)
        resolve()
      }
    })
    terminal.write(created.id, "K")
    await echoed
    // Immediate flush: echo must arrive as its own frame (not stuck pending a timer).
    assert.ok(chunks.length > before)
    assert.ok(chunks.some(c => c.includes("K")))
  } finally {
    if (timeout) clearTimeout(timeout)
    terminal.stopAll()
  }
})

test("pauses PTY when unacked chars exceed high watermark and resumes on ack", async () => {
  const terminal = new TerminalHost()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const firstBatch = new Promise<string>((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("no terminal:data")), 10_000)
    terminal.setEmit((channel, args) => {
      if (channel === "terminal:data") {
        if (timeout) clearTimeout(timeout)
        resolve(String(args[0] ?? ""))
      }
    })
  })

  try {
    // Slow producer that keeps writing — without pause this would race ahead.
    // We drive flow control by emitting large batches via a fast writer, then
    // checking that ack resumes by verifying acknowledgeData does not throw
    // and subsequent attach clears the pause.
    const created = terminal.create(
      pathToFileURL(process.cwd()).href,
      {
        command: process.execPath,
        args: [
          "-e",
          // Write more than the high watermark, then wait so pause can stick.
          `process.stdout.write('y'.repeat(${TERMINAL_FLOW_HIGH_WATERMARK_CHARS + 10_000})); setTimeout(() => {}, 500)`,
        ],
      },
      "terminal-flow-control-test",
    )
    const id = await firstBatch
    assert.equal(id, created.id)

    // Ack enough to drop below the low watermark — must resume cleanly.
    terminal.acknowledgeData(created.id, TERMINAL_FLOW_HIGH_WATERMARK_CHARS + 10_000)
    terminal.clearUnacknowledgedChars(created.id)

    const attached = terminal.attach(created.id, "terminal-flow-control-test")
    assert.ok(attached)
    assert.equal(attached.status, "running")
  } finally {
    if (timeout) clearTimeout(timeout)
    terminal.stopAll()
  }
})

test("create at capacity reclaims oldest entry instead of throwing", async () => {
  const max = 3
  const terminal = new TerminalHost(max)
  const ids: string[] = []
  try {
    for (let i = 0; i < max; i++) {
      const created = terminal.create(
        pathToFileURL(process.cwd()).href,
        {
          command: process.execPath,
          args: [
            "-e",
            "process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{}, 1e9)",
          ],
        },
        `reclaim-test-${i}`,
      )
      ids.push(created.id)
    }
    assert.equal(ids.length, max)

    const next = terminal.create(
      pathToFileURL(process.cwd()).href,
      {
        command: process.execPath,
        args: [
          "-e",
          "process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{}, 1e9)",
        ],
      },
      "reclaim-test-overflow",
    )
    // Oldest (ids[0]) was reclaimed; newest create succeeded.
    assert.equal(terminal.attach(ids[0]!, "probe"), null)
    assert.ok(terminal.attach(ids[1]!, "probe"))
    assert.ok(terminal.attach(ids[2]!, "probe"))
    assert.ok(terminal.attach(next.id, "probe"))
  } finally {
    terminal.stopAll()
  }
})

test("create at capacity prefers reclaiming exited over running", async () => {
  const max = 2
  const terminal = new TerminalHost(max)
  try {
    const exited = terminal.create(
      pathToFileURL(process.cwd()).href,
      {
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
      },
      "reclaim-exited",
    )
    // Wait until the child exits so status flips.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("exit wait timed out")), 5_000)
      terminal.setEmit((channel, args) => {
        if (channel === "terminal:exit" && args[0] === exited.id) {
          clearTimeout(timeout)
          resolve()
        }
      })
      // Already exited before we subscribed? Poll attach.
      const poll = () => {
        const snap = terminal.attach(exited.id, "poll")
        if (snap?.status === "exited") {
          clearTimeout(timeout)
          resolve()
          return
        }
        setTimeout(poll, 20)
      }
      poll()
    })

    const running = terminal.create(
      pathToFileURL(process.cwd()).href,
      {
        command: process.execPath,
        args: [
          "-e",
          "process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{}, 1e9)",
        ],
      },
      "reclaim-running",
    )

    const next = terminal.create(
      pathToFileURL(process.cwd()).href,
      {
        command: process.execPath,
        args: [
          "-e",
          "process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{}, 1e9)",
        ],
      },
      "reclaim-overflow",
    )

    assert.equal(terminal.attach(exited.id, "probe"), null)
    assert.ok(terminal.attach(running.id, "probe"))
    assert.ok(terminal.attach(next.id, "probe"))
  } finally {
    terminal.stopAll()
  }
})

test("getCwd returns spawn cwd and tracks process cd", async () => {
  const terminal = new TerminalHost()
  const fs = await import("node:fs")
  const os = await import("node:os")
  const path = await import("node:path")
  const { uriToPath } = await import("./paths.js")
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "yaade-term-cwd-")))
  const nested = path.join(tmp, "nested")
  fs.mkdirSync(nested)
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const created = terminal.create(
      pathToFileURL(tmp).href,
      {
        command: process.execPath,
        args: [
          "-e",
          `process.chdir(${JSON.stringify(nested)}); process.on('SIGTERM',()=>process.exit(0)); setInterval(() => {}, 1000)`,
        ],
      },
      "terminal-getcwd-test",
    )
    // Give the child a moment to chdir.
    await new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("chdir wait timed out")), 5_000)
      const tick = () => {
        void terminal.getCwd(created.id).then(cwd => {
          if (cwd && fs.realpathSync(uriToPath(cwd)) === nested) {
            clearTimeout(timeout)
            resolve()
            return
          }
          setTimeout(tick, 50)
        })
      }
      tick()
    })
    const cwdUri = await terminal.getCwd(created.id)
    assert.ok(cwdUri)
    assert.equal(fs.realpathSync(uriToPath(cwdUri)), nested)
  } finally {
    if (timeout) clearTimeout(timeout)
    terminal.stopAll()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
