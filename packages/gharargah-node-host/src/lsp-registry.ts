import { accessSync, constants as fsConstants } from "node:fs"
import { delimiter, join } from "node:path"

export type LanguageServerDefinition = {
  id: string
  languages: string[]
  commandCandidates: string[]
  args: string[]
  rootMarkers: string[]
}

const PRODUCTION_SERVERS: LanguageServerDefinition[] = [
  {
    id: "typescript-language-server",
    languages: ["typescript", "javascript", "tsx", "jsx", "mts", "cts"],
    commandCandidates: ["typescript-language-server"],
    args: ["--stdio"],
    rootMarkers: ["package.json", "tsconfig.json"],
  },
  {
    id: "gopls",
    languages: ["go"],
    commandCandidates: ["gopls"],
    args: ["serve"],
    rootMarkers: ["go.work", "go.mod"],
  },
  {
    id: "rust-analyzer",
    languages: ["rust"],
    commandCandidates: ["rust-analyzer"],
    args: [],
    rootMarkers: ["Cargo.toml"],
  },
  {
    id: "pyright",
    languages: ["python"],
    commandCandidates: ["pyright-langserver", "pyright", "basedpyright-langserver", "basedpyright"],
    args: ["--stdio"],
    rootMarkers: ["pyproject.toml", "requirements.txt"],
  },
  {
    id: "vscode-json-language-server",
    languages: ["json", "jsonc"],
    commandCandidates: ["vscode-json-language-server", "vscode-json-languageserver"],
    args: ["--stdio"],
    rootMarkers: ["package.json", "tsconfig.json"],
  },
  {
    id: "vscode-html-language-server",
    languages: ["html"],
    commandCandidates: ["vscode-html-language-server"],
    args: ["--stdio"],
    rootMarkers: ["package.json", "index.html"],
  },
  {
    id: "vscode-css-language-server",
    languages: ["css"],
    commandCandidates: ["vscode-css-language-server"],
    args: ["--stdio"],
    rootMarkers: ["package.json"],
  },
]

function mockServerDefinition(): LanguageServerDefinition | null {
  if (process.env.GHARARGAH_LSP_MOCK !== "1") return null
  const mockBin = process.env.GHARARGAH_LSP_MOCK_BIN ?? "gharargah-mock-lsp"
  return {
    id: "mock-language-server",
    languages: ["mock", "plaintext"],
    commandCandidates: [mockBin],
    args: [],
    rootMarkers: [],
  }
}

function allDefinitions(): LanguageServerDefinition[] {
  const servers = [...PRODUCTION_SERVERS]
  const mock = mockServerDefinition()
  if (mock) servers.push(mock)
  return servers
}

const byId = new Map<string, LanguageServerDefinition>()
const byLanguage = new Map<string, string>()

function ensureIndexes(): void {
  if (byId.size > 0) return
  for (const def of allDefinitions()) {
    byId.set(def.id, def)
    for (const lang of def.languages) {
      if (!byLanguage.has(lang)) byLanguage.set(lang, def.id)
    }
  }
}

export function listLanguageServerDefinitions(): LanguageServerDefinition[] {
  return allDefinitions()
}

export function getLanguageServerDefinition(serverId: string): LanguageServerDefinition | undefined {
  ensureIndexes()
  return byId.get(serverId)
}

export function serverIdForLanguage(languageId: string): string | null {
  ensureIndexes()
  return byLanguage.get(languageId) ?? null
}

export function findExecutableOnPath(name: string): string | null {
  if (name.includes("/") || name.includes("\\")) {
    try {
      accessSync(name, fsConstants.X_OK)
      return name
    } catch {
      return null
    }
  }
  const pathEnv = process.env.PATH ?? ""
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    const full = join(dir, name)
    try {
      accessSync(full, fsConstants.X_OK)
      return full
    } catch {
      /* try next */
    }
  }
  return null
}

export function resolveLanguageServerCommand(
  def: LanguageServerDefinition,
): { command: string; args: string[] } | { error: string } {
  for (const candidate of def.commandCandidates) {
    const found = findExecutableOnPath(candidate)
    if (found) return { command: found, args: [...def.args] }
  }
  return {
    error: `No executable found for ${def.id}: tried ${def.commandCandidates.join(", ")}`,
  }
}

/** Reset cached indexes (tests only). */
export function resetLanguageServerRegistryForTests(): void {
  byId.clear()
  byLanguage.clear()
}
