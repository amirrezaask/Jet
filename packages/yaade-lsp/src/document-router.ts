import { canonicalizeFileUri } from "@yaade/shared"
import type { LspConnection } from "./manager.js"
import { lspConnectionMatchesDocument } from "./connection-scope.js"

export type DocumentRouterDeps = {
  readonly open: (connection: LspConnection, uri: string) => Promise<boolean>
  readonly close: (connectionId: string, uri: string) => void
}

/** Exactly-one LSP owner per document, preferring the deepest matching project root. */
export class DocumentRouter {
  private readonly owners = new Map<string, string>()

  constructor(private readonly deps: DocumentRouterDeps) {}

  async route(
    uri: string,
    languageId: string,
    connections: readonly LspConnection[],
  ): Promise<LspConnection | null> {
    const canonical = canonicalizeFileUri(uri)
    const next = connections
      .filter(connection => lspConnectionMatchesDocument(
        canonical,
        languageId,
        connection.projectRootUri,
        connection.languageIds,
      ))
      .sort((left, right) =>
        canonicalizeFileUri(right.projectRootUri).length -
        canonicalizeFileUri(left.projectRootUri).length,
      )[0] ?? null
    const previousId = this.owners.get(canonical)
    if (previousId === next?.id) return next
    if (previousId) this.deps.close(previousId, canonical)
    this.owners.delete(canonical)
    if (!next) return null
    if (!(await this.deps.open(next, canonical))) return null
    this.owners.set(canonical, next.id)
    return next
  }

  close(uri: string): void {
    const canonical = canonicalizeFileUri(uri)
    const owner = this.owners.get(canonical)
    if (!owner) return
    this.owners.delete(canonical)
    this.deps.close(owner, canonical)
  }

  releaseConnection(connectionId: string): string[] {
    const released: string[] = []
    for (const [uri, owner] of this.owners) {
      if (owner !== connectionId) continue
      this.owners.delete(uri)
      this.deps.close(connectionId, uri)
      released.push(uri)
    }
    return released
  }

  owner(uri: string): string | null {
    return this.owners.get(canonicalizeFileUri(uri)) ?? null
  }

  clear(): void {
    for (const [uri, connectionId] of this.owners) this.deps.close(connectionId, uri)
    this.owners.clear()
  }
}
