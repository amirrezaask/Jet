import { TextDocumentSyncKind } from "vscode-languageserver-protocol"

export type MonacoContentChange = {
  range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
  rangeLength: number
  text: string
}

export type LspContentChange =
  | { text: string }
  | {
      range: {
        start: { line: number; character: number }
        end: { line: number; character: number }
      }
      rangeLength: number
      text: string
    }

export type FullDocumentSyncScheduler = {
  schedule(): void
  flush(): Promise<void>
  dispose(): void
}

/**
 * Coalesces full-sync servers off the keystroke path. The model is serialized
 * only after idle (or explicitly before save), never once per content event.
 */
export function createFullDocumentSyncScheduler(options: {
  getVersion(): number
  getText(): string
  send(version: number, text: string): Promise<void>
  onSent?(version: number): void
  onError?(error: unknown): void
  delayMs?: number
  setTimer?: (callback: () => void, delayMs: number) => unknown
  clearTimer?: (timer: unknown) => void
}): FullDocumentSyncScheduler {
  const setTimer =
    options.setTimer ??
    ((callback, delayMs) => setTimeout(callback, delayMs))
  const clearTimer =
    options.clearTimer ??
    (timer => clearTimeout(timer as ReturnType<typeof setTimeout>))
  let timer: unknown = null
  let requested = false
  let disposed = false
  let tail = Promise.resolve()

  const flush = async (): Promise<void> => {
    if (disposed) return
    if (timer != null) {
      clearTimer(timer)
      timer = null
    }
    await tail.catch(() => undefined)
    if (disposed || !requested) return
    requested = false
    const version = options.getVersion()
    const text = options.getText()
    const sending = options.send(version, text)
    tail = sending.catch(() => undefined)
    await sending
    options.onSent?.(version)
  }

  return {
    schedule() {
      if (disposed) return
      requested = true
      if (timer != null) clearTimer(timer)
      timer = setTimer(() => {
        timer = null
        void flush().catch(error => options.onError?.(error))
      }, options.delayMs ?? 75)
    },
    flush,
    dispose() {
      disposed = true
      requested = false
      if (timer != null) clearTimer(timer)
      timer = null
    },
  }
}

/** Convert Monaco changes without serializing the document for incremental sync. */
export function lspContentChanges(
  syncKind: TextDocumentSyncKind,
  changes: readonly MonacoContentChange[],
  fullText: () => string,
): LspContentChange[] {
  if (syncKind === TextDocumentSyncKind.None) return []
  if (syncKind === TextDocumentSyncKind.Full) return [{ text: fullText() }]
  return changes.map(change => ({
    range: {
      start: {
        line: change.range.startLineNumber - 1,
        character: change.range.startColumn - 1,
      },
      end: {
        line: change.range.endLineNumber - 1,
        character: change.range.endColumn - 1,
      },
    },
    rangeLength: change.rangeLength,
    text: change.text,
  }))
}
