import { LSPClient } from "@codemirror/lsp-client"
import { simpleWebSocketTransport } from "@jet/codemirror"
import type { LspConnection } from "./manager.js"
import { JetLspWorkspace, type JetLspWorkspaceDeps } from "./jet-workspace.js"
import { jetLanguageServerExtensions } from "./lsp-extensions.js"

export type LspServerMessageKind = "info" | "warning" | "error"

export type LspServerMessageHandler = (message: string, kind: LspServerMessageKind) => void

function sanitizeLspHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html")
  document.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach(node => node.remove())
  document.body.querySelectorAll("*").forEach(element => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim().toLowerCase()
      if (name.startsWith("on") || name === "srcdoc" || ((name === "href" || name === "src") && value.startsWith("javascript:"))) {
        element.removeAttribute(attribute.name)
      }
    }
  })
  return document.body.innerHTML
}

function messageKindFromLspType(type: unknown): LspServerMessageKind {
  // LSP MessageType: 1 Error, 2 Warning, 3 Info, 4 Log
  if (type === 1) return "error"
  if (type === 2) return "warning"
  return "info"
}

export class LspClientPool {
  private clients = new Map<string, LSPClient>()
  private pendingClients = new Map<string, Promise<LSPClient>>()
  private workspaceDeps: JetLspWorkspaceDeps | null = null
  private onServerMessage: LspServerMessageHandler | null = null

  setWorkspaceDeps(deps: JetLspWorkspaceDeps): void {
    this.workspaceDeps = deps
  }

  setServerMessageHandler(handler: LspServerMessageHandler | null): void {
    this.onServerMessage = handler
  }

  private emitServerMessage(message: string, kind: LspServerMessageKind): void {
    const text = message.trim()
    if (!text) return
    this.onServerMessage?.(text, kind)
  }

  async getOrCreateClient(conn: LspConnection): Promise<LSPClient> {
    const existing = this.clients.get(conn.id)
    if (existing) return existing
    const pending = this.pendingClients.get(conn.id)
    if (pending) return pending

    const connecting = (async () => {
      const deps = this.workspaceDeps
      const transport = await simpleWebSocketTransport(conn.transportUrl)
      const pool = this
      const client = new LSPClient({
        rootUri: conn.projectRootUri,
        extensions: jetLanguageServerExtensions(),
        sanitizeHTML: sanitizeLspHtml,
        workspace: client => {
          if (deps) return new JetLspWorkspace(client, deps)
          throw new Error("LSP workspace deps not configured")
        },
        // Prefer toast over CodeMirror's in-editor showDialog for server notices
        // (gopls "Finished loading packages.", etc.).
        notificationHandlers: {
          "window/showMessage": (_client, params: { type?: number; message?: string }) => {
            if (typeof params?.message !== "string") return true
            // Match CM default: ignore Log (type 4).
            if (params.type != null && params.type > 3) return true
            pool.emitServerMessage(params.message, messageKindFromLspType(params.type))
            return true
          },
          "$/progress": (
            _client,
            params: { value?: { kind?: string; message?: string; title?: string } },
          ) => {
            const value = params?.value
            if (!value || value.kind !== "end") return true
            const message = value.message?.trim() || value.title?.trim()
            if (message) pool.emitServerMessage(message, "info")
            return true
          },
        },
      }).connect(transport)

      await client.initializing
      this.clients.set(conn.id, client)
      return client
    })()
    this.pendingClients.set(conn.id, connecting)
    try {
      return await connecting
    } finally {
      this.pendingClients.delete(conn.id)
    }
  }

  getClient(connectionId: string): LSPClient | undefined {
    return this.clients.get(connectionId)
  }

  releaseConnection(connectionId: string): void {
    this.pendingClients.delete(connectionId)
    const client = this.clients.get(connectionId)
    if (client) {
      client.disconnect()
      this.clients.delete(connectionId)
    }
  }

  clear(): void {
    this.pendingClients.clear()
    for (const id of [...this.clients.keys()]) {
      this.releaseConnection(id)
    }
  }
}
