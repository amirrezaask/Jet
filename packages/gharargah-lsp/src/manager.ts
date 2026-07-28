import type { WorkspaceFile } from "@gharargah/workspace"
import { Emitter, pathToFileUri, fileUriToPath } from "@gharargah/shared"
import { findProjectRoot, parentDir } from "./project-root.js"

export type LanguageServerDescriptor = {
  id: string
  languageIds: string[]
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
    rootMarkers: ["package.json", "tsconfig.json"],
  },
  {
    id: "rust-analyzer",
    languageIds: ["rust"],
    rootMarkers: ["Cargo.toml"],
  },
  {
    id: "gopls",
    languageIds: ["go"],
    rootMarkers: ["go.work", "go.mod"],
  },
  {
    id: "pyright",
    languageIds: ["python"],
    rootMarkers: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile", "setup.cfg"],
  },
  {
    id: "ruby-lsp",
    languageIds: ["ruby"],
    rootMarkers: ["Gemfile", ".ruby-version"],
  },
  {
    id: "vscode-json-language-server",
    languageIds: ["json", "jsonc"],
    rootMarkers: ["package.json", "tsconfig.json"],
  },
  {
    id: "vscode-html-language-server",
    languageIds: ["html"],
    rootMarkers: ["package.json", "index.html"],
  },
  {
    id: "vscode-css-language-server",
    languageIds: ["css"],
    rootMarkers: ["package.json"],
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
        serverId: string,
      ): Promise<{ transportUrl: string; id: string; error?: string }>
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

    const workspaceRootUri = workspaceRoot
    const filePath = fileUriToPath(file.uri)
    const startDir = parentDir(filePath)
    const projectRoot =
      descriptor.id === "gopls"
        ? ((await findProjectRoot(startDir, ["go.work"], window.gharargah?.fs)) ??
          (await findProjectRoot(startDir, ["go.mod"], window.gharargah?.fs)))
        : await findProjectRoot(startDir, descriptor.rootMarkers, window.gharargah?.fs)
    if (!projectRoot) return null

    const projectRootUri = pathToFileUri(projectRoot)
    const key = `${descriptor.id}:${projectRootUri}`
    const existing = this.connections.get(key)
    if (existing) return existing

    try {
      const conn = await this.lspApi.start(projectRootUri, descriptor.id)
      if (conn.error) {
        this.lastSpawnError = conn.error
        return null
      }
      const connection: LspConnection = {
        id: conn.id,
        rootUri: workspaceRootUri,
        projectRootUri,
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

  getConnection(languageId: string, projectRootUri: string): LspConnection | null {
    const descriptor = this.descriptorForLanguage(languageId)
    if (!descriptor) return null
    return this.connections.get(`${descriptor.id}:${projectRootUri}`) ?? null
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

  async stopServersForRoot(rootUri: string): Promise<string[]> {
    const toStop: LspConnection[] = []
    for (const [key, conn] of this.connections) {
      if (conn.rootUri === rootUri) {
        toStop.push(conn)
        this.connections.delete(key)
      }
    }
    await Promise.all(toStop.map(conn => this.lspApi.stop(conn.id).catch(() => {})))
    return toStop.map(conn => conn.id)
  }

  private descriptorForLanguage(languageId: string): LanguageServerDescriptor | null {
    return DESCRIPTORS.find(d => d.languageIds.includes(languageId)) ?? null
  }
}

export function getLanguageServerDescriptors(): LanguageServerDescriptor[] {
  return DESCRIPTORS
}

export function languageServerCommandFor(languageId: string): string | null {
  return DESCRIPTORS.find(d => d.languageIds.includes(languageId))?.id ?? null
}
