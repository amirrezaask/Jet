import * as monaco from "monaco-editor"
import { createMessageConnection, type MessageConnection } from "vscode-jsonrpc/browser.js"
import type {
  CompletionItem,
  Diagnostic,
  Hover,
  Location,
  LocationLink,
  MarkupContent,
  Position,
  PublishDiagnosticsParams,
  Range,
  SignatureHelp,
  TextDocumentIdentifier,
  WorkspaceEdit,
} from "vscode-languageserver-protocol"
import {
  applyWorkspaceEdit,
  clearLspMarkers,
  monacoModels,
  setLspMarkers,
  type LspDiagnostic,
  type LspWorkspaceEdit,
} from "@gharargah/monaco"
import type { LspConnection } from "./manager.js"
import type { JetLspWorkspaceDeps } from "./gharargah-workspace.js"
import { createWebSocketTransports } from "./transport.js"
import { gharargahLspClientCapabilities } from "./client-capabilities.js"

export type LspServerMessageKind = "info" | "warning" | "error"
export type LspServerMessageHandler = (message: string, kind: LspServerMessageKind) => void

export type MonacoLspClient = {
  connectionId: string
  ready: Promise<void>
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
): Promise<boolean> {
  const result = applyWorkspaceEdit(edit as LspWorkspaceEdit, {
    registry: monacoModels,
    isDirty: deps.isDirty,
    getContent: uri => deps.getContent(uri) ?? monacoModels.getContent(uri),
  })

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

  return result.applied.length > 0 || result.fileOperations.length > 0
}

function completionLabel(item: CompletionItem): string {
  const label = item.label as string | { label: string } | undefined
  if (typeof label === "string") return label
  if (label && typeof label === "object") return label.label
  return ""
}

export class LspClientPool {
  private clients = new Map<string, MonacoLspClient>()
  private pending = new Map<string, Promise<MonacoLspClient>>()
  private connections = new Map<string, MessageConnection>()
  private disposables = new Map<string, monaco.IDisposable[]>()
  private workspaceDeps: JetLspWorkspaceDeps | null = null
  private onServerMessage: LspServerMessageHandler | null = null
  private openDocs = new Map<string, Set<string>>()

  setWorkspaceDeps(deps: JetLspWorkspaceDeps): void {
    this.workspaceDeps = deps
  }

  setServerMessageHandler(handler: LspServerMessageHandler | null): void {
    this.onServerMessage = handler
  }

  async getOrCreateClient(conn: LspConnection): Promise<MonacoLspClient> {
    const existing = this.clients.get(conn.id)
    if (existing) return existing
    const pending = this.pending.get(conn.id)
    if (pending) return pending

    const connecting = this.connect(conn)
    this.pending.set(conn.id, connecting)
    try {
      const client = await connecting
      this.clients.set(conn.id, client)
      return client
    } finally {
      this.pending.delete(conn.id)
    }
  }

  getClient(connectionId: string): MonacoLspClient | undefined {
    return this.clients.get(connectionId)
  }

  releaseConnection(connectionId: string): void {
    this.pending.delete(connectionId)
    const client = this.clients.get(connectionId)
    if (client) {
      client.disconnect()
      this.clients.delete(connectionId)
    }
  }

  clear(): void {
    this.pending.clear()
    for (const id of [...this.clients.keys()]) this.releaseConnection(id)
  }

