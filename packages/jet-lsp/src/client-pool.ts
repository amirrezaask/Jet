import { LSPClient, languageServerExtensions } from "@codemirror/lsp-client"
import { simpleWebSocketTransport } from "@jet/codemirror"
import type { LspConnection } from "./manager.js"

export class LspClientPool {
  private clients = new Map<string, LSPClient>()

  async getOrCreateClient(conn: LspConnection): Promise<LSPClient> {
    const existing = this.clients.get(conn.id)
    if (existing) return existing

    const transport = await simpleWebSocketTransport(conn.transportUrl)
    const client = new LSPClient({
      rootUri: conn.projectRootUri,
      extensions: languageServerExtensions(),
    }).connect(transport)

    await client.initializing
    this.clients.set(conn.id, client)
    return client
  }

  getClient(connectionId: string): LSPClient | undefined {
    return this.clients.get(connectionId)
  }

  releaseConnection(connectionId: string): void {
    const client = this.clients.get(connectionId)
    if (client) {
      client.disconnect()
      this.clients.delete(connectionId)
    }
  }

  clear(): void {
    for (const id of [...this.clients.keys()]) {
      this.releaseConnection(id)
    }
  }
}
