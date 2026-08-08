import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import {
  CancellationTokenSource,
  createMessageConnection,
  type MessageConnection,
} from "vscode-jsonrpc/browser.js"
import {
  CompletionItemKind,
  DocumentHighlightKind,
  InlayHintKind,
  InsertTextFormat,
  SymbolKind as LspSymbolKind,
  TextDocumentSyncKind,
} from "vscode-languageserver-protocol"
import { lspContentChanges } from "./document-sync.js"
import type {
  CodeAction,
  CodeActionContext,
  CodeLens,
  Command,
  CompletionItem,
  ConfigurationParams,
  Diagnostic,
  DocumentHighlight,
  DocumentSymbol,
  Hover,
  InlayHint,
  Location,
  LocationLink,
  MarkupContent,
  Position,
  PrepareRenameResult,
  PublishDiagnosticsParams,
  Range,
  SemanticTokens,
  SignatureHelp,
  SymbolInformation,
  TextDocumentIdentifier,
  WorkspaceEdit,
  InitializeResult,
  InsertReplaceEdit,
  ServerCapabilities,
  TextEdit,
} from "vscode-languageserver-protocol"
import {
  applyWorkspaceEdit,
  clearLspMarkers,
  monacoModels,
  setLspMarkers,
  type LspDiagnostic,
  type LspWorkspaceEdit,
} from "@yaade/monaco"
import { canonicalizeFileUri, fileUriToPath } from "@yaade/shared"
import type { LspConnection } from "./manager.js"
import type { JetLspWorkspaceDeps } from "./yaade-workspace.js"
import { createWebSocketTransports } from "./transport.js"
import { yaadeLspClientCapabilities } from "./client-capabilities.js"
import { lspConnectionMatchesDocument } from "./connection-scope.js"
import { defaultWorkspaceConfiguration } from "./client-configuration.js"
import {
  capabilityEnabled,
  hasFullSemanticTokens,
  serverSupports,
} from "./server-capabilities.js"

export type LspServerMessageKind = "info" | "warning" | "error"
export type LspServerMessageHandler = (message: string, kind: LspServerMessageKind) => void

export type MonacoLspClient = {
  connectionId: string
  ready: Promise<void>
  supports(method: string): boolean
  stop(): void
  disconnect(): void
  sendRequest<R>(method: string, params?: unknown): Promise<R>
}

export type LspClientHandle = MonacoLspClient

function messageKindFromLspType(type: unknown): LspServerMessageKind {
  if (type === 1) return "error"
  if (type === 2) return "warning"
  return "info"
}

function lspPos(pos: monaco.Position): Position {
  return { line: pos.lineNumber - 1, character: pos.column - 1 }
}

function monacoRange(range: Range): monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  }
}

function diagnosticMessage(message: string | MarkupContent): string {
  return typeof message === "string" ? message : message.value
}

function asDiagnostics(params: PublishDiagnosticsParams): LspDiagnostic[] {
  return (params.diagnostics ?? []).map((d: Diagnostic) => ({
    range: d.range,
    severity: d.severity,
    message: diagnosticMessage(d.message),
    source: d.source,
    code: typeof d.code === "string" || typeof d.code === "number" ? d.code : undefined,
    tags: d.tags,
    relatedInformation: d.relatedInformation?.map(r => ({
      location: { uri: r.location.uri, range: r.location.range },
      message: r.message,
    })),
  }))
}

function markupToString(value: string | MarkupContent | undefined): string {
  if (!value) return ""
  return typeof value === "string" ? value : value.value
}

async function applyLspWorkspaceEdit(
  edit: WorkspaceEdit,
  deps: JetLspWorkspaceDeps,
  options?: { allowDirty?: boolean; atomic?: boolean },
): Promise<{ applied: boolean; reason?: string }> {
  const uris = new Set<string>()
  for (const uri of Object.keys(edit.changes ?? {})) {
    uris.add(canonicalizeFileUri(uri))
  }
  for (const change of edit.documentChanges ?? []) {
    if (!("textDocument" in change)) {
      return {
        applied: false,
        reason: "This language server requested unsupported file create/rename/delete operations",
      }
    }
    uris.add(canonicalizeFileUri(change.textDocument.uri))
  }

  for (const uri of uris) {
    if (monacoModels.has(uri)) continue
    let content: string
    try {
      content = await deps.readFile(uri)
    } catch {
      return { applied: false, reason: `Could not load ${fileUriToPath(uri)} for workspace edit` }
    }
    monacoModels.getOrCreate(uri, content, deps.getLanguageId(uri))
  }

  const result = applyWorkspaceEdit(edit as LspWorkspaceEdit, {
    registry: monacoModels,
    isDirty: deps.isDirty,
    getVersion: uri => monacoModels.get(uri)?.getVersionId(),
    getContent: uri => deps.getContent(uri) ?? monacoModels.getContent(uri),
    allowDirty: options?.allowDirty,
    atomic: options?.atomic,
  })

  if (result.skipped.length > 0) {
    return {
      applied: false,
      reason: result.skipped.map(entry => `${fileUriToPath(entry.uri)}: ${entry.reason}`).join("; "),
    }
  }

  for (const uri of result.applied) {
    const content = deps.getContent(uri) ?? monacoModels.getContent(uri)
    if (content == null) continue
    deps.updateContent(uri, content)
    if (!deps.isDirty(uri)) {
      await deps.writeFile(uri, content)
    }
  }

  for (const op of result.fileOperations) {
    if (op.kind === "create") {
      const content = deps.getContent(op.uri) ?? ""
      deps.updateContent(op.uri, content)
      if (!deps.isDirty(op.uri)) await deps.writeFile(op.uri, content)
    } else if (op.kind === "rename") {
      const content = deps.getContent(op.oldUri) ?? monacoModels.getContent(op.oldUri) ?? ""
      deps.updateContent(op.newUri, content)
      if (!deps.isDirty(op.newUri)) await deps.writeFile(op.newUri, content)
    } else if (op.kind === "delete") {
      deps.updateContent(op.uri, "")
    }
  }

  return { applied: result.applied.length > 0 }
}

