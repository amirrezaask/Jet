import type { EditorView } from "@codemirror/view"
import {
  LSPPlugin,
  formatDocument,
  renameSymbol,
  findReferences,
  showSignatureHelp,
} from "@codemirror/lsp-client"
type LspDocumentSymbol = {
  name: string
  range?: { start: { line: number } }
  children?: LspDocumentSymbol[]
}

export function lspPluginForView(view: EditorView): LSPPlugin | null {
  return LSPPlugin.get(view)
}

export function runFormatDocument(view: EditorView): boolean {
  const plugin = lspPluginForView(view)
  if (!plugin) return false
  return formatDocument(view)
}

export function runRenameSymbol(view: EditorView): boolean {
  const plugin = lspPluginForView(view)
  if (!plugin) return false
  return renameSymbol(view)
}

export function runFindReferences(view: EditorView): boolean {
  const plugin = lspPluginForView(view)
  if (!plugin) return false
  return findReferences(view)
}

export function runParameterHints(view: EditorView): boolean {
  const plugin = lspPluginForView(view)
  if (!plugin) return false
  return showSignatureHelp(view)
}

export type OutlineSymbol = {
  name: string
  line: number
  children: OutlineSymbol[]
}

function flattenDocumentSymbols(
  symbols: LspDocumentSymbol[],
  lineOffset = 0,
): OutlineSymbol[] {
  const out: OutlineSymbol[] = []
  for (const sym of symbols) {
    const line = (sym.range?.start?.line ?? 0) + 1 + lineOffset
    out.push({
      name: sym.name,
      line,
      children: sym.children ? flattenDocumentSymbols(sym.children) : [],
    })
  }
  return out
}

export async function fetchDocumentOutline(view: EditorView): Promise<OutlineSymbol[]> {
  const plugin = lspPluginForView(view)
  if (!plugin) return []
  plugin.client.sync()
  const symbols = await plugin.client.request<DocumentSymbolParams, LspDocumentSymbol[] | null>(
    "textDocument/documentSymbol",
    { textDocument: { uri: plugin.uri } },
  )
  if (!symbols) return []
  return flattenDocumentSymbols(symbols)
}

type DocumentSymbolParams = {
  textDocument: { uri: string }
}
