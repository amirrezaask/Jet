/**
 * Provider model discovery — ports rust `refresh_*_models` + t3 probe paths.
 * Catalog TTL = 60s (rust PROVIDER_MODELS_TTL).
 */
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { accessSync, constants as fsConstants } from "node:fs"
import { delimiter, join } from "node:path"
import type { ProviderModel, AgentSessionConfigOption } from "@gharargah/agents"

const MODELS_TTL_MS = 60_000
const DISCOVER_TIMEOUT_MS = 12_000

type CacheEntry = { fetchedAt: number; models: ProviderModel[] }

const cache = new Map<string, CacheEntry>()

const AUTO: ProviderModel = { slug: "auto", name: "Auto", shortName: "Auto" }

function useMock(): boolean {
  return process.env.GHARARGAH_AGENT_MOCK === "1"
}

function cacheGet(agentId: string): ProviderModel[] | null {
  const hit = cache.get(agentId)
  if (!hit) return null
  if (Date.now() - hit.fetchedAt > MODELS_TTL_MS) return null
  if (hit.models.length === 0) return null
  return hit.models
}

function cacheSet(agentId: string, models: ProviderModel[]): void {
  cache.set(agentId, { fetchedAt: Date.now(), models })
}

/** Test / forced-refresh helper. */
export function clearModelDiscoveryCache(agentId?: string): void {
  if (agentId) cache.delete(agentId)
  else cache.clear()
}

export function whichBinary(name: string): boolean {
  if (name.includes("/") || name.includes("\\")) {
    try {
      accessSync(name, fsConstants.X_OK)
      return true
    } catch {
      return false
    }
  }
  const pathEnv = process.env.PATH ?? ""
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    try {
      accessSync(join(dir, name), fsConstants.X_OK)
      return true
    } catch {
      /* try next */
    }
  }
  return false
}

function claudeEffortOption(): AgentSessionConfigOption {
  return {
    id: "effort",
    name: "Reasoning",
    description: "How much reasoning Claude uses for this response.",
    category: "reasoning",
    currentValue: "high",
    values: [
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
      { value: "xhigh", name: "Extra high" },
      { value: "max", name: "Max" },
    ],
  }
}

function mockModels(agentId: string): ProviderModel[] {
  switch (agentId) {
    case "codex":
      return [
        AUTO,
        {
          slug: "mock-codex",
          name: "Mock Codex",
          shortName: "Mock Codex",
          configOptions: [
            {
              id: "reasoning_effort",
              name: "Reasoning",
              category: "reasoning",
              currentValue: "high",
              values: [
                { value: "low", name: "Low" },
                { value: "high", name: "High" },
              ],
            },
          ],
        },
      ]
    case "claude":
      return [
        AUTO,
        {
          slug: "sonnet",
          name: "Claude Sonnet",
          shortName: "Sonnet",
          configOptions: [claudeEffortOption()],
        },
      ]
    case "cursor":
      return [
        AUTO,
        { slug: "mock-composer", name: "Mock Composer", shortName: "Composer" },
      ]
    case "opencode":
      return [
        AUTO,
        { slug: "mock/opencode", name: "Mock OpenCode", shortName: "OpenCode" },
      ]
    default:
      return [AUTO]
  }
}

function claudeBuiltinModels(): ProviderModel[] {
  const effort = claudeEffortOption()
  return [
    { ...AUTO, configOptions: [effort] },
    { slug: "sonnet", name: "Claude Sonnet", shortName: "Sonnet", configOptions: [effort] },
    { slug: "opus", name: "Claude Opus", shortName: "Opus", configOptions: [effort] },
    { slug: "haiku", name: "Claude Haiku", shortName: "Haiku", configOptions: [effort] },
  ]
}

function shortNameFrom(name: string, slug: string): string {
  const words = name.split(/\s+/).filter(Boolean).slice(0, 3)
  if (words.length > 0) return words.join(" ")
  return slug.split("/").pop() ?? slug
}

/** Parse `cursor-agent models` / `agent models` stdout (rust `parse_cursor_models_output`). */
export function parseCursorModelsOutput(stdout: string): ProviderModel[] {
  const models: ProviderModel[] = []
  for (const raw of stdout.split("\n")) {
    const line = raw.trim()
    if (!line || line.toLowerCase() === "available models") continue
    const sep = line.indexOf(" - ")
    if (sep < 0) continue
    const slug = line.slice(0, sep).trim()
    if (!slug || /\s/.test(slug)) continue
    let name = line.slice(sep + 3).trim()
    name = name.replace(/\(default\)\s*$/i, "").trim()
    if (!name) continue
    models.push({
      slug,
      name,
      shortName: shortNameFrom(name, slug),
    })
  }
  return models
}

/** Parse `opencode models` stdout (one slug per line). */
export function parseOpenCodeModelsOutput(stdout: string): ProviderModel[] {
  const slugs: string[] = []
  for (const raw of stdout.split("\n")) {
    const slug = raw.trim()
    if (!slug || slug === "auto" || /\s/.test(slug)) continue
    if (slugs.includes(slug)) continue
    slugs.push(slug)
  }
  return slugs.map(slug => {
    const short = slug.split("/").pop() ?? slug
    return { slug, name: short, shortName: short }
  })
}

