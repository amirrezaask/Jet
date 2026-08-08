import fs from "node:fs"
import path from "node:path"
import { Effect, Schema } from "effect"
import { LanguageServerDefinition } from "@yaade/rpc"

const DefinitionInput = Schema.Struct({
  id: Schema.String,
  languages: Schema.Array(Schema.String),
  commandCandidates: Schema.Array(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  environment: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  rootMarkers: Schema.optional(Schema.Array(Schema.String)),
  priority: Schema.optional(Schema.Number),
  initializationOptions: Schema.optional(Schema.Unknown),
  settings: Schema.optional(Schema.Unknown),
  enabled: Schema.optional(Schema.Boolean),
})

const GlobalYaadercInput = Schema.Struct({
  scanRoots: Schema.optional(Schema.Array(Schema.String)),
  languageServers: Schema.optional(Schema.Array(DefinitionInput)),
})

type DefinitionInput = Schema.Schema.Type<typeof DefinitionInput>

export type LanguageServerCatalog = {
  readonly definitions: readonly LanguageServerDefinition[]
  readonly scanRoots: readonly string[]
}

export type LanguageServerConfigResult =
  | { readonly ok: true; readonly catalog: LanguageServerCatalog }
  | { readonly ok: false; readonly error: string }

const BUILTIN_SERVERS: readonly LanguageServerDefinition[] = [
  LanguageServerDefinition.make({
    id: "typescript-language-server",
    languages: ["typescript", "javascript", "tsx", "jsx", "mts", "cts"],
    commandCandidates: ["typescript-language-server"],
    args: ["--stdio"],
    environment: {},
    candidateArgs: {},
    rootMarkers: ["package.json", "tsconfig.json"],
    priority: 0,
    enabled: true,
  }),
  LanguageServerDefinition.make({
    id: "gopls",
    languages: ["go"],
    commandCandidates: ["gopls"],
    args: ["serve"],
    environment: {},
    candidateArgs: {},
    rootMarkers: ["go.work", "go.mod"],
    priority: 0,
    enabled: true,
  }),
  LanguageServerDefinition.make({
    id: "rust-analyzer",
    languages: ["rust"],
    commandCandidates: ["rust-analyzer"],
    args: [],
    environment: {},
    candidateArgs: {},
    rootMarkers: ["Cargo.toml"],
    priority: 0,
    enabled: true,
  }),
  LanguageServerDefinition.make({
    id: "pyright",
    languages: ["python"],
    commandCandidates: ["pyright-langserver", "pyright", "basedpyright-langserver", "basedpyright"],
    args: ["--stdio"],
    environment: {},
    candidateArgs: {},
    rootMarkers: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile", "setup.cfg"],
    priority: 0,
    enabled: true,
  }),
  LanguageServerDefinition.make({
    id: "ruby-lsp",
    languages: ["ruby"],
    commandCandidates: ["ruby-lsp", "solargraph"],
    args: [],
    environment: {},
    candidateArgs: { solargraph: ["stdio"] },
    rootMarkers: ["Gemfile", ".ruby-version"],
    priority: 0,
    enabled: true,
  }),
  LanguageServerDefinition.make({
    id: "vscode-json-language-server",
    languages: ["json", "jsonc"],
    commandCandidates: ["vscode-json-language-server", "vscode-json-languageserver"],
    args: ["--stdio"],
    environment: {},
    candidateArgs: {},
    rootMarkers: ["package.json", "tsconfig.json"],
    priority: 0,
    enabled: true,
  }),
  LanguageServerDefinition.make({
    id: "vscode-html-language-server",
    languages: ["html"],
    commandCandidates: ["vscode-html-language-server"],
    args: ["--stdio"],
    environment: {},
    candidateArgs: {},
    rootMarkers: ["package.json", "index.html"],
    priority: 0,
    enabled: true,
  }),
  LanguageServerDefinition.make({
    id: "vscode-css-language-server",
    languages: ["css"],
    commandCandidates: ["vscode-css-language-server"],
    args: ["--stdio"],
    environment: {},
    candidateArgs: {},
    rootMarkers: ["package.json"],
    priority: 0,
    enabled: true,
  }),
]

export function builtinLanguageServerDefinitions(): readonly LanguageServerDefinition[] {
  return BUILTIN_SERVERS
}

function validateNonEmpty(values: readonly string[], field: string, id: string): string | null {
  if (values.length === 0) return `${id}.${field} must not be empty`
  if (values.some(value => value.trim().length === 0 || value.includes("\0"))) {
    return `${id}.${field} contains an invalid value`
  }
  return null
}

function normalizeDefinition(input: DefinitionInput): LanguageServerDefinition {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.id)) {
    throw new Error(`Invalid language server id: ${input.id}`)
  }
  const languagesError = validateNonEmpty(input.languages, "languages", input.id)
  if (languagesError) throw new Error(languagesError)
  const commandsError = validateNonEmpty(input.commandCandidates, "commandCandidates", input.id)
  if (commandsError) throw new Error(commandsError)
  const rootMarkers = input.rootMarkers ?? []
  for (const marker of rootMarkers) {
    if (
      marker.trim().length === 0 ||
      marker.includes("\0") ||
      path.isAbsolute(marker) ||
      marker.split(/[\\/]/).includes("..")
    ) {
      throw new Error(`${input.id}.rootMarkers contains an invalid relative path`)
    }
  }
  const args = input.args ?? []
  if (args.some(value => value.includes("\0"))) {
    throw new Error(`${input.id}.args contains an invalid value`)
  }
  const environment = input.environment ?? {}
  for (const [name, value] of Object.entries(environment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || value.includes("\0")) {
      throw new Error(`${input.id}.environment contains an invalid entry`)
    }
  }
  const priority = input.priority ?? 0
  if (!Number.isSafeInteger(priority)) {
    throw new Error(`${input.id}.priority must be an integer`)
  }
  return LanguageServerDefinition.make({
    id: input.id,
    languages: [...new Set(input.languages)],
    commandCandidates: [...input.commandCandidates],
    args: [...args],
    environment: { ...environment },
    candidateArgs: {},
    rootMarkers: [...rootMarkers],
    priority,
    initializationOptions: input.initializationOptions,
    settings: input.settings,
    enabled: input.enabled ?? true,
  })
}

