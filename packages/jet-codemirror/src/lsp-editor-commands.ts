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
import { hoverContentsToPlain, type HoverContents } from "./hover-signature.js"

type HoverParams = {
  position: { line: number; character: number }
  textDocument: { uri: string }
}

type HoverResult = {
  contents: HoverContents
} | null
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

export async function fetchHoverPlaintext(view: EditorView, pos: number): Promise<string | null> {
  const plugin = lspPluginForView(view)
  if (!plugin) return null
  plugin.client.sync()
  const result = await plugin.client.request<HoverParams, HoverResult>("textDocument/hover", {
    position: plugin.toPosition(pos),
    textDocument: { uri: plugin.uri },
  })
  if (!result?.contents) return null
  const text = hoverContentsToPlain(result.contents).trim()
  return text.length > 0 ? text : null
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

type LspRange = { start: { line: number; character: number }; end: { line: number; character: number } }
type LspLocation = { uri: string; range: LspRange }

type LspTextEdit = {
  range: LspRange
  newText: string
}

type LspDocumentEdit = {
  textDocument: { uri: string; version?: number | null }
  edits: LspTextEdit[]
}

type LspWorkspaceEdit = {
  changes?: Record<string, LspTextEdit[]>
  documentChanges?: (LspTextEdit | LspDocumentEdit)[]
}

type LspCommand = {
  title: string
  command: string
  arguments?: unknown[]
}

type LspDiagnostic = {
  range: LspRange
  message: string
  severity?: number
  code?: string | number
  source?: string
}

export type CodeAction = {
  title: string
  kind?: string
  diagnostics?: LspDiagnostic[]
  isPreferred?: boolean
  disabled?: { reason: string }
  edit?: LspWorkspaceEdit
  command?: LspCommand
  data?: unknown
}

type CodeActionParams = {
  textDocument: { uri: string }
  range: LspRange
  context: { diagnostics: LspDiagnostic[]; only?: string[] }
}

export async function fetchCodeActions(
  view: EditorView,
  from?: number,
  to?: number,
): Promise<CodeAction[]> {
  const plugin = lspPluginForView(view)
  if (!plugin) return []
  plugin.client.sync()
  const sel = view.state.selection.main
  const start = from ?? sel.from
  const end = to ?? sel.to
  const range: LspRange = {
    start: plugin.toPosition(start),
    end: plugin.toPosition(end),
  }
  const result = await plugin.client.request<CodeActionParams, CodeAction[] | null>(
    "textDocument/codeAction",
    {
      textDocument: { uri: plugin.uri },
      range,
      context: { diagnostics: [] },
    },
  )
  return result ?? []
}

export type InlayHint = {
  position: { line: number; character: number }
  label: string | { value: string }[]
  kind?: 1 | 2
  paddingLeft?: boolean
  paddingRight?: boolean
}

type InlayHintParams = {
  textDocument: { uri: string }
  range: LspRange
}

export async function fetchInlayHints(
  view: EditorView,
  from?: number,
  to?: number,
): Promise<InlayHint[]> {
  const plugin = lspPluginForView(view)
  if (!plugin) return []
  plugin.client.sync()
  const doc = view.state.doc
  const startPos = from ?? 0
  const endPos = to ?? doc.length
  const range: LspRange = {
    start: plugin.toPosition(startPos),
    end: plugin.toPosition(endPos),
  }
  const result = await plugin.client.request<InlayHintParams, InlayHint[] | null>(
    "textDocument/inlayHint",
    { textDocument: { uri: plugin.uri }, range },
  )
  return result ?? []
}

export type WorkspaceSymbol = {
  name: string
  containerName?: string
  location: LspLocation
  kind?: number
}

type WorkspaceSymbolParams = { query: string }

export async function fetchWorkspaceSymbols(
  view: EditorView,
  query: string,
): Promise<WorkspaceSymbol[]> {
  const plugin = lspPluginForView(view)
  if (!plugin) return []
  const result = await plugin.client.request<WorkspaceSymbolParams, WorkspaceSymbol[] | null>(
    "workspace/symbol",
    { query },
  )
  return result ?? []
}
