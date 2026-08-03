const MAX_INPUT_CHUNK = 64 * 1024

export type TerminalInputWriter = {
  enqueue: (data: string) => void
  enqueueBinary: (data: string) => void
  flush: () => Promise<void>
  dispose: () => void
}

/**
 * Coalesce keystrokes onto a microtask, then send without awaiting prior
 * writes. VS Code's PTY host path is fire-and-forget IPC; awaiting HTTP (or a
 * Promise chain) serializes typing lag behind each round-trip.
 */
export function createTerminalInputWriter(
  write: (data: string) => void | Promise<unknown>,
  onError: (error: unknown) => void,
  writeBinary?: (data: string) => void | Promise<unknown>,
): TerminalInputWriter {
  type PendingInput = { kind: "text" | "binary"; data: string }
  let pending: PendingInput[] = []
  let scheduled = false
  let disposed = false

  const send = (
    fn: ((data: string) => void | Promise<unknown>) | undefined,
    chunk: string,
  ): void => {
    if (!fn) return
    try {
      const result = fn(chunk)
      if (result != null && typeof (result as Promise<unknown>).then === "function") {
        void (result as Promise<unknown>).then(undefined, error => {
          onError(error)
        })
      }
    } catch (error) {
      onError(error)
    }
  }

  const flush = (): Promise<void> => {
    scheduled = false
    if (disposed || pending.length === 0) return Promise.resolve()
    const inputs = pending
    pending = []
    for (const input of inputs) {
      const chunkSize =
        input.kind === "text" ? MAX_INPUT_CHUNK : Math.max(1, input.data.length)
      for (let offset = 0; offset < input.data.length; offset += chunkSize) {
        const chunk = input.data.slice(offset, offset + chunkSize)
        if (input.kind === "binary") send(writeBinary, chunk)
        else send(write, chunk)
      }
    }
    return Promise.resolve()
  }

  const schedule = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      void flush()
    })
  }

  return {
    enqueue(data) {
      if (disposed || data.length === 0) return
      const last = pending.at(-1)
      if (last?.kind === "text") last.data += data
      else pending.push({ kind: "text", data })
      schedule()
    },
    enqueueBinary(data) {
      if (disposed || data.length === 0 || !writeBinary) return
      pending.push({ kind: "binary", data })
      schedule()
    },
    flush,
    dispose() {
      disposed = true
      pending = []
    },
  }
}
