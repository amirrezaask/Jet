const MAX_INPUT_CHUNK = 64 * 1024

export type TerminalInputWriter = {
  enqueue: (data: string) => void
  enqueueBinary: (data: string) => void
  flush: () => Promise<void>
  dispose: () => void
}

export function createTerminalInputWriter(
  write: (data: string) => Promise<unknown>,
  onError: (error: unknown) => void,
  writeBinary?: (data: string) => Promise<unknown>,
): TerminalInputWriter {
  type PendingInput = { kind: "text" | "binary"; data: string }
  let pending: PendingInput[] = []
  let scheduled = false
  let disposed = false
  let chain = Promise.resolve()

  const flush = (): Promise<void> => {
    scheduled = false
    if (disposed || pending.length === 0) return chain
    const inputs = pending
    pending = []
    for (const input of inputs) {
      const chunkSize =
        input.kind === "text" ? MAX_INPUT_CHUNK : Math.max(1, input.data.length)
      for (let offset = 0; offset < input.data.length; offset += chunkSize) {
        const chunk = input.data.slice(offset, offset + chunkSize)
        const send = input.kind === "binary" ? writeBinary : write
        if (!send) continue
        chain = chain.then(() => send(chunk)).then(
          () => undefined,
          error => {
            onError(error)
          },
        )
      }
    }
    return chain
  }

  const schedule = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => void flush())
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