function completionLabel(item: CompletionItem): string {
  const label = item.label as string | { label: string } | undefined
  if (typeof label === "string") return label
  if (label && typeof label === "object") return label.label
  return ""
}

function completionKind(kind: CompletionItemKind | undefined): monaco.languages.CompletionItemKind {
  switch (kind) {
    case CompletionItemKind.Method: return monaco.languages.CompletionItemKind.Method
    case CompletionItemKind.Function: return monaco.languages.CompletionItemKind.Function
    case CompletionItemKind.Constructor: return monaco.languages.CompletionItemKind.Constructor
    case CompletionItemKind.Field: return monaco.languages.CompletionItemKind.Field
    case CompletionItemKind.Variable: return monaco.languages.CompletionItemKind.Variable
    case CompletionItemKind.Class: return monaco.languages.CompletionItemKind.Class
    case CompletionItemKind.Interface: return monaco.languages.CompletionItemKind.Interface
    case CompletionItemKind.Module: return monaco.languages.CompletionItemKind.Module
    case CompletionItemKind.Property: return monaco.languages.CompletionItemKind.Property
    case CompletionItemKind.Unit: return monaco.languages.CompletionItemKind.Unit
    case CompletionItemKind.Value: return monaco.languages.CompletionItemKind.Value
    case CompletionItemKind.Enum: return monaco.languages.CompletionItemKind.Enum
    case CompletionItemKind.Keyword: return monaco.languages.CompletionItemKind.Keyword
    case CompletionItemKind.Snippet: return monaco.languages.CompletionItemKind.Snippet
    case CompletionItemKind.Color: return monaco.languages.CompletionItemKind.Color
    case CompletionItemKind.File: return monaco.languages.CompletionItemKind.File
    case CompletionItemKind.Reference: return monaco.languages.CompletionItemKind.Reference
    case CompletionItemKind.Folder: return monaco.languages.CompletionItemKind.Folder
    case CompletionItemKind.EnumMember: return monaco.languages.CompletionItemKind.EnumMember
    case CompletionItemKind.Constant: return monaco.languages.CompletionItemKind.Constant
    case CompletionItemKind.Struct: return monaco.languages.CompletionItemKind.Struct
    case CompletionItemKind.Event: return monaco.languages.CompletionItemKind.Event
    case CompletionItemKind.Operator: return monaco.languages.CompletionItemKind.Operator
    case CompletionItemKind.TypeParameter: return monaco.languages.CompletionItemKind.TypeParameter
    case CompletionItemKind.Text:
    default:
      return monaco.languages.CompletionItemKind.Text
  }
}

function isInsertReplaceEdit(edit: TextEdit | InsertReplaceEdit): edit is InsertReplaceEdit {
  return "insert" in edit && "replace" in edit
}

function completionRange(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  item: CompletionItem,
): monaco.IRange | monaco.languages.CompletionItemRanges {
  const edit = item.textEdit
  if (edit) {
    if (isInsertReplaceEdit(edit)) {
      return { insert: monacoRange(edit.insert), replace: monacoRange(edit.replace) }
    }
    return monacoRange(edit.range)
  }
  const word = model.getWordUntilPosition(position)
  return {
    startLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  }
}

function completionInsertText(item: CompletionItem): string {
  return item.textEdit?.newText ?? item.insertText ?? completionLabel(item)
}

function completionSuggestion(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  item: CompletionItem,
  index: number,
): monaco.languages.CompletionItem {
  return {
    label: completionLabel(item),
    kind: completionKind(item.kind),
    insertText: completionInsertText(item),
    insertTextRules:
      item.insertTextFormat === InsertTextFormat.Snippet
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
    range: completionRange(model, position, item),
    sortText: item.sortText ?? String(index).padStart(5, "0"),
    filterText: item.filterText,
    preselect: item.preselect,
    detail: item.detail,
    documentation: markupToString(item.documentation as string | MarkupContent | undefined),
    commitCharacters: item.commitCharacters,
    additionalTextEdits: item.additionalTextEdits?.map(edit => ({
      range: monacoRange(edit.range),
      text: edit.newText,
    })),
  }
}

function symbolKind(kind: LspSymbolKind): monaco.languages.SymbolKind {
  const kinds = monaco.languages.SymbolKind
  switch (kind) {
    case LspSymbolKind.File: return kinds.File
    case LspSymbolKind.Module: return kinds.Module
    case LspSymbolKind.Namespace: return kinds.Namespace
    case LspSymbolKind.Package: return kinds.Package
    case LspSymbolKind.Class: return kinds.Class
    case LspSymbolKind.Method: return kinds.Method
    case LspSymbolKind.Property: return kinds.Property
    case LspSymbolKind.Field: return kinds.Field
    case LspSymbolKind.Constructor: return kinds.Constructor
    case LspSymbolKind.Enum: return kinds.Enum
    case LspSymbolKind.Interface: return kinds.Interface
    case LspSymbolKind.Function: return kinds.Function
    case LspSymbolKind.Variable: return kinds.Variable
    case LspSymbolKind.Constant: return kinds.Constant
    case LspSymbolKind.String: return kinds.String
    case LspSymbolKind.Number: return kinds.Number
    case LspSymbolKind.Boolean: return kinds.Boolean
    case LspSymbolKind.Array: return kinds.Array
    case LspSymbolKind.Object: return kinds.Object
    case LspSymbolKind.Key: return kinds.Key
    case LspSymbolKind.Null: return kinds.Null
    case LspSymbolKind.EnumMember: return kinds.EnumMember
    case LspSymbolKind.Struct: return kinds.Struct
    case LspSymbolKind.Event: return kinds.Event
    case LspSymbolKind.Operator: return kinds.Operator
    case LspSymbolKind.TypeParameter: return kinds.TypeParameter
    default: return kinds.Variable
  }
}