  private async connect(conn: LspConnection): Promise<MonacoLspClient> {
    const deps = this.workspaceDeps
    if (!deps) throw new Error("LSP workspace deps not configured")

    const { webSocket, reader, writer } = await createWebSocketTransports(conn.transportUrl)
    const connection = createMessageConnection(reader, writer)
    this.connections.set(conn.id, connection)

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
      const applied = await applyLspWorkspaceEdit(params.edit, deps)
      return { applied }
    })

    connection.listen()

    await connection.sendRequest("initialize", {
      processId: null,
      clientInfo: { name: "gharargah", version: "0.0.1" },
      rootUri: conn.projectRootUri,
      workspaceFolders: [{ uri: conn.projectRootUri, name: "workspace" }],
      capabilities: gharargahLspClientCapabilities,
    })

    await connection.sendNotification("initialized", {})

    this.registerProviders(conn, connection, deps)

    let disconnected = false
    const client: MonacoLspClient = {
      connectionId: conn.id,
      ready: Promise.resolve(),
      stop: () => client.disconnect(),
      disconnect: () => {
        if (disconnected) return
        disconnected = true
        for (const d of this.disposables.get(conn.id) ?? []) d.dispose()
        this.disposables.delete(conn.id)
        for (const uri of this.openDocs.get(conn.id) ?? []) {
          clearLspMarkers(uri, conn.id)
        }
        this.openDocs.delete(conn.id)
        try {
          void connection.sendRequest("shutdown", null)
          void connection.sendNotification("exit")
        } catch {
          /* ignore */
        }
        connection.dispose()
        this.connections.delete(conn.id)
        webSocket.close()
      },
      sendRequest: <R>(method: string, params?: unknown) =>
        connection.sendRequest(method, params) as Promise<R>,
    }

    for (const model of monaco.editor.getModels()) {
      if (this.matchesConnection(model, conn)) {
        void this.didOpen(conn.id, connection, model)
      }
    }

    return client
  }

  private matchesConnection(model: monaco.editor.ITextModel, conn: LspConnection): boolean {
    const lang = model.getLanguageId()
    return conn.languageIds.includes(lang)
  }

  private async didOpen(
    connectionId: string,
    connection: MessageConnection,
    model: monaco.editor.ITextModel,
  ): Promise<void> {
    const uri = model.uri.toString()
    let set = this.openDocs.get(connectionId)
    if (!set) {
      set = new Set()
      this.openDocs.set(connectionId, set)
    }
    if (set.has(uri)) return
    set.add(uri)
    await connection.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: model.getLanguageId(),
        version: model.getVersionId(),
        text: model.getValue(),
      },
    })
  }

  private registerProviders(
    conn: LspConnection,
    connection: MessageConnection,
    deps: JetLspWorkspaceDeps,
  ): void {
    const selector = [...new Set(conn.languageIds)]
    const disposables: monaco.IDisposable[] = []

    const docId = (model: monaco.editor.ITextModel): TextDocumentIdentifier => ({
      uri: model.uri.toString(),
    })

    disposables.push(
      monaco.editor.onDidCreateModel(model => {
        if (!this.matchesConnection(model, conn)) return
        void this.didOpen(conn.id, connection, model)
        disposables.push(
          model.onDidChangeContent(() => {
            void connection.sendNotification("textDocument/didChange", {
              textDocument: { uri: model.uri.toString(), version: model.getVersionId() },
              contentChanges: [{ text: model.getValue() }],
            })
          }),
        )
      }),
    )

    for (const model of monaco.editor.getModels()) {
      if (!this.matchesConnection(model, conn)) continue
      disposables.push(
        model.onDidChangeContent(() => {
          void connection.sendNotification("textDocument/didChange", {
            textDocument: { uri: model.uri.toString(), version: model.getVersionId() },
            contentChanges: [{ text: model.getValue() }],
          })
        }),
      )
    }

    disposables.push(
      monaco.languages.registerCompletionItemProvider(selector, {
        triggerCharacters: [".", '"', "'", "/", "@", "<"],
        provideCompletionItems: async (model, position) => {
          await this.didOpen(conn.id, connection, model)
          const result = await connection.sendRequest<
            { items?: CompletionItem[]; isIncomplete?: boolean } | CompletionItem[]
          >("textDocument/completion", {
            textDocument: docId(model),
            position: lspPos(position),
          })
          const items = Array.isArray(result) ? result : (result?.items ?? [])
          return {
            incomplete: !Array.isArray(result) && Boolean(result?.isIncomplete),
            suggestions: items.map((item: CompletionItem, i: number) => {
              const label = completionLabel(item)
              return {
                label,
                kind: monaco.languages.CompletionItemKind.Variable,
                insertText: item.insertText ?? label,
                range: undefined as unknown as monaco.IRange,
                sortText: item.sortText ?? String(i).padStart(5, "0"),
                detail: item.detail,
                documentation: markupToString(item.documentation as string | MarkupContent | undefined),
              }
            }),
          }
        },
      }),
    )

    disposables.push(
      monaco.languages.registerHoverProvider(selector, {
        provideHover: async (model, position) => {
          await this.didOpen(conn.id, connection, model)
          const hover = await connection.sendRequest<Hover | null>("textDocument/hover", {
            textDocument: docId(model),
            position: lspPos(position),
          })
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

    disposables.push(
      monaco.languages.registerDefinitionProvider(selector, {
        provideDefinition: async (model, position) => {
          await this.didOpen(conn.id, connection, model)
          const result = await connection.sendRequest<Location | Location[] | LocationLink[] | null>(
            "textDocument/definition",
            { textDocument: docId(model), position: lspPos(position) },
          )
          return this.locationsToLinks(result)
        },
      }),
    )

    disposables.push(
      monaco.languages.registerReferenceProvider(selector, {
        provideReferences: async (model, position, context) => {
          await this.didOpen(conn.id, connection, model)
          const result = await connection.sendRequest<Location[] | null>("textDocument/references", {
            textDocument: docId(model),
            position: lspPos(position),
            context: { includeDeclaration: context.includeDeclaration },
          })
          return (result ?? []).map((loc: Location) => ({
            uri: monaco.Uri.parse(loc.uri),
            range: monacoRange(loc.range),
          }))
        },
      }),
    )

    disposables.push(
      monaco.languages.registerRenameProvider(selector, {
        provideRenameEdits: async (model, position, newName) => {
          await this.didOpen(conn.id, connection, model)
          const edit = await connection.sendRequest<WorkspaceEdit | null>("textDocument/rename", {
            textDocument: docId(model),
            position: lspPos(position),
            newName,
          })
          if (!edit) return null
          await applyLspWorkspaceEdit(edit, deps)
          return { edits: [] }
        },
      }),
    )

    disposables.push(
      monaco.languages.registerDocumentFormattingEditProvider(selector, {
        provideDocumentFormattingEdits: async model => {
          await this.didOpen(conn.id, connection, model)
          const edits = await connection.sendRequest<{ range: Range; newText: string }[] | null>(
            "textDocument/formatting",
            {
              textDocument: docId(model),
              options: { tabSize: 2, insertSpaces: true },
            },
          )
          return (edits ?? []).map((e: { range: Range; newText: string }) => ({
            range: monacoRange(e.range),
            text: e.newText,
          }))
        },
      }),
    )

    disposables.push(
      monaco.languages.registerSignatureHelpProvider(selector, {
        signatureHelpTriggerCharacters: ["(", ","],
        provideSignatureHelp: async (model, position) => {
          await this.didOpen(conn.id, connection, model)
          const help = await connection.sendRequest<SignatureHelp | null>("textDocument/signatureHelp", {
            textDocument: docId(model),
            position: lspPos(position),
          })
          if (!help) return null
          return {
            value: {
              signatures: help.signatures.map((s: SignatureHelp["signatures"][number]) => ({
                label: s.label,
                documentation: markupToString(s.documentation as string | MarkupContent | undefined),
                parameters: (s.parameters ?? []).map((p: NonNullable<typeof s.parameters>[number]) => ({
                  label: typeof p.label === "string" ? p.label : "",
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

  private locationsToLinks(
    result: Location | Location[] | LocationLink[] | null,
  ): monaco.languages.Location | monaco.languages.Location[] | monaco.languages.LocationLink[] | null {
    if (!result) return null
    if (Array.isArray(result)) {
      if (result.length === 0) return []
      if ("targetUri" in result[0]!) {
        return (result as LocationLink[]).map((l: LocationLink) => ({
          uri: monaco.Uri.parse(l.targetUri),
          range: monacoRange(l.targetSelectionRange ?? l.targetRange),
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
