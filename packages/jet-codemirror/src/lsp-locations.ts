import type { EditorState, Text } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { LSPPlugin } from "@codemirror/lsp-client"

export type LspPosition = { line: number; character: number }
export type LspRange = { start: LspPosition; end: LspPosition }
export type LspLocation = { uri: string; range: LspRange }

/** Identifier-ish: letters, marks, digits, `_`, `$`. */
function isIdentChar(ch: string): boolean {
  if (!ch) return false
  if (ch === "_" || ch === "$") return true
  return /[\p{L}\p{M}\p{Nd}]/u.test(ch)
}

/**
 * Resolve the symbol under `pos` for LSP requests.
 * Handles cursor-after-token (common after click/arrow) and CM `wordAt` misses
 * on some language tokens (Go package-level names, etc.).
 */
export function symbolRangeAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const doc = state.doc
  const clamped = Math.max(0, Math.min(pos, doc.length))

  for (const candidate of [clamped, clamped > 0 ? clamped - 1 : clamped]) {
    const word = state.wordAt(candidate)
    if (word && word.from < word.to) return { from: word.from, to: word.to }
  }

  return scanIdentRange(doc, clamped)
}

function scanIdentRange(doc: Text, pos: number): { from: number; to: number } | null {
  if (doc.length === 0) return null
  let at = Math.max(0, Math.min(pos, doc.length))
  if (at === doc.length || !isIdentChar(doc.sliceString(at, at + 1))) {
    if (at === 0 || !isIdentChar(doc.sliceString(at - 1, at))) return null
    at -= 1
  }
  let from = at
  let to = at + 1
  while (from > 0 && isIdentChar(doc.sliceString(from - 1, from))) from -= 1
  while (to < doc.length && isIdentChar(doc.sliceString(to, to + 1))) to += 1
  return from < to ? { from, to } : null
}

/** Prefer an interior offset so servers that reject token-edge positions still resolve. */
export function lspOffsetForSymbol(state: EditorState, pos: number): number {
  const range = symbolRangeAt(state, pos)
  if (!range) return Math.max(0, Math.min(pos, state.doc.length))
  if (pos >= range.from && pos < range.to) return pos
  if (range.to - range.from === 1) return range.from
  return Math.min(range.to - 1, Math.max(range.from, pos))
}

export function symbolTextAt(state: EditorState, pos: number): string | null {
  const range = symbolRangeAt(state, pos)
  if (!range) return null
  const text = state.doc.sliceString(range.from, range.to).trim()
  return text.length > 0 ? text : null
}

/** Normalize Location | LocationLink | arrays into plain `{ uri, range }`. */
export function normalizeLspLocations(result: unknown): LspLocation[] {
  if (result == null) return []
  const items = Array.isArray(result) ? result : [result]
  const out: LspLocation[] = []
  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const loc = item as Record<string, unknown>
    if (typeof loc.uri === "string" && isLspRange(loc.range)) {
      out.push({ uri: loc.uri, range: loc.range })
      continue
    }
    if (typeof loc.targetUri === "string") {
      const range = isLspRange(loc.targetSelectionRange)
        ? loc.targetSelectionRange
        : isLspRange(loc.targetRange)
          ? loc.targetRange
          : null
      if (range) out.push({ uri: loc.targetUri, range })
    }
  }
  return out
}

function isLspRange(value: unknown): value is LspRange {
  if (!value || typeof value !== "object") return false
  const range = value as { start?: unknown; end?: unknown }
  return isLspPosition(range.start) && isLspPosition(range.end)
}

function isLspPosition(value: unknown): value is LspPosition {
  if (!value || typeof value !== "object") return false
  const pos = value as { line?: unknown; character?: unknown }
  return typeof pos.line === "number" && typeof pos.character === "number"
}

export async function fetchLspReferences(view: EditorView): Promise<LspLocation[]> {
  const plugin = LSPPlugin.get(view)
  if (!plugin) return []
  const client = plugin.client as { hasCapability?: (name: string) => boolean | undefined; sync: () => void; request: (method: string, params: unknown) => Promise<unknown> }
  if (client.hasCapability?.("referencesProvider") === false) return []
  client.sync()
  const pos = lspOffsetForSymbol(view.state, view.state.selection.main.head)
  const result = await client.request(
    "textDocument/references",
    {
      textDocument: { uri: plugin.uri },
      position: plugin.toPosition(pos),
      context: { includeDeclaration: true },
    },
  )
  return normalizeLspLocations(result)
}

export async function fetchLspDefinitions(view: EditorView): Promise<LspLocation[]> {
  const plugin = LSPPlugin.get(view)
  if (!plugin) return []
  const client = plugin.client as { hasCapability?: (name: string) => boolean | undefined; sync: () => void; request: (method: string, params: unknown) => Promise<unknown> }
  if (client.hasCapability?.("definitionProvider") === false) return []
  client.sync()
  const pos = lspOffsetForSymbol(view.state, view.state.selection.main.head)
  const result = await client.request(
    "textDocument/definition",
    {
      textDocument: { uri: plugin.uri },
      position: plugin.toPosition(pos),
    },
  )
  return normalizeLspLocations(result)
}
