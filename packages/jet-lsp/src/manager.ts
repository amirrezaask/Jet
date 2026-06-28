import type { WorkspaceFile } from "@jet/workspace"
import { Emitter } from "@jet/shared"
import { fileUriToPath } from "@jet/shared"

export type LanguageServerDescriptor = {
  id: string
  languageIds: string[]
  command: string
  args?: string[]
  rootMarkers: string[]
}

export type LspConnection = {
  id: string
  rootUri: string
  languageIds: string[]
  transportUrl: string
}

const TS_DESCRIPTOR: LanguageServerDescriptor = {
  id: "typescript-language-server",
  languageIds: ["typescript", "javascript"],
  command: "typescript-language-server",
  args: ["--stdio"],
  rootMarkers: ["package.json", "tsconfig.json"],
}

export class LanguageServerManager {
  private connections = new Map<string, LspConnection>()
  readonly onDiagnostics = new Emitter<unknown>()

  constructor(
    private lspApi: {
      start(rootUri: string, languageId: string): Promise<{ transportUrl: string; id: string }>
      stop(id: string): Promise<void>
    },
  ) {}

  async ensureServerForFile(file: WorkspaceFile, workspaceRoot: string): Promise<LspConnection | null> {
    const descriptor = this.descriptorForLanguage(file.languageId)
    if (!descriptor) return null

    const rootUri = workspaceRoot
    const key = `${descriptor.id}:${rootUri}`
    const existing = this.connections.get(key)
    if (existing) return existing

    const rootPath = fileUriToPath(rootUri)
    const projectRoot = await findProjectRoot(rootPath, descriptor.rootMarkers)
    if (!projectRoot) return null

    const conn = await this.lspApi.start(rootUri, file.languageId)
    const connection: LspConnection = {
      id: conn.id,
      rootUri,
      languageIds: descriptor.languageIds,
      transportUrl: conn.transportUrl,
    }
    this.connections.set(key, connection)
    return connection
  }

  getConnection(languageId: string, rootUri: string): LspConnection | null {
    const descriptor = this.descriptorForLanguage(languageId)
    if (!descriptor) return null
    return this.connections.get(`${descriptor.id}:${rootUri}`) ?? null
  }

  private descriptorForLanguage(languageId: string): LanguageServerDescriptor | null {
    if (TS_DESCRIPTOR.languageIds.includes(languageId)) return TS_DESCRIPTOR
    return null
  }
}

async function findProjectRoot(startPath: string, markers: string[]): Promise<string | null> {
  const fs = window.jet?.fs
  if (!fs) return startPath

  let current = startPath
  for (let i = 0; i < 20; i++) {
    for (const marker of markers) {
      try {
        const uri = `file://${current}/${marker}`.replace(/file:\/\/\//, "file:///")
        await fs.stat(uri.startsWith("file:") ? uri : `file://${current}/${marker}`)
        return current
      } catch {
        /* continue */
      }
    }
    const parent = current.replace(/[/\\][^/\\]+$/, "")
    if (parent === current) break
    current = parent
  }
  return startPath
}
