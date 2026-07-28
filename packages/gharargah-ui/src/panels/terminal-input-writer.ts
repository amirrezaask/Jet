const MAX_INPUT_CHUNK = 64 * 1024

export type TerminalInputWriter = {
  enqueue: (data: string) => void
  flush: () => Promise<void>
  dispose: () => void
}

export function createTerminalInputWriter(
  write: (data: string) => Promise<unknown>,
  onError: (error: unknown) => void,
): TerminalInputWriter {
  let pending = ""
  let scheduled = false
  let disposed = false
  let chain = Promise.resolve()

  const flush = (): Promise<void> => {
    scheduled = false
    if (disposed || pending.length === 0) return chain
    const data = pending
    pending = ""
    for (let offset = 0; offset < data.length; offset += MAX_INPUT_CHUNK) {
      const chunk = data.slice(offset, offset + MAX_INPUT_CHUNK)
      chain = chain.then(() => write(chunk)).then(
        () => undefined,
        error => {
          onError(error)
        },
      )
    }
    return chain
  }

  return {
    enqueue(data) {
      if (disposed || data.length === 0) return
      pending += data
      if (scheduled) return
      scheduled = true
      queueMicrotask(() => void flush())
    },
    flush,
    dispose() {
      disposed = true
      pending = ""
    },
  }
}
