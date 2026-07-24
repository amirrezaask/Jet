import type {
  AgentCatalogState,
  AgentProvidersState,
  ProviderSnapshot,
} from "@gharargah/agents"
import type { ProviderDriverKind, ProviderInstanceId } from "./t3contracts.js"

export type ProviderInstanceEntry = {
  readonly instanceId: ProviderInstanceId
  readonly driverKind: ProviderDriverKind
  readonly displayName: string
  readonly accentColor?: string | undefined
  readonly continuationGroupKey?: string | undefined
  readonly enabled: boolean
  readonly status: ProviderSnapshot["status"]
  readonly message?: string | null
  readonly isAvailable: boolean
  readonly snapshot: ProviderSnapshot
  readonly models: ProviderSnapshot["models"]
}

export function isProviderInstancePickerReady(entry: ProviderInstanceEntry): boolean {
  return entry.enabled && entry.isAvailable && entry.status === "ready"
}

export function isProviderInstancePickerVisible(entry: ProviderInstanceEntry): boolean {
  return entry.enabled
}

export function deriveProviderInstanceEntries(
  state: AgentProvidersState | null,
): ProviderInstanceEntry[] {
  if (!state) return []
  return state.providers.map(snapshot => ({
    instanceId: snapshot.instanceId as ProviderInstanceId,
    driverKind: snapshot.driverKind as ProviderDriverKind,
    displayName: snapshot.displayName,
    continuationGroupKey: `${snapshot.instanceId}:instance:${snapshot.instanceId}`,
    enabled: snapshot.enabled,
    status: snapshot.status,
    message: snapshot.message,
    isAvailable: snapshot.status === "ready",
    snapshot,
    models: snapshot.models,
  }))
}

/** Keeps the imported picker implementation isolated from the product's Agent/Driver model. */
export function agentCatalogToProviderState(
  catalog: AgentCatalogState | null,
): AgentProvidersState | null {
  if (!catalog) return null
  return {
    updatedAt: catalog.updatedAt,
    providers: catalog.agents.map(agent => {
      const driver =
        agent.drivers.find(candidate => candidate.id === agent.activeDriverId) ?? agent.drivers[0]
      return {
        instanceId: agent.id,
        // The picker uses this only for agent icons/grouping. Transport kind stays on driver.
        driverKind: agent.id,
        displayName: agent.displayName,
        enabled: agent.enabled,
        status: driver?.status ?? "unavailable",
        message: driver?.message,
        models: agent.models,
      }
    }),
  }
}

export function getCustomModelOptionsByInstance(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): Map<ProviderInstanceId, ReadonlyArray<{ slug: string; name: string; shortName?: string }>> {
  const map = new Map<
    ProviderInstanceId,
    ReadonlyArray<{ slug: string; name: string; shortName?: string }>
  >()
  for (const entry of entries) {
    map.set(
      entry.instanceId,
      entry.models.map(model => ({
        slug: model.slug,
        name: model.name,
        ...(model.shortName ? { shortName: model.shortName } : {}),
      })),
    )
  }
  return map
}

export function resolveDefaultProviderSelection(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  preferredInstanceId?: string | null,
  preferredModel?: string | null,
): { instanceId: ProviderInstanceId; model: string } | null {
  const ready = entries.filter(isProviderInstancePickerReady)
  if (ready.length === 0) return null
  const instance =
    ready.find(entry => entry.instanceId === preferredInstanceId) ?? ready[0]!
  const models = instance.models
  if (models.length === 0) return null
  const model =
    preferredModel && models.some(item => item.slug === preferredModel)
      ? preferredModel
      : models[0]!.slug
  return { instanceId: instance.instanceId, model }
}
