import type { EditorView } from "@codemirror/view"
import { startCompletion } from "@codemirror/autocomplete"
import {
  LSPPlugin,
  formatDocument,
  renameSymbol,
  findReferences,
  showSignatureHelp,
  jumpToDefinition,
  jumpToDeclaration,
  jumpToTypeDefinition,
  jumpToImplementation,
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

export function runGoToDefinition(view: EditorView): boolean {
  const plugin = lspPluginForView(view)
  if (!plugin) return false
  return jumpToDefinition(view)
}

export function runGoToDeclaration(view: EditorView): boolean {
  const plugin = lspPluginForView(view)
  if (!plugin) return false
  return jumpToDeclaration(view)
}

export function runGoToTypeDefinition(view: EditorView): boolean {
  const plugin = lspPluginForView(view)
  if (!plugin) return false
  return jumpToTypeDefinition(view)
}

export function runGoToImplementation(view: EditorView): boolean {
  const plugin = lspPluginForView(view)
  if (!plugin) return false
  return jumpToImplementation(view)
}

export function runTriggerSuggest(view: EditorView): boolean {
  return startCompletion(view)
}

export function runShowHover(view: EditorView): boolean {
  const plugin = lspPluginForView(view)
  if (!plugin) return false
  const pos = view.state.selection.main.head
  const dom = view.domAtPos(pos)
  const node = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement
  if (!node) return false
  const rect = view.coordsAtPos(pos)
  if (!rect) return false
  node.dispatchEvent(
    new MouseEvent("mousemove", {
      bubbles: true,
      clientX: rect.left + 1,
      clientY: rect.top + 1,
    }),
  )
  return true
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