/** Normalize Codex `model/list` item → ProviderModel. */
export function parseCodexModelItem(item: Record<string, unknown>): ProviderModel | null {
  if (item.hidden === true) return null
  const slug = String(item.model ?? item.id ?? "").trim()
  if (!slug) return null
  const name = String(item.displayName ?? item.name ?? slug).trim() || slug
  const configOptions: AgentSessionConfigOption[] = []
  const efforts = item.supportedReasoningEfforts
  if (Array.isArray(efforts) && efforts.length > 0) {
    const values = efforts
      .map(effort => {
        if (!effort || typeof effort !== "object") return null
        const value = String(
          (effort as { reasoningEffort?: string; value?: string }).reasoningEffort ??
            (effort as { value?: string }).value ??
            "",
        ).trim()
        if (!value) return null
        const label = value
          .split(/[-_]/)
          .map(part => (part ? part[0]!.toUpperCase() + part.slice(1) : ""))
          .join(" ")
        return { value, name: label || value }
      })
      .filter((v): v is { value: string; name: string } => v !== null)
    if (values.length > 0) {
      configOptions.push({
        id: "reasoning_effort",
        name: "Reasoning",
        category: "reasoning",
        currentValue: values.find(v => v.value === "high")?.value ?? values[0]!.value,
        values,
      })
    }
  }
  return {
    slug,
    name,
    shortName: shortNameFrom(name, slug),
    ...(configOptions.length > 0 ? { configOptions } : {}),
  }
}

function runCli(
  command: string,
  args: string[],
  timeoutMs = DISCOVER_TIMEOUT_MS,
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      resolve({ ok: false, stdout })
    }, timeoutMs)
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (c: string) => {
      stdout += c
    })
    child.stderr.on("data", (c: string) => {
      stderr += c
    })
    child.on("error", () => {
      clearTimeout(timer)
      resolve({ ok: false, stdout })
    })
    child.on("close", code => {
      clearTimeout(timer)
      resolve({ ok: code === 0, stdout: stdout || stderr })
    })
  })
}

async function fetchCursorModelsFromCli(): Promise<ProviderModel[] | null> {
  const binaries = ["cursor-agent", "agent", "cursor"]
  for (const bin of binaries) {
    if (!whichBinary(bin)) continue
    const { ok, stdout } = await runCli(bin, ["models"])
    if (!ok) continue
    const models = parseCursorModelsOutput(stdout)
    if (models.length > 0) return models
  }
  return null
}

async function fetchOpenCodeModelsFromCli(): Promise<ProviderModel[] | null> {
  if (!whichBinary("opencode")) return null
  const { ok, stdout } = await runCli("opencode", ["models"])
  if (!ok) return null
  const models = parseOpenCodeModelsOutput(stdout)
  return models.length > 0 ? models : null
}

async function fetchCodexModelsFromAppServer(): Promise<ProviderModel[] | null> {
  const mockBin = process.env.GHARARGAH_MOCK_CODEX_APP_SERVER_BIN
  const command = mockBin ?? "codex"
  const args = mockBin ? [] : ["app-server"]
  if (!mockBin && !whichBinary("codex")) return null

  return await new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    })
    let nextId = 1
    const pending = new Map<
      number,
      { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >()
    let settled = false
    const finish = (models: ProviderModel[] | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill("SIGTERM")
      setTimeout(() => child.kill("SIGKILL"), 1_500)
      resolve(models)
    }
    const timer = setTimeout(() => finish(null), DISCOVER_TIMEOUT_MS)

    const send = (method: string, params: unknown) =>
      new Promise((res, rej) => {
        const id = nextId++
        pending.set(id, { resolve: res, reject: rej })
        try {
          child.stdin.write(JSON.stringify({ id, method, params }) + "\n")
        } catch (err) {
          pending.delete(id)
          rej(err instanceof Error ? err : new Error(String(err)))
        }
      })

    const rl = createInterface({ input: child.stdout })
    rl.on("line", line => {
      try {
        const msg = JSON.parse(line) as {
          id?: number
          result?: unknown
          error?: unknown
        }
        if (msg.id !== undefined && pending.has(msg.id)) {
          const p = pending.get(msg.id)!
          pending.delete(msg.id)
          if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
          else p.resolve(msg.result)
        }
      } catch {
        /* ignore */
      }
    })
    child.on("error", () => finish(null))
    child.on("close", () => {
      if (!settled) finish(null)
    })

    void (async () => {
      try {
        await send("initialize", {
          clientInfo: { name: "gharargah", title: "Gharargah", version: "0.0.1" },
          capabilities: { experimentalApi: true },
        })
        child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n")
        const models: ProviderModel[] = []
        let cursor: string | null | undefined
        do {
          const result = (await send(
            "model/list",
            cursor ? { cursor } : {},
          )) as {
            data?: unknown[]
            items?: unknown[]
            models?: unknown[]
            nextCursor?: string | null
          }
          const rows = result?.data ?? result?.items ?? result?.models ?? []
          for (const row of rows) {
            if (!row || typeof row !== "object") continue
            const parsed = parseCodexModelItem(row as Record<string, unknown>)
            if (!parsed) continue
            if (models.some(m => m.slug === parsed.slug)) continue
            models.push(parsed)
          }
          cursor = result?.nextCursor ?? null
        } while (cursor)
        finish(models.length > 0 ? models : null)
      } catch {
        finish(null)
      }
    })()
  })
}