function withMockDefinition(
  definitions: readonly LanguageServerDefinition[],
  environment: NodeJS.ProcessEnv,
): readonly LanguageServerDefinition[] {
  if (environment.YAADE_LSP_MOCK !== "1") return definitions
  return [
    ...definitions,
    LanguageServerDefinition.make({
      id: "mock-language-server",
      languages: ["mock", "plaintext"],
      commandCandidates: [environment.YAADE_LSP_MOCK_BIN ?? "yaade-mock-lsp"],
      args: [],
      environment: {},
      candidateArgs: {},
      rootMarkers: [],
      priority: 10_000,
      enabled: true,
    }),
  ]
}

export function parseLanguageServerConfig(
  text: string,
  environment: NodeJS.ProcessEnv = process.env,
): LanguageServerConfigResult {
  try {
    const json: unknown = JSON.parse(text)
    const decoded = Effect.runSync(Schema.decodeUnknown(GlobalYaadercInput)(json))
    const definitionsById = new Map(
      BUILTIN_SERVERS.map(definition => [definition.id, definition]),
    )
    for (const input of decoded.languageServers ?? []) {
      const definition = normalizeDefinition(input)
      definitionsById.set(definition.id, definition)
    }
    const definitions = withMockDefinition(
      [...definitionsById.values()].sort(
        (left, right) => right.priority - left.priority || left.id.localeCompare(right.id),
      ),
      environment,
    )
    return {
      ok: true,
      catalog: {
        definitions,
        scanRoots: decoded.scanRoots ?? [],
      },
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function loadLanguageServerConfig(
  homeDir: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<LanguageServerConfigResult> {
  const configPath = path.join(homeDir, ".yaade", "yaaderc.json")
  let text: string
  try {
    text = await fs.promises.readFile(configPath, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        ok: true,
        catalog: {
          definitions: withMockDefinition(BUILTIN_SERVERS, environment),
          scanRoots: [],
        },
      }
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  return parseLanguageServerConfig(text, environment)
}

/** Never include configured environment values in process diagnostics or output. */
export function redactConfiguredEnvironment(
  message: string,
  environment: Readonly<Record<string, string>>,
): string {
  const secrets = [...new Set(Object.values(environment).filter(value => value.length > 0))]
    .sort((left, right) => right.length - left.length)
  let redacted = message
  for (const secret of secrets) redacted = redacted.split(secret).join("[redacted]")
  return redacted
}

export type LanguageServerConfigWatcher = { readonly close: () => void }

export function watchLanguageServerConfig(
  homeDir: string,
  onChange: () => void,
): LanguageServerConfigWatcher {
  const configDir = path.join(homeDir, ".yaade")
  try {
    fs.mkdirSync(configDir, { recursive: true })
    let debounce: NodeJS.Timeout | null = null
    const watcher = fs.watch(configDir, (_event, filename) => {
      if (filename?.toString() !== "yaaderc.json") return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        debounce = null
        onChange()
      }, 75)
    })
    return {
      close: () => {
        if (debounce) clearTimeout(debounce)
        watcher.close()
      },
    }
  } catch {
    return { close: () => {} }
  }
}
