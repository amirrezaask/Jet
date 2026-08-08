import type {
  ServerCapabilities,
  TextDocumentSaveReason,
  TextEdit,
} from "vscode-languageserver-protocol"

export type LspSaveSyncOptions = {
  willSave: boolean
  willSaveWaitUntil: boolean
  didSave: boolean
  includeText: boolean
}

export type LspSaveParticipant = {
  sync: LspSaveSyncOptions
  notify(method: string, params: unknown): Promise<void>
  request<R>(method: string, params: unknown, timeoutMs?: number): Promise<R>
}

export function staticSaveSyncOptions(
  capabilities: ServerCapabilities,
): LspSaveSyncOptions {
  const synchronization = capabilities.textDocumentSync
  if (!synchronization || typeof synchronization === "number") {
    return { willSave: false, willSaveWaitUntil: false, didSave: false, includeText: false }
  }
  const save = synchronization.save
  return {
    willSave: synchronization.willSave === true,
    willSaveWaitUntil: synchronization.willSaveWaitUntil === true,
    didSave: save === true || (typeof save === "object" && save != null),
    includeText: typeof save === "object" && save != null && save.includeText === true,
  }
}

/**
 * Runs the LSP save handshake around exactly one durable write. didSave is
 * intentionally withheld when either willSaveWaitUntil or persistence fails.
 */
export async function runLspSaveSequence(options: {
  uri: string
  reason: TextDocumentSaveReason
  participants: readonly LspSaveParticipant[]
  applyEdits(edits: readonly TextEdit[]): void | Promise<void>
  getContent(): string
  persist(content: string): Promise<void>
  willSaveWaitUntilTimeoutMs?: number
}): Promise<string> {
  const textDocument = { uri: options.uri }
  for (const participant of options.participants) {
    if (!participant.sync.willSave) continue
    await participant.notify("textDocument/willSave", {
      textDocument,
      reason: options.reason,
    }).catch(() => {})
  }

  for (const participant of options.participants) {
    if (!participant.sync.willSaveWaitUntil) continue
    const timeoutMs = options.willSaveWaitUntilTimeoutMs ?? 1_500
    const request = participant.request<TextEdit[] | null>(
      "textDocument/willSaveWaitUntil",
      { textDocument, reason: options.reason },
      timeoutMs,
    ).catch(() => null)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), timeoutMs)
    })
    const edits = await Promise.race([request, timeout])
    if (timer) clearTimeout(timer)
    if (edits?.length) await Promise.resolve(options.applyEdits(edits)).catch(() => {})
  }

  const content = options.getContent()
  await options.persist(content)

  for (const participant of options.participants) {
    if (!participant.sync.didSave) continue
    await participant.notify("textDocument/didSave", {
      textDocument,
      ...(participant.sync.includeText ? { text: content } : {}),
    }).catch(() => {})
  }
  return content
}
