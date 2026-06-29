import type { EditorView } from "@codemirror/view"
import { LSPPlugin } from "@codemirror/lsp-client"

export type LspCodeAction = {
  title: string
  kind?: string
  edit?: unknown
  command?: { command: string; arguments?: unknown[] }
  diagnostics?: unknown[]
}

type CodeActionParams = {
  textDocument: { uri: string }
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  context: { diagnostics?: unknown[]; only?: string[] }
}

type CodeActionResult = LspCodeAction[] | { items: LspCodeAction[] } | null

const inFlight = new Map<string, Promise<LspCodeAction[]>>()

function rangeKey(uri: string, from: number, to: number): string {
  return `${uri}:${from}:${to}`
}

export async function scheduleCodeActions(
  view: EditorView,
  onlyQuickFix = true,
): Promise<LspCodeAction[]> {
  const plugin = LSPPlugin.get(view)
  if (!plugin) return []

  const from = view.state.selection.main.from
  const to = view.state.selection.main.to
  const key = rangeKey(plugin.uri, from, to)
  const existing = inFlight.get(key)
  if (existing) return existing

  const promise = (async () => {
    plugin.client.sync()
    const start = plugin.toPosition(from)
    const end = plugin.toPosition(to)
    const params: CodeActionParams = {
      textDocument: { uri: plugin.uri },
      range: { start, end },
      context: { only: onlyQuickFix ? ["quickfix"] : undefined },
    }
    const result = await plugin.client.request<CodeActionParams, CodeActionResult>(
      "textDocument/codeAction",
      params,
    )
    if (!result) return []
    if (Array.isArray(result)) return result
    return result.items ?? []
  })()
    .catch(() => [] as LspCodeAction[])
    .finally(() => {
      inFlight.delete(key)
    })

  inFlight.set(key, promise)
  return promise
}

export async function applyCodeAction(view: EditorView, action: LspCodeAction): Promise<boolean> {
  const plugin = LSPPlugin.get(view)
  if (!plugin) return false

  if (action.command) {
    await plugin.client.request("workspace/executeCommand", {
      command: action.command.command,
      arguments: action.command.arguments ?? [],
    })
    return true
  }

  const edit = action.edit as
    | { changes?: Record<string, { range: unknown; newText: string }[]> }
    | undefined
  if (!edit?.changes) return false

  const uriChanges = edit.changes[plugin.uri]
  if (!uriChanges?.length) return false

  const changes = uriChanges.map(c => {
    const range = c.range as {
      start: { line: number; character: number }
      end: { line: number; character: number }
    }
    return {
      from: plugin.fromPosition(range.start),
      to: plugin.fromPosition(range.end),
      insert: c.newText,
    }
  })

  view.dispatch({ changes })
  return true
}
