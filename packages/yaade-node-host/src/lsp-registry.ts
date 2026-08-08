import { accessSync, constants as fsConstants } from "node:fs"
import { delimiter, join } from "node:path"
import type { LanguageServerDefinition } from "@yaade/rpc"
import { builtinLanguageServerDefinitions } from "./lsp-config.js"

function mockServerDefinition(): LanguageServerDefinition | null {
  if (process.env.YAADE_LSP_MOCK !== "1") return null
  const mockBin = process.env.YAADE_LSP_MOCK_BIN ?? "yaade-mock-lsp"
  return {
    id: "mock-language-server",
    languages: ["mock", "plaintext"],
    commandCandidates: [mockBin],
    args: [],
    environment: {},
    candidateArgs: {},
    rootMarkers: [],
    priority: 10_000,
    enabled: true,
  }
}

function allDefinitions(): LanguageServerDefinition[] {
  const servers = [...builtinLanguageServerDefinitions()]
  const mock = mockServerDefinition()
  if (mock) servers.push(mock)
  return servers
}

let byId: ReadonlyMap<string, LanguageServerDefinition> | null = null
let byLanguage: ReadonlyMap<string, string> | null = null

function ensureIndexes(): void {
  if (byId && byLanguage) return
  const nextById = new Map<string, LanguageServerDefinition>()
  const nextByLanguage = new Map<string, string>()
  for (const def of allDefinitions()) {
    nextById.set(def.id, def)
    if (!def.enabled) continue
    for (const lang of def.languages) {
      if (!nextByLanguage.has(lang)) nextByLanguage.set(lang, def.id)
    }
  }
  byId = nextById
  byLanguage = nextByLanguage
}

export function listLanguageServerDefinitions(): LanguageServerDefinition[] {
  return allDefinitions()
}

export function getLanguageServerDefinition(serverId: string): LanguageServerDefinition | undefined {
  ensureIndexes()
  return byId?.get(serverId)
}

export function serverIdForLanguage(languageId: string): string | null {
  ensureIndexes()
  return byLanguage?.get(languageId) ?? null
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
  const overrideKey = `YAADE_LSP_${def.id.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_BIN`
  const override = process.env[overrideKey]?.trim()
  const candidates = override ? [override, ...def.commandCandidates] : def.commandCandidates
  for (const candidate of candidates) {
    const found = findExecutableOnPath(candidate)
    if (found) {
      const args = def.candidateArgs[candidate] ?? def.args
      return { command: found, args: [...args] }
    }
  }
  return {
    error: `No executable found for ${def.id}: tried ${candidates.join(", ")}`,
  }
}

/** Reset cached indexes (tests only). */
export function resetLanguageServerRegistryForTests(): void {
  byId = null
  byLanguage = null
}

export type { LanguageServerDefinition } from "@yaade/rpc"
