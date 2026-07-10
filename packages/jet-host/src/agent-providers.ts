import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { AgentProvidersState, ProviderModel, ProviderSnapshot } from "@jet/agents"

const execFileAsync = promisify(execFile)

/** Instance ids with a working driver in agent-drivers/index.ts */
const SUPPORTED_DRIVER_INSTANCE_IDS = new Set(["cursor", "claudeAgent", "codex"])

const BUILT_IN_DRIVERS: ReadonlyArray<{
  instanceId: string
  driverKind: string
  displayName: string
  binaryNames: string[]
  stubModels: ReadonlyArray<{ slug: string; name: string; shortName?: string }>
}> = [
  {
    instanceId: "cursor",
    driverKind: "cursor",
    displayName: "Cursor",
    binaryNames: ["cursor-agent", "agent"],
    stubModels: [{ slug: "auto", name: "Auto", shortName: "Auto" }],
  },
  {
    instanceId: "claudeAgent",
    driverKind: "claudeAgent",
    displayName: "Claude",
    binaryNames: ["claude"],
    stubModels: [
      { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", shortName: "Sonnet 4.6" },
      { slug: "claude-opus-4-7", name: "Claude Opus 4.7", shortName: "Opus 4.7" },
    ],
  },
  {
    instanceId: "codex",
    driverKind: "codex",
    displayName: "Codex",
    binaryNames: ["codex"],
    stubModels: [
      { slug: "gpt-5", name: "GPT-5", shortName: "5" },
      { slug: "gpt-5-mini", name: "GPT-5 Mini", shortName: "5 Mini" },
    ],
  },
  {
    instanceId: "grok",
    driverKind: "grok",
    displayName: "Grok",
    binaryNames: ["grok"],
    stubModels: [{ slug: "grok-3", name: "Grok 3", shortName: "3" }],
  },
  {
    instanceId: "opencode",
    driverKind: "opencode",
    displayName: "OpenCode",
    binaryNames: ["opencode"],
    stubModels: [{ slug: "default", name: "Default", shortName: "Default" }],
  },
]

const driverByInstanceId = new Map(BUILT_IN_DRIVERS.map(entry => [entry.instanceId, entry]))

let cachedState: AgentProvidersState | null = null

async function binaryOnPath(name: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === "win32" ? "where" : "which", [name], {
      timeout: 2_000,
    })
    return true
  } catch {
    return false
  }
}

async function resolveInstalledBinary(binaryNames: string[]): Promise<string | null> {
  for (const binary of binaryNames) {
    if (await binaryOnPath(binary)) return binary
  }
  return null
}

function parseCursorModelsOutput(stdout: string): ProviderModel[] {
  const models: ProviderModel[] = []
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("Available models")) continue
    const dash = trimmed.indexOf(" - ")
    if (dash < 0) continue
    const slug = trimmed.slice(0, dash).trim()
    const name = trimmed.slice(dash + 3).trim()
    if (!slug) continue
    const shortName = name.includes("(") ? name.split("(")[0]?.trim() : name.split(" ").slice(-2).join(" ")
    models.push({ slug, name, shortName: shortName || slug })
  }
  return models
}

async function listModelsForDriver(entry: (typeof BUILT_IN_DRIVERS)[number]): Promise<ProviderModel[]> {
  const binary = await resolveInstalledBinary(entry.binaryNames)
  if (!binary) return []

  if (entry.driverKind === "cursor") {
    try {
      const { stdout } = await execFileAsync(binary, ["models"], { timeout: 8_000 })
      const models = parseCursorModelsOutput(stdout)
      if (models.length > 0) return models
    } catch {
      /* fall through to stubs */
    }
  }

  return [...entry.stubModels]
}

async function probeDriver(entry: (typeof BUILT_IN_DRIVERS)[number]): Promise<ProviderSnapshot> {
  if (!SUPPORTED_DRIVER_INSTANCE_IDS.has(entry.instanceId)) {
    return {
      instanceId: entry.instanceId,
      driverKind: entry.driverKind,
      displayName: entry.displayName,
      enabled: false,
      status: "unavailable",
      message: "Driver not implemented",
      models: [],
    }
  }

  const binary = await resolveInstalledBinary(entry.binaryNames)
  const installed = binary != null
  const models = installed ? await listModelsForDriver(entry) : []
  return {
    instanceId: entry.instanceId,
    driverKind: entry.driverKind,
    displayName: entry.displayName,
    enabled: installed,
    status: installed ? "ready" : "unavailable",
    message: installed ? null : `${entry.displayName} CLI not found on PATH`,
    models: installed ? models : [],
  }
}

export async function isProviderBinaryAvailable(provider: string): Promise<boolean> {
  const entry = driverByInstanceId.get(provider)
  if (!entry) return false
  return (await resolveInstalledBinary(entry.binaryNames)) != null
}

export async function listProviders(): Promise<AgentProvidersState> {
  if (cachedState) return cachedState
  return refreshProviders()
}

export async function refreshProviders(): Promise<AgentProvidersState> {
  const providers = (
    await Promise.all(BUILT_IN_DRIVERS.map(probeDriver))
  ).filter(snapshot => SUPPORTED_DRIVER_INSTANCE_IDS.has(snapshot.instanceId))
  cachedState = {
    providers,
    updatedAt: new Date().toISOString(),
  }
  return cachedState
}