function documentSymbol(symbol: DocumentSymbol): monaco.languages.DocumentSymbol {
  return {
    name: symbol.name,
    detail: symbol.detail ?? "",
    kind: symbolKind(symbol.kind),
    tags: [],
    range: monacoRange(symbol.range),
    selectionRange: monacoRange(symbol.selectionRange),
    children: symbol.children?.map(documentSymbol),
  }
}

function command(command: Command | undefined): monaco.languages.Command | undefined {
  if (!command) return undefined
  return { id: command.command, title: command.title, arguments: command.arguments }
}

function workspaceEdit(edit: WorkspaceEdit | undefined): monaco.languages.WorkspaceEdit | undefined {
  if (!edit) return undefined
  const edits: monaco.languages.IWorkspaceTextEdit[] = []
  for (const [uri, textEdits] of Object.entries(edit.changes ?? {})) {
    for (const textEdit of textEdits) {
      edits.push({
        resource: monaco.Uri.parse(uri),
        versionId: undefined,
        textEdit: { range: monacoRange(textEdit.range), text: textEdit.newText },
      })
    }
  }
  for (const change of edit.documentChanges ?? []) {
    if (!("textDocument" in change)) return undefined
    for (const textEdit of change.edits) {
      if (!("range" in textEdit) || !("newText" in textEdit)) continue
      edits.push({
        resource: monaco.Uri.parse(change.textDocument.uri),
        versionId: change.textDocument.version ?? undefined,
        textEdit: { range: monacoRange(textEdit.range), text: textEdit.newText },
      })
    }
  }
  return { edits }
}

function codeActionDiagnostic(diagnostic: monaco.editor.IMarkerData): Diagnostic {
  return {
    range: {
      start: { line: diagnostic.startLineNumber - 1, character: diagnostic.startColumn - 1 },
      end: { line: diagnostic.endLineNumber - 1, character: diagnostic.endColumn - 1 },
    },
    message: diagnostic.message,
    source: diagnostic.source,
    code: typeof diagnostic.code === "object" ? diagnostic.code.value : diagnostic.code,
  }
}

function isLspCommand(action: CodeAction | Command): action is Command {
  return "command" in action && typeof action.command === "string"
}

function requestWithCancellation<R>(
  connection: MessageConnection,
  method: string,
  params: unknown,
  token: monaco.CancellationToken,
): Promise<R> {
  const source = new CancellationTokenSource()
  const subscription = token.onCancellationRequested(() => source.cancel())
  return (connection.sendRequest(method, params, source.token) as Promise<R>).finally(() => {
    subscription.dispose()
    source.dispose()
  })
}

export class LspClientPool {
  private clients = new Map<string, MonacoLspClient>()
  private pending = new Map<string, Promise<MonacoLspClient>>()
  private connectionGenerations = new Map<string, number>()
  private pendingDisconnectors = new Map<string, () => void>()
  private connections = new Map<string, MessageConnection>()
  private connectionDescriptors = new Map<string, LspConnection>()
  private disposables = new Map<string, monaco.IDisposable[]>()
  private modelChangeDisposables = new Map<string, Map<string, monaco.IDisposable>>()
  private modelRegistrars = new Map<
    string,
    (model: monaco.editor.ITextModel) => void
  >()
  private workspaceDeps: JetLspWorkspaceDeps | null = null
  private onServerMessage: LspServerMessageHandler | null = null
  private openDocs = new Map<string, Set<string>>()
  private editorOpener: monaco.IDisposable | null = null

  private lspOwnerId(connectionId: string): string {
    return `lsp:${connectionId}`
  }

  setWorkspaceDeps(deps: JetLspWorkspaceDeps): void {
    this.workspaceDeps = deps
    this.ensureEditorOpener()
  }

  setServerMessageHandler(handler: LspServerMessageHandler | null): void {
    this.onServerMessage = handler
  }

  /** Monaco go-to-def / peek need an opener for models other than the active one. */
  private ensureEditorOpener(): void {
    if (this.editorOpener) return
    this.editorOpener = monaco.editor.registerEditorOpener({
      openCodeEditor: (source, resource, selectionOrPosition) => {
        const deps = this.workspaceDeps
        if (!deps) return false
        if (resource.scheme !== "file") return false
        const uri = canonicalizeFileUri(resource.toString())
        const path = fileUriToPath(uri)
        let line: number | undefined
        let column: number | undefined
        if (selectionOrPosition) {
          if ("startLineNumber" in selectionOrPosition) {
            line = selectionOrPosition.startLineNumber
            column = selectionOrPosition.startColumn
          } else {
            line = selectionOrPosition.lineNumber
            column = selectionOrPosition.column
          }
        }
        const sourceModel = source.getModel()
        const sourcePosition = source.getPosition()
        if (sourceModel && sourcePosition) {
          deps.pushJumpLocation?.(
            sourceModel.uri.toString(),
            sourcePosition.lineNumber,
            sourcePosition.column,
          )
        }
        // Same buffer: reveal in place so we never open a duplicate tab for a
        // URI-variant of the file already under the cursor.
        if (sourceModel) {
          const sourceUri = canonicalizeFileUri(sourceModel.uri.toString())
          if (sourceUri === uri && line != null) {
            const col = column ?? 1
            source.setPosition({ lineNumber: line, column: col })
            source.revealPositionInCenter({ lineNumber: line, column: col })
            source.focus()
            deps.openFile(uri, path, line, column)
            return true
          }
        }
        deps.openFile(uri, path, line, column)
        return true
      },
    })
  }

