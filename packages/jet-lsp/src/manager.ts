import type { WorkspaceFile } from "@jet/workspace"
import { Emitter, pathToFileUri, fileUriToPath } from "@jet/shared"

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
  projectRootUri: string
  languageIds: string[]
  transportUrl: string
  descriptorId: string
}

const DESCRIPTORS: LanguageServerDescriptor[] = [
  {
    id: "typescript-language-server",
    languageIds: ["typescript", "javascript", "tsx", "jsx", "mts", "cts"],
    command: "typescript-language-server",
    args: ["--stdio"],
    rootMarkers: ["package.json", "tsconfig.json"],
  },
  {
    id: "rust-analyzer",
    languageIds: ["rust"],
    command: "rust-analyzer",
    args: [],
    rootMarkers: ["Cargo.toml"],
  },
]

export class LanguageServerManager {
  private connections = new Map<string, LspConnection>()
  private lastSpawnError: string | null = null
  readonly onDiagnostics = new Emitter<unknown>()

  constructor(
    private lspApi: {
      start(
        rootUri: string,
        languageId: string,
        command?: string,
        args?: string[],
      ): Promise<{ transportUrl: string; id: string }>
      stop(id: string): Promise<void>
      onCrashed?(cb: (id: string) => void): () => void
    },
  ) {
    lspApi.onCrashed?.(id => {
      for (const [key, conn] of this.connections) {
        if (conn.id === id) {
          this.connections.delete(key)
          break
        }
      }
    })
  }

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

    try {
      const conn = await this.lspApi.start(
        pathToFileUri(projectRoot),
        file.languageId,
        descriptor.command,
        descriptor.args,
      )
      const connection: LspConnection = {
        id: conn.id,
        rootUri,
        projectRootUri: pathToFileUri(projectRoot),
        languageIds: descriptor.languageIds,
        transportUrl: conn.transportUrl,
        descriptorId: descriptor.id,
      }
      this.connections.set(key, connection)
      this.lastSpawnError = null
      return connection
    } catch (err) {
      this.lastSpawnError =
        err instanceof Error ? err.message : "Language server failed to start"
      return null
    }
  }

  isLanguageSupported(languageId: string): boolean {
    return this.descriptorForLanguage(languageId) != null
  }

  consumeLastSpawnError(): string | null {
    const err = this.lastSpawnError
    this.lastSpawnError = null
    return err
  }

  getConnection(languageId: string, rootUri: string): LspConnection | null {
    const descriptor = this.descriptorForLanguage(languageId)
    if (!descriptor) return null
    return this.connections.get(`${descriptor.id}:${rootUri}`) ?? null
  }

  hasAnyConnection(): boolean {
    return this.connections.size > 0
  }

  clearConnection(id: string): void {
    for (const [key, conn] of this.connections) {
      if (conn.id === id) {
        this.connections.delete(key)
        return
      }
    }
  }

  async stopServersForRoot(rootUri: string): Promise<void> {
    const toStop: LspConnection[] = []
    for (const [key, conn] of this.connections) {
      if (conn.rootUri === rootUri) {
        toStop.push(conn)
        this.connections.delete(key)
      }
    }
    await Promise.all(toStop.map(conn => this.lspApi.stop(conn.id).catch(() => {})))
  }

  private descriptorForLanguage(languageId: string): LanguageServerDescriptor | null {
    return DESCRIPTORS.find(d => d.languageIds.includes(languageId)) ?? null
  }
}

async function findProjectRoot(startPath: string, markers: string[]): Promise<string | null> {
  const fs = window.jet?.fs
  if (!fs) return startPath

  let current = startPath
  for (let i = 0; i < 20; i++) {
    for (const marker of markers) {
      try {
        const uri = pathToFileUri(`${current}/${marker}`)
        await fs.stat(uri)
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

export function getLanguageServerDescriptors(): LanguageServerDescriptor[] {
  return DESCRIPTORS
}
