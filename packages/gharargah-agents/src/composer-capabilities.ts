import type { AgentSnapshot, AgentThread } from "./types.js"

export type AgentComposerCapabilities = {
  showRuntime: boolean
  showInteraction: boolean
  showAttachments: boolean
  supportsModelListing: boolean
  /** Host/provider can persist file edits (ACP or native), not CLI stdout. */
  writeCapable: boolean
  /** Active driver is degraded (e.g. Cursor CLI). */
  degradedTransport: boolean
  /** Non-model config option ids currently advertised by the provider. */
  configOptionIds: ReadonlyArray<string>
  availableInteractionModes: ReadonlyArray<{ id: string; name: string }>
}

function driverIsWriteCapable(driverId: string | null | undefined): boolean {
  if (!driverId) return false
  return (
    driverId.endsWith(":acp") ||
    driverId.endsWith(":app-server") ||
    driverId.endsWith(":sdk")
  )
}

function driverIsDegraded(driverId: string | null | undefined): boolean {
  return Boolean(driverId?.endsWith(":cli"))
}

function isInteractionConfigOption(id: string, name: string): boolean {
  const normalized = `${id} ${name}`.toLowerCase().replace(/[\s_-]+/g, "")
  return normalized.includes("mode")
}

/** Normalized composer capability view — UI should not branch on transport names. */
export function deriveComposerCapabilities(input: {
  thread: AgentThread | null
  agent?: AgentSnapshot | null
}): AgentComposerCapabilities {
  const { thread, agent } = input
  const driverId = thread?.driverId ?? agent?.activeDriverId ?? null
  const activeDriver =
    agent?.drivers.find(driver => driver.id === driverId) ??
    agent?.drivers.find(driver => driver.id === agent.activeDriverId)
  const configOptionIds = (thread?.configOptions ?? [])
    .filter(option => option.category?.toLowerCase() !== "model" && option.id !== "model")
    .map(option => option.id)
  const hasProviderInteractionMode =
    (thread?.sessionModes?.availableModes?.length ?? 0) > 0 ||
    (thread?.configOptions ?? []).some(option =>
      isInteractionConfigOption(option.id, option.name),
    )
  const models = agent?.models ?? []
  const supportsModelListing =
    models.length > 0 && !(models.length === 1 && models[0]?.slug === "auto")

  return {
    showRuntime: driverIsWriteCapable(driverId),
    showInteraction: hasProviderInteractionMode,
    showAttachments: driverIsWriteCapable(driverId) || !driverIsDegraded(driverId),
    supportsModelListing,
    writeCapable: driverIsWriteCapable(driverId),
    degradedTransport:
      driverIsDegraded(driverId) ||
      activeDriver?.kind === "cli" ||
      Boolean((activeDriver as { degraded?: boolean } | undefined)?.degraded),
    configOptionIds,
    availableInteractionModes: thread?.sessionModes?.availableModes ?? [],
  }
}

/** User-facing agent identity: Cursor ACP folds into Cursor. */
export function displayAgentName(agentId: string | null | undefined, fallback?: string): string {
  const id = (agentId ?? "").toLowerCase()
  if (id === "cursor" || id === "cursor-acp") return "Cursor"
  if (fallback?.trim()) return fallback
  if (!id) return "Agent"
  return id.charAt(0).toUpperCase() + id.slice(1)
}

export function canonicalAgentId(agentId: string | null | undefined): string {
  const id = (agentId ?? "").toLowerCase()
  if (id === "cursor-acp") return "cursor"
  return id || "codex"
}
