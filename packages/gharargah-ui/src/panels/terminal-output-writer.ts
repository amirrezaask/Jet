/**
 * Coalesce PTY → xterm writes onto one animation frame.
 *
 * Cursor Agent (and other TUIs) flood DECCTCEM + paint. Writing every WS chunk
 * synchronously + full DomRenderer refresh steals the main thread from typing.
 */

export type TerminalOutputWriter = {
  enqueue: (data: string) => void
  /** Drain pending bytes immediately (attach replay / dispose). */
  flush: () => void
  dispose: () => void
}

export type TerminalOutputWriterOptions = {
  write: (data: string, onPainted?: () => void) => void
  /** Called after a coalesced write paints (once per flush). */
  onPainted?: () => void
  /**
   * When true, after paint run a single viewport refresh. Callers should only
   * request this for cursor-visibility toggles, and at most once per frame.
   */
  refreshAfterPaint?: () => void
  schedule?: (cb: () => void) => number
  cancel?: (id: number) => void
}

export function createTerminalOutputWriter(
  options: TerminalOutputWriterOptions,
): TerminalOutputWriter {
  const schedule =
    options.schedule ??
    (typeof requestAnimationFrame === "function"
      ? (cb: () => void) => requestAnimationFrame(cb)
      : (cb: () => void) => setTimeout(cb, 0) as unknown as number)
  const cancel =
    options.cancel ??
    (typeof cancelAnimationFrame === "function"
      ? (id: number) => cancelAnimationFrame(id)
      : (id: number) => clearTimeout(id))

  let pending = ""
  let needsRefresh = false
  let raf = 0
  let disposed = false
  let writing = false

  const flushNow = () => {
    raf = 0
    if (disposed || (pending.length === 0 && !needsRefresh)) return
    const data = pending
    pending = ""
    const doRefresh = needsRefresh
    needsRefresh = false
    if (data.length === 0) {
      if (doRefresh) options.refreshAfterPaint?.()
      options.onPainted?.()
      return
    }
    writing = true
    options.write(data, () => {
      writing = false
      if (disposed) return
      if (doRefresh) options.refreshAfterPaint?.()
      options.onPainted?.()
      // Bytes arrived during write callback — schedule another frame.
      if (pending.length > 0 || needsRefresh) scheduleFlush()
    })
  }

  const scheduleFlush = () => {
    if (disposed || raf || writing) return
    raf = schedule(flushNow)
  }

  return {
    enqueue(data) {
      if (disposed || data.length === 0) return
      pending += data
      if (
        data.includes("\x1b[?25l") ||
        data.includes("\x1b[?25h")
      ) {
        needsRefresh = true
      }
      scheduleFlush()
    },
    flush() {
      if (raf) {
        cancel(raf)
        raf = 0
      }
      flushNow()
    },
    dispose() {
      disposed = true
      if (raf) {
        cancel(raf)
        raf = 0
      }
      pending = ""
      needsRefresh = false
    },
  }
}