  async getOrCreateClient(conn: LspConnection): Promise<MonacoLspClient> {
    const existing = this.clients.get(conn.id)
    if (existing) return existing
    const pending = this.pending.get(conn.id)
    if (pending) return pending

    const generation = this.connectionGenerations.get(conn.id) ?? 0
    const connecting = this.connect(conn, generation)
    this.pending.set(conn.id, connecting)
    try {
      const client = await connecting
      if ((this.connectionGenerations.get(conn.id) ?? 0) !== generation) {
        client.disconnect()
        throw new Error(`LSP connection ${conn.id} was released during startup`)
      }
      this.clients.set(conn.id, client)
      return client
    } finally {
      this.pending.delete(conn.id)
    }
  }

  getClient(connectionId: string): MonacoLspClient | undefined {
    return this.clients.get(connectionId)
  }

  /** Open protocol ownership follows an open editor buffer, not model creation. */
  async openDocument(connectionId: string, uri: string): Promise<boolean> {
    const connection = this.connections.get(connectionId)
    const descriptor = this.connectionDescriptors.get(connectionId)
    const model = monacoModels.get(uri)
    if (!connection || !descriptor || !model || !this.matchesConnection(model, descriptor)) {
      return false
    }
    await this.didOpen(connectionId, connection, model)
    return true
  }

  /** Close a URI on every connection that currently owns it. */
  closeDocument(uri: string): void {
    const canonical = canonicalizeFileUri(uri)
    for (const [connectionId, open] of this.openDocs) {
      const owned = [...open].find(candidate => canonicalizeFileUri(candidate) === canonical)
      if (!owned || !open.delete(owned)) continue
      this.modelChangeDisposables.get(connectionId)?.get(owned)?.dispose()
      this.modelChangeDisposables.get(connectionId)?.delete(owned)
      monacoModels.release(owned, this.lspOwnerId(connectionId))
      clearLspMarkers(owned, connectionId)
      const connection = this.connections.get(connectionId)
      if (!connection) continue
      void connection.sendNotification("textDocument/didClose", {
        textDocument: { uri: owned },
      }).catch(() => {})
    }
  }

  releaseConnection(connectionId: string): void {
    this.connectionGenerations.set(
      connectionId,
      (this.connectionGenerations.get(connectionId) ?? 0) + 1,
    )
    this.pending.delete(connectionId)
    this.pendingDisconnectors.get(connectionId)?.()
    this.pendingDisconnectors.delete(connectionId)
    const client = this.clients.get(connectionId)
    if (client) {
      client.disconnect()
      this.clients.delete(connectionId)
    }
    this.connectionDescriptors.delete(connectionId)
    this.modelRegistrars.delete(connectionId)
    for (const disposable of this.modelChangeDisposables.get(connectionId)?.values() ?? []) {
      disposable.dispose()
    }
    this.modelChangeDisposables.delete(connectionId)
  }

  clear(): void {
    const ids = new Set([...this.pending.keys(), ...this.clients.keys()])
    for (const id of ids) this.releaseConnection(id)
    this.editorOpener?.dispose()
    this.editorOpener = null
  }

  private async connect(
    conn: LspConnection,
    generation: number,
  ): Promise<MonacoLspClient> {
    const deps = this.workspaceDeps
    if (!deps) throw new Error("LSP workspace deps not configured")

    const { webSocket, reader, writer } = await createWebSocketTransports(conn.transportUrl)
    const connection = createMessageConnection(reader, writer)
    const cancelPending = () => {
      if (this.connections.get(conn.id) === connection) {
        this.connections.delete(conn.id)
        this.connectionDescriptors.delete(conn.id)
      }
      try {
        connection.dispose()
      } catch {
        /* already disposed */
      }
      webSocket.close()
    }
    this.pendingDisconnectors.set(conn.id, cancelPending)
    if ((this.connectionGenerations.get(conn.id) ?? 0) !== generation) {
      cancelPending()
      this.pendingDisconnectors.delete(conn.id)
      throw new Error(`LSP connection ${conn.id} was released during startup`)
    }
    this.connections.set(conn.id, connection)
    this.connectionDescriptors.set(conn.id, conn)

    connection.onNotification("window/showMessage", (params: { type?: number; message?: string }) => {
      if (typeof params?.message !== "string") return
      if (params.type != null && params.type > 3) return
      this.onServerMessage?.(params.message, messageKindFromLspType(params.type))
    })

    connection.onNotification("$/progress", (params: { value?: { kind?: string; message?: string; title?: string } }) => {
      const value = params?.value
      if (!value || value.kind !== "end") return
      const message = value.message?.trim() || value.title?.trim()
      if (message) this.onServerMessage?.(message, "info")
    })

    connection.onNotification(
      "textDocument/publishDiagnostics",
      (params: PublishDiagnosticsParams) => {
        setLspMarkers(params.uri, conn.id, asDiagnostics(params))
      },
    )

    connection.onRequest("workspace/applyEdit", async (params: { edit: WorkspaceEdit }) => {
      const result = await applyLspWorkspaceEdit(params.edit, deps, { atomic: true })
      return { applied: result.applied, failureReason: result.reason }
    })
    connection.onRequest("workspace/configuration", (params: ConfigurationParams) =>
      defaultWorkspaceConfiguration(params),
    )
    connection.onRequest("window/workDoneProgress/create", () => null)
    connection.onRequest("client/registerCapability", () => null)
    connection.onRequest("client/unregisterCapability", () => null)

    connection.listen()

    let initialized: InitializeResult
    try {
      initialized = await connection.sendRequest<InitializeResult>("initialize", {
        processId: null,
        clientInfo: { name: "yaade", version: "0.0.1" },
        rootUri: conn.projectRootUri,
        workspaceFolders: [{ uri: conn.projectRootUri, name: "workspace" }],
        capabilities: yaadeLspClientCapabilities,
      })
    } catch (error) {
      cancelPending()
      this.pendingDisconnectors.delete(conn.id)
      throw error
    }

    this.pendingDisconnectors.delete(conn.id)

    await connection.sendNotification("initialized", {})

    const textDocumentSync = initialized.capabilities.textDocumentSync
    const syncKind =
      typeof textDocumentSync === "number"
        ? textDocumentSync
        : (textDocumentSync?.change ?? TextDocumentSyncKind.None)
    this.registerProviders(conn, connection, deps, syncKind, initialized.capabilities)

    let disconnected = false
    const client: MonacoLspClient = {
      connectionId: conn.id,
      ready: Promise.resolve(),
      supports: method => serverSupports(initialized.capabilities, method),
      stop: () => client.disconnect(),
      disconnect: () => {
        if (disconnected) return
        disconnected = true
        for (const d of this.disposables.get(conn.id) ?? []) d.dispose()
        this.disposables.delete(conn.id)
        for (const uri of this.openDocs.get(conn.id) ?? []) {
          monacoModels.release(uri, this.lspOwnerId(conn.id))
          clearLspMarkers(uri, conn.id)
        }
        this.openDocs.delete(conn.id)
        this.modelRegistrars.delete(conn.id)
        for (const disposable of this.modelChangeDisposables.get(conn.id)?.values() ?? []) {
          disposable.dispose()
        }
        this.modelChangeDisposables.delete(conn.id)
        try {
          void connection.sendRequest("shutdown", null).catch(() => {})
          void connection.sendNotification("exit").catch(() => {})
        } catch {
          /* ignore */
        }
        connection.dispose()
        this.pendingDisconnectors.delete(conn.id)
        this.connections.delete(conn.id)
        this.connectionDescriptors.delete(conn.id)
        webSocket.close()
      },
      sendRequest: <R>(method: string, params?: unknown) =>
        connection.sendRequest(method, params) as Promise<R>,
    }

    return client
  }

