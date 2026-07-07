import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { AgentProvidersState, ProviderSnapshot } from "@jet/agents"

const execFileAsync = promisify(execFile)

const BUILT_IN_DRIVERS: ReadonlyArray<{
  instanceId: string
  driverKind: string
  displayName: string
  binaryNames: string[]
  stubModels: ReadonlyArray<{ slug: string; name: string; shortName?: string }>
}> = [
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
    instanceId: "claudeAgent",
    driverKind: "claudeAgent",
    displayName: "Claude",
    binaryNames: ["claude"],
    stubModels: [
      { slug: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", shortName: "Sonnet 4" },
      { slug: "claude-opus-4-20250514", name: "Claude Opus 4", shortName: "Opus 4" },
    ],
  },
  {
    instanceId: "cursor",
    driverKind: "cursor",
    displayName: "Cursor",
    binaryNames: ["cursor-agent", "cursor"],
    stubModels: [{ slug: "auto", name: "Auto", shortName: "Auto" }],
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

async function probeDriver(entry: (typeof BUILT_IN_DRIVERS)[number]): Promise<ProviderSnapshot> {
  let installed = false
  for (const binary of entry.binaryNames) {
    if (await binaryOnPath(binary)) {
      installed = true
      break
    }
  }
  return {
    instanceId: entry.instanceId,
    driverKind: entry.driverKind,
    displayName: entry.displayName,
    enabled: true,
    status: installed ? "ready" : "unavailable",
    message: installed ? null : `${entry.displayName} CLI not found on PATH`,
    models: installed ? [...entry.stubModels] : [],
  }
}

export async function listProviders(): Promise<AgentProvidersState> {
  if (cachedState) return cachedState
  return refreshProviders()
}

export async function refreshProviders(): Promise<AgentProvidersState> {
  const providers = await Promise.all(BUILT_IN_DRIVERS.map(probeDriver))
  cachedState = {
    providers,
    updatedAt: new Date().toISOString(),
  }
  return cachedState
}