/** Parse Cursor ACP `cursor/list_available_models` response. */
export function parseCursorListAvailableModels(result: unknown): ProviderModel[] {
  if (!result || typeof result !== "object") return []
  const models = (result as { models?: unknown }).models
  if (!Array.isArray(models)) return []
  const out: ProviderModel[] = []
  for (const row of models) {
    if (!row || typeof row !== "object") continue
    const r = row as {
      value?: string
      slug?: string
      name?: string
      configOptions?: AgentSessionConfigOption[]
    }
    const slug = String(r.value ?? r.slug ?? "").trim()
    if (!slug) continue
    const name = String(r.name ?? slug).trim() || slug
    out.push({
      slug,
      name,
      shortName: shortNameFrom(name, slug),
      ...(r.configOptions ? { configOptions: r.configOptions } : {}),
    })
  }
  return out
}

/** Parse ACP SessionModelState → ProviderModel[]. */
export function parseSessionModelState(models: unknown): ProviderModel[] {
  if (!models || typeof models !== "object") return []
  const available = (models as { availableModels?: unknown }).availableModels
  if (!Array.isArray(available)) return []
  const out: ProviderModel[] = []
  for (const row of available) {
    if (!row || typeof row !== "object") continue
    const r = row as { modelId?: string; id?: string; name?: string; description?: string }
    const slug = String(r.modelId ?? r.id ?? "").trim()
    if (!slug) continue
    const name = String(r.name ?? slug).trim() || slug
    out.push({ slug, name, shortName: shortNameFrom(name, slug) })
  }
  return out
}

function withAutoFirst(models: ProviderModel[]): ProviderModel[] {
  if (models.some(m => m.slug === "auto")) return models
  return [AUTO, ...models]
}

async function discoverAgentModels(agentId: string, force: boolean): Promise<ProviderModel[]> {
  if (!force) {
    const cached = cacheGet(agentId)
    if (cached) return cached
  }

  if (useMock()) {
    const models = mockModels(agentId)
    cacheSet(agentId, models)
    return models
  }

  let models: ProviderModel[] = [AUTO]
  switch (agentId) {
    case "codex": {
      const discovered = await fetchCodexModelsFromAppServer()
      models = discovered ? withAutoFirst(discovered) : [AUTO]
      break
    }
    case "cursor": {
      const discovered = await fetchCursorModelsFromCli()
      models = discovered ? withAutoFirst(discovered) : [AUTO]
      break
    }
    case "opencode": {
      const discovered = await fetchOpenCodeModelsFromCli()
      models = discovered ? withAutoFirst(discovered) : [AUTO]
      break
    }
    case "claude":
      models = claudeBuiltinModels()
      break
    case "grok":
      models = [AUTO]
      break
    default:
      models = [AUTO]
  }

  cacheSet(agentId, models)
  return models
}

/** Sync read of last known models (or static fallback). Does not spawn. */
export function listCachedModels(agentId: string): ProviderModel[] {
  if (useMock()) return mockModels(agentId)
  const cached = cacheGet(agentId)
  if (cached) return cached
  switch (agentId) {
    case "claude":
      return claudeBuiltinModels()
    case "codex":
    case "cursor":
    case "opencode":
      return [AUTO]
    default:
      return [AUTO]
  }
}

/** Refresh one or all agents. `providerId` may be agent id or instance id. */
export async function refreshProviderModels(providerId?: string): Promise<void> {
  const id = providerId?.trim()
  const targets = id
    ? [normalizeProviderId(id)]
    : (["codex", "claude", "opencode", "cursor", "grok"] as const)

  await Promise.all(targets.map(agentId => discoverAgentModels(agentId, true)))
}

function normalizeProviderId(id: string): string {
  const lower = id.toLowerCase()
  if (lower.startsWith("claude:")) return "claude"
  if (lower === "cursor-acp") return "cursor"
  return lower.split(":")[0] ?? lower
}

export function agentBinaryReady(agentId: string): boolean {
  if (useMock()) return true
  switch (agentId) {
    case "codex":
      return whichBinary("codex")
    case "claude":
      return whichBinary("claude")
    case "opencode":
      return whichBinary("opencode")
    case "cursor":
      return whichBinary("cursor-agent") || whichBinary("agent") || whichBinary("cursor")
    case "grok":
      return whichBinary("grok")
    default:
      return false
  }
}