  private matchesConnection(model: monaco.editor.ITextModel, conn: LspConnection): boolean {
    return lspConnectionMatchesDocument(
      model.uri.toString(),
      model.getLanguageId(),
      conn.projectRootUri,
      conn.languageIds,
    )
  }

  private async didOpen(
    connectionId: string,
    connection: MessageConnection,
    model: monaco.editor.ITextModel,
  ): Promise<void> {
    const uri = model.uri.toString()
    this.modelRegistrars.get(connectionId)?.(model)
    let set = this.openDocs.get(connectionId)
    if (!set) {
      set = new Set()
      this.openDocs.set(connectionId, set)
    }
    if (set.has(uri)) return
    set.add(uri)
    monacoModels.retain(uri, this.lspOwnerId(connectionId))
    try {
      await connection.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: model.getLanguageId(),
          version: model.getVersionId(),
          text: model.getValue(),
        },
      })
    } catch (error) {
      set.delete(uri)
      this.modelChangeDisposables.get(connectionId)?.get(uri)?.dispose()
      this.modelChangeDisposables.get(connectionId)?.delete(uri)
      monacoModels.release(uri, this.lspOwnerId(connectionId))
      throw error
    }
  }

  private registerProviders(
    conn: LspConnection,
    connection: MessageConnection,
    deps: JetLspWorkspaceDeps,
    syncKind: TextDocumentSyncKind,
    capabilities: ServerCapabilities,
  ): void {
    // Monaco model language ids (tsx/jsx/mts/cts are aliased to ts/js at model create).
    const selector = [
      ...new Set(
        conn.languageIds.map(id => {
          if (id === "tsx" || id === "mts" || id === "cts") return "typescript"
          if (id === "jsx") return "javascript"
          return id
        }),
      ),
    ]
    const disposables: monaco.IDisposable[] = []

    const docId = (model: monaco.editor.ITextModel): TextDocumentIdentifier => ({
      uri: model.uri.toString(),
    })

    const registerModelChanges = (model: monaco.editor.ITextModel) => {
      if (!this.matchesConnection(model, conn)) return
      const uri = model.uri.toString()
      let subscriptions = this.modelChangeDisposables.get(conn.id)
      if (!subscriptions) {
        subscriptions = new Map()
        this.modelChangeDisposables.set(conn.id, subscriptions)
      }
      if (subscriptions.has(uri)) return
      subscriptions.set(
        uri,
        model.onDidChangeContent(event => {
          if (syncKind === TextDocumentSyncKind.None) return
          const contentChanges = lspContentChanges(
            syncKind,
            event.changes,
            () => model.getValue(),
          )
          void connection.sendNotification("textDocument/didChange", {
            textDocument: { uri: model.uri.toString(), version: model.getVersionId() },
            contentChanges,
          })
        }),
      )
    }
    this.modelRegistrars.set(conn.id, registerModelChanges)

    for (const commandId of capabilities.executeCommandProvider?.commands ?? []) {
      disposables.push(monaco.editor.registerCommand(commandId, (_accessor, ...args: unknown[]) =>
        connection.sendRequest("workspace/executeCommand", {
          command: commandId,
          arguments: args,
        }),
      ))
    }

    if (capabilities.completionProvider) disposables.push(
      monaco.languages.registerCompletionItemProvider(selector, {
        triggerCharacters: capabilities.completionProvider.triggerCharacters ?? [],
        provideCompletionItems: async (model, position, _context, token) => {
          if (!this.matchesConnection(model, conn)) return { suggestions: [] }
          const result = await requestWithCancellation<
            { items?: CompletionItem[]; isIncomplete?: boolean } | CompletionItem[]
          >(connection, "textDocument/completion", {
            textDocument: docId(model),
            position: lspPos(position),
          }, token)
          const items = Array.isArray(result) ? result : (result?.items ?? [])
          return {
            incomplete: !Array.isArray(result) && Boolean(result?.isIncomplete),
            suggestions: items.map((item, index) =>
              completionSuggestion(model, position, item, index),
            ),
          }
        },
      }),
    )

    if (capabilityEnabled(capabilities.hoverProvider)) disposables.push(
      monaco.languages.registerHoverProvider(selector, {
        provideHover: async (model, position, token) => {
          if (!this.matchesConnection(model, conn)) return null
          const hover = await requestWithCancellation<Hover | null>(connection, "textDocument/hover", {
            textDocument: docId(model),
            position: lspPos(position),
          }, token)
          if (!hover?.contents) return null
          const value = Array.isArray(hover.contents)
            ? hover.contents.map(c => markupToString(c as string | MarkupContent)).join("\n\n")
            : markupToString(hover.contents as string | MarkupContent)
          return {
            range: hover.range ? monacoRange(hover.range) : undefined,
            contents: [{ value }],
          }
        },
      }),
    )

    if (capabilityEnabled(capabilities.definitionProvider)) disposables.push(
      monaco.languages.registerDefinitionProvider(selector, {
        provideDefinition: async (model, position, token) => {
          if (!this.matchesConnection(model, conn)) return null
          const result = await requestWithCancellation<Location | Location[] | LocationLink[] | null>(
            connection,
            "textDocument/definition",
            { textDocument: docId(model), position: lspPos(position) },
            token,
          )
          return this.locationsToLinks(result)
        },
      }),
    )

    if (capabilityEnabled(capabilities.declarationProvider)) {
      disposables.push(monaco.languages.registerDeclarationProvider(selector, {
        provideDeclaration: (model, position, token) =>
          this.provideLocations(conn, connection, "textDocument/declaration", model, position, token),
      }))
    }

    if (capabilityEnabled(capabilities.typeDefinitionProvider)) {
      disposables.push(monaco.languages.registerTypeDefinitionProvider(selector, {
        provideTypeDefinition: (model, position, token) =>
          this.provideLocations(conn, connection, "textDocument/typeDefinition", model, position, token),
      }))
    }

    if (capabilityEnabled(capabilities.implementationProvider)) {
      disposables.push(monaco.languages.registerImplementationProvider(selector, {
        provideImplementation: (model, position, token) =>
          this.provideLocations(conn, connection, "textDocument/implementation", model, position, token),
      }))
    }

    if (capabilityEnabled(capabilities.referencesProvider)) disposables.push(
      monaco.languages.registerReferenceProvider(selector, {
        provideReferences: async (model, position, context, token) => {
          if (!this.matchesConnection(model, conn)) return []
          const result = await requestWithCancellation<Location[] | null>(connection, "textDocument/references", {
            textDocument: docId(model),
            position: lspPos(position),
            context: { includeDeclaration: context.includeDeclaration },
          }, token)
          return (result ?? []).map((loc: Location) => ({
            uri: monaco.Uri.parse(loc.uri),
            range: monacoRange(loc.range),
          }))
        },
      }),
    )

    if (capabilityEnabled(capabilities.renameProvider)) disposables.push(
      monaco.languages.registerRenameProvider(selector, {
        resolveRenameLocation:
          typeof capabilities.renameProvider === "object" &&
          capabilities.renameProvider.prepareProvider
            ? async (model, position, token) => {
                if (!this.matchesConnection(model, conn)) {
                  return { range: monacoRange({ start: lspPos(position), end: lspPos(position) }), text: "" }
                }
                const prepared = await requestWithCancellation<PrepareRenameResult | null>(
                  connection,
                  "textDocument/prepareRename",
                  { textDocument: docId(model), position: lspPos(position) },
                  token,
                )
                if (!prepared || "defaultBehavior" in prepared) {
                  const word = model.getWordAtPosition(position)
                  if (!word) {
                    return {
                      range: monacoRange({ start: lspPos(position), end: lspPos(position) }),
                      text: "",
                      rejectReason: "No symbol at the current position",
                    }
                  }
                  return {
                    range: {
                      startLineNumber: position.lineNumber,
                      startColumn: word.startColumn,
                      endLineNumber: position.lineNumber,
                      endColumn: word.endColumn,
                    },
                    text: word.word,
                  }
                }
                const range = "range" in prepared ? prepared.range : prepared
                const monacoPreparedRange = monacoRange(range)
                return {
                  range: monacoPreparedRange,
                  text:
                    "placeholder" in prepared
                      ? prepared.placeholder
                      : model.getValueInRange(monacoPreparedRange),
                }
              }
            : undefined,
        provideRenameEdits: async (model, position, newName, token) => {
          if (!this.matchesConnection(model, conn)) return null
          const edit = await requestWithCancellation<WorkspaceEdit | null>(connection, "textDocument/rename", {
            textDocument: docId(model),
            position: lspPos(position),
            newName,
          }, token)
          if (!edit) return null
          const result = await applyLspWorkspaceEdit(edit, deps, {
            allowDirty: true,
            atomic: true,
          })
          return result.applied
            ? { edits: [] }
            : { edits: [], rejectReason: result.reason ?? "Rename could not be applied" }
        },
      }),
    )

    if (capabilityEnabled(capabilities.documentFormattingProvider)) disposables.push(
      monaco.languages.registerDocumentFormattingEditProvider(selector, {
        provideDocumentFormattingEdits: async (model, _options, token) => {
          if (!this.matchesConnection(model, conn)) return []
          const modelOptions = model.getOptions()
          const edits = await requestWithCancellation<{ range: Range; newText: string }[] | null>(
            connection,
            "textDocument/formatting",
            {
              textDocument: docId(model),
              options: {
                tabSize: modelOptions.tabSize,
                insertSpaces: modelOptions.insertSpaces,
              },
            },
            token,
          )
          return (edits ?? []).map((e: { range: Range; newText: string }) => ({
            range: monacoRange(e.range),
            text: e.newText,
          }))
        },
      }),
    )

    if (capabilityEnabled(capabilities.documentRangeFormattingProvider)) disposables.push(
      monaco.languages.registerDocumentRangeFormattingEditProvider(selector, {
        provideDocumentRangeFormattingEdits: async (model, range, _options, token) => {
          if (!this.matchesConnection(model, conn)) return []
          const modelOptions = model.getOptions()
          const edits = await requestWithCancellation<TextEdit[] | null>(
            connection,
            "textDocument/rangeFormatting",
            {
              textDocument: docId(model),
              range: {
                start: lspPos({ lineNumber: range.startLineNumber, column: range.startColumn } as monaco.Position),
                end: lspPos({ lineNumber: range.endLineNumber, column: range.endColumn } as monaco.Position),
              },
              options: {
                tabSize: modelOptions.tabSize,
                insertSpaces: modelOptions.insertSpaces,
              },
            },
            token,
          )
          return (edits ?? []).map(edit => ({
            range: monacoRange(edit.range),
            text: edit.newText,
          }))
        },
      }),
    )

    if (capabilityEnabled(capabilities.documentSymbolProvider)) disposables.push(
      monaco.languages.registerDocumentSymbolProvider(selector, {
        provideDocumentSymbols: async (model, token) => {
          if (!this.matchesConnection(model, conn)) return []
          const symbols = await requestWithCancellation<
            DocumentSymbol[] | SymbolInformation[] | null
          >(connection, "textDocument/documentSymbol", { textDocument: docId(model) }, token)
          return (symbols ?? []).map(symbol => {
            if ("location" in symbol) {
              return {
                name: symbol.name,
                detail: symbol.containerName ?? "",
                kind: symbolKind(symbol.kind),
                tags: [],
                range: monacoRange(symbol.location.range),
                selectionRange: monacoRange(symbol.location.range),
              }
            }
            return documentSymbol(symbol)
          })
        },
      }),
    )

    if (capabilityEnabled(capabilities.codeActionProvider)) disposables.push(
      monaco.languages.registerCodeActionProvider(selector, {
        provideCodeActions: async (model, range, context, token) => {
          if (!this.matchesConnection(model, conn)) return { actions: [], dispose: () => {} }
          const lspContext: CodeActionContext = {
            diagnostics: context.markers.map(codeActionDiagnostic),
            only: context.only ? [context.only] : undefined,
            triggerKind: context.trigger === monaco.languages.CodeActionTriggerType.Auto ? 2 : 1,
          }
          const actions = await requestWithCancellation<(CodeAction | Command)[] | null>(
            connection,
            "textDocument/codeAction",
            {
              textDocument: docId(model),
              range: {
                start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
                end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
              },
              context: lspContext,
            },
            token,
          )
          return {
            actions: (actions ?? []).map(action => {
              if (isLspCommand(action)) {
                return { title: action.title, command: command(action) }
              }
              const mappedEdit = workspaceEdit(action.edit)
              return {
                title: action.title,
                kind: action.kind,
                diagnostics: context.markers,
                edit: mappedEdit,
                command: command(action.command),
                isPreferred: action.isPreferred,
                disabled: action.edit && !mappedEdit
                  ? "File create, rename, and delete code actions are not supported"
                  : action.disabled?.reason,
              }
            }),
            dispose: () => {},
          }
        },
      }),
    )

    const semanticTokensProvider = capabilities.semanticTokensProvider
    if (hasFullSemanticTokens(capabilities) && typeof semanticTokensProvider === "object" && semanticTokensProvider != null) {
      disposables.push(monaco.languages.registerDocumentSemanticTokensProvider(selector, {
        getLegend: () => ({
          tokenTypes: semanticTokensProvider.legend.tokenTypes,
          tokenModifiers: semanticTokensProvider.legend.tokenModifiers,
        }),
        provideDocumentSemanticTokens: async (model, _lastResultId, token) => {
          if (!this.matchesConnection(model, conn)) return null
          const result = await requestWithCancellation<SemanticTokens | null>(
            connection,
            "textDocument/semanticTokens/full",
            { textDocument: docId(model) },
            token,
          )
          return result
            ? { resultId: result.resultId, data: Uint32Array.from(result.data) }
            : null
        },
        releaseDocumentSemanticTokens: () => {},
      }))
    }

    if (capabilityEnabled(capabilities.inlayHintProvider)) disposables.push(
      monaco.languages.registerInlayHintsProvider(selector, {
        displayName: conn.descriptorId,
        provideInlayHints: async (model, range, token) => {
          if (!this.matchesConnection(model, conn)) return { hints: [], dispose: () => {} }
          const hints = await requestWithCancellation<InlayHint[] | null>(
            connection,
            "textDocument/inlayHint",
            {
              textDocument: docId(model),
              range: {
                start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
                end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
              },
            },
            token,
          )
          return {
            hints: (hints ?? []).map(hint => ({
              position: {
                lineNumber: hint.position.line + 1,
                column: hint.position.character + 1,
              },
              label: typeof hint.label === "string"
                ? hint.label
                : hint.label.map(part => ({
                    label: part.value,
                    tooltip: part.tooltip ? { value: markupToString(part.tooltip) } : undefined,
                    command: command(part.command),
                    location: part.location
                      ? { uri: monaco.Uri.parse(part.location.uri), range: monacoRange(part.location.range) }
                      : undefined,
                  })),
              kind: hint.kind === InlayHintKind.Parameter
                ? monaco.languages.InlayHintKind.Parameter
                : monaco.languages.InlayHintKind.Type,
              tooltip: hint.tooltip ? { value: markupToString(hint.tooltip) } : undefined,
              paddingLeft: hint.paddingLeft,
              paddingRight: hint.paddingRight,
              textEdits: hint.textEdits?.map(edit => ({
                range: monacoRange(edit.range),
                text: edit.newText,
              })),
            })),
            dispose: () => {},
          }
        },
      }),
    )

    if (capabilityEnabled(capabilities.documentHighlightProvider)) disposables.push(
      monaco.languages.registerDocumentHighlightProvider(selector, {
        provideDocumentHighlights: async (model, position, token) => {
          if (!this.matchesConnection(model, conn)) return []
          const highlights = await requestWithCancellation<DocumentHighlight[] | null>(
            connection,
            "textDocument/documentHighlight",
            { textDocument: docId(model), position: lspPos(position) },
            token,
          )
          return (highlights ?? []).map(highlight => ({
            range: monacoRange(highlight.range),
            kind: highlight.kind === DocumentHighlightKind.Read
              ? monaco.languages.DocumentHighlightKind.Read
              : highlight.kind === DocumentHighlightKind.Write
                ? monaco.languages.DocumentHighlightKind.Write
                : monaco.languages.DocumentHighlightKind.Text,
          }))
        },
      }),
    )

    if (capabilities.codeLensProvider) disposables.push(
      monaco.languages.registerCodeLensProvider(selector, {
        provideCodeLenses: async (model, token) => {
          if (!this.matchesConnection(model, conn)) return { lenses: [], dispose: () => {} }
          const lenses = await requestWithCancellation<CodeLens[] | null>(
            connection,
            "textDocument/codeLens",
            { textDocument: docId(model) },
            token,
          )
          return {
            lenses: (lenses ?? []).map(lens => ({
              range: monacoRange(lens.range),
              command: command(lens.command),
            })),
            dispose: () => {},
          }
        },
        resolveCodeLens: capabilities.codeLensProvider.resolveProvider
          ? async (_model, lens, token) => {
              const resolved = await requestWithCancellation<CodeLens>(
                connection,
                "codeLens/resolve",
                {
                  range: {
                    start: {
                      line: lens.range.startLineNumber - 1,
                      character: lens.range.startColumn - 1,
                    },
                    end: {
                      line: lens.range.endLineNumber - 1,
                      character: lens.range.endColumn - 1,
                    },
                  },
                  command: lens.command
                    ? { title: lens.command.title, command: lens.command.id, arguments: lens.command.arguments }
                    : undefined,
                },
                token,
              )
              return { range: monacoRange(resolved.range), command: command(resolved.command) }
            }
          : undefined,
      }),
    )

    if (capabilities.signatureHelpProvider) disposables.push(
      monaco.languages.registerSignatureHelpProvider(selector, {
        signatureHelpTriggerCharacters:
          capabilities.signatureHelpProvider.triggerCharacters ?? [],
        provideSignatureHelp: async (model, position, token) => {
          if (!this.matchesConnection(model, conn)) return null
          const help = await requestWithCancellation<SignatureHelp | null>(connection, "textDocument/signatureHelp", {
            textDocument: docId(model),
            position: lspPos(position),
          }, token)
          if (!help) return null
          return {
            value: {
              signatures: help.signatures.map((s: SignatureHelp["signatures"][number]) => ({
                label: s.label,
                documentation: markupToString(s.documentation as string | MarkupContent | undefined),
                parameters: (s.parameters ?? []).map((p: NonNullable<typeof s.parameters>[number]) => ({
                  label: typeof p.label === "string" ? p.label : [p.label[0], p.label[1]],
                  documentation: markupToString(p.documentation as string | MarkupContent | undefined),
                })),
              })),
              activeSignature: help.activeSignature ?? 0,
              activeParameter: help.activeParameter ?? 0,
            },
            dispose: () => {},
          }
        },
      }),
    )

    this.disposables.set(conn.id, disposables)
  }

  private async provideLocations(
    conn: LspConnection,
    connection: MessageConnection,
    method:
      | "textDocument/declaration"
      | "textDocument/typeDefinition"
      | "textDocument/implementation",
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    token: monaco.CancellationToken,
  ): Promise<
    monaco.languages.Location | monaco.languages.Location[] | monaco.languages.LocationLink[] | null
  > {
    if (!this.matchesConnection(model, conn)) return null
    const result = await requestWithCancellation<
      Location | Location[] | LocationLink[] | null
    >(
      connection,
      method,
      { textDocument: { uri: model.uri.toString() }, position: lspPos(position) },
      token,
    )
    return this.locationsToLinks(result)
  }

  private locationsToLinks(
    result: Location | Location[] | LocationLink[] | null,
  ): monaco.languages.Location | monaco.languages.Location[] | monaco.languages.LocationLink[] | null {
    if (!result) return null
    if (Array.isArray(result)) {
      if (result.length === 0) return []
      if ("targetUri" in result[0]!) {
        return (result as LocationLink[]).map((l: LocationLink) => ({
          uri: monaco.Uri.parse(l.targetUri),
          range: monacoRange(l.targetRange),
          targetSelectionRange: monacoRange(l.targetSelectionRange),
          originSelectionRange: l.originSelectionRange
            ? monacoRange(l.originSelectionRange)
            : undefined,
        }))
      }
      return (result as Location[]).map((l: Location) => ({
        uri: monaco.Uri.parse(l.uri),
        range: monacoRange(l.range),
      }))
    }
    const loc = result as Location
    return { uri: monaco.Uri.parse(loc.uri), range: monacoRange(loc.range) }
  }
}
