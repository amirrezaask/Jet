import type { MonacoEditorHandle } from "@gharargah/monaco"
import { applyWorkspaceEdit, monacoModels, monacoRangeToLspRange } from "@gharargah/monaco"
import { canonicalizeFileUri } from "@gharargah/shared"
import type { MonacoLspClient } from "./client-pool.js"
import type { JetLspWorkspaceDeps } from "./gharargah-workspace.js"
import { bumpDocumentVersion, getDocumentVersion } from "./gharargah-workspace.js"

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

function rangeKey(
  uri: string,
  range: { start: { line: number; character: number }; end: { line: number; character: number } },
): string {
  return `${uri}:${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`
}

export async function scheduleCodeActions(
  client: MonacoLspClient,
  uri: string,
  editor: MonacoEditorHandle,
  onlyQuickFix = true,
): Promise<LspCodeAction[]> {
  const model = editor.getModel()
  const selection = editor.getSelection()
  if (!model || !selection) return []

  const canonical = canonicalizeFileUri(uri)
  const content = model.getValue()
  const range = monacoRangeToLspRange(content, selection)
  const key = rangeKey(canonical, range)
  const existing = inFlight.get(key)
  if (existing) return existing

  const promise = (async () => {
    const params: CodeActionParams = {
      textDocument: { uri: canonical },
      range,
      context: { only: onlyQuickFix ? ["quickfix"] : undefined },
    }
    const result = await client.sendRequest<CodeActionResult>("textDocument/codeAction", params)
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

export async function applyCodeAction(
  client: MonacoLspClient,
  uri: string,
  editor: MonacoEditorHandle,
  action: LspCodeAction,
  deps: JetLspWorkspaceDeps,
): Promise<boolean> {
  if (action.command) {
    await client.sendRequest("workspace/executeCommand", {
      command: action.command.command,
      arguments: action.command.arguments ?? [],
    })
    return true
  }

  const edit = action.edit as
    | { changes?: Record<string, { range: unknown; newText: string }[]> }
    | undefined
  if (!edit?.changes) return false

  const canonical = canonicalizeFileUri(uri)
  const uriChanges = edit.changes[canonical] ?? edit.changes[uri]
  if (!uriChanges?.length) return false

  const result = applyWorkspaceEdit(
    {
      changes: {
        [canonical]: uriChanges.map(change => ({
          range: change.range as {
            start: { line: number; character: number }
            end: { line: number; character: number }
          },
          newText: change.newText,
        })),
      },
    },
    {
      registry: monacoModels,
      isDirty: deps.isDirty,
      getContent: deps.getContent,
      getVersion: getDocumentVersion,
      defaultLanguageId: "plaintext",
    },
  )

  if (!result.applied.includes(canonical)) return false

  const content = deps.getContent(canonical) ?? monacoModels.getContent(canonical)
  if (content != null) {
    deps.updateContent(canonical, content)
    bumpDocumentVersion(canonical)
    editor.setValue(content)
    if (!deps.isDirty(canonical)) {
      await deps.writeFile(canonical, content)
    }
  }
  return true
}
