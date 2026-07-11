import { LSPClient } from "@codemirror/lsp-client"
import { simpleWebSocketTransport } from "@jet/codemirror"
import type { LspConnection } from "./manager.js"
import { JetLspWorkspace, type JetLspWorkspaceDeps } from "./jet-workspace.js"
import { jetLanguageServerExtensions } from "./lsp-extensions.js"

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

export class LspClientPool {
  private clients = new Map<string, LSPClient>()
  private pendingClients = new Map<string, Promise<LSPClient>>()
  private workspaceDeps: JetLspWorkspaceDeps | null = null

  setWorkspaceDeps(deps: JetLspWorkspaceDeps): void {
    this.workspaceDeps = deps
  }

  async getOrCreateClient(conn: LspConnection): Promise<LSPClient> {
    const existing = this.clients.get(conn.id)
    if (existing) return existing
    const pending = this.pendingClients.get(conn.id)
    if (pending) return pending

    const connecting = (async () => {
      const deps = this.workspaceDeps
      const transport = await simpleWebSocketTransport(conn.transportUrl)
      const client = new LSPClient({
        rootUri: conn.projectRootUri,
        extensions: jetLanguageServerExtensions(),
        sanitizeHTML: sanitizeLspHtml,
        workspace: client => {
          if (deps) return new JetLspWorkspace(client, deps)
          throw new Error("LSP workspace deps not configured")
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
