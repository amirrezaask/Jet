import assert from "node:assert/strict"
import test from "node:test"
import type { AgentCatalogState, AgentProvidersState } from "@gharargah/agents"
import {
  agentCatalogToProviderState,
  deriveProviderInstanceEntries,
  getCustomModelOptionsByInstance,
  isProviderInstancePickerReady,
  resolveDefaultProviderSelection,
} from "./providerInstances.js"

function readyProvider(id: string, models: Array<{ slug: string; name: string }>): AgentProvidersState {
  return {
    updatedAt: new Date().toISOString(),
    providers: [
      {
        instanceId: id,
        driverKind: id,
        displayName: id,
        enabled: true,
        status: "ready",
        message: null,
        models: models.map(model => ({
          ...model,
          shortName: model.name,
        })),
      },
    ],
  }
}

test("deriveProviderInstanceEntries maps ready providers for the picker", () => {
  const entries = deriveProviderInstanceEntries(
    readyProvider("codex", [{ slug: "auto", name: "Auto" }]),
  )
  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.instanceId, "codex")
  assert.equal(isProviderInstancePickerReady(entries[0]!), true)
})

test("resolveDefaultProviderSelection prefers ready instance + model", () => {
  const entries = deriveProviderInstanceEntries(
    readyProvider("claude", [
      { slug: "sonnet", name: "Sonnet" },
      { slug: "opus", name: "Opus" },
    ]),
  )
  assert.deepEqual(resolveDefaultProviderSelection(entries, "claude", "opus"), {
    instanceId: "claude",
    model: "opus",
  })
  assert.deepEqual(resolveDefaultProviderSelection(entries, null, null), {
    instanceId: "claude",
    model: "sonnet",
  })
})

test("resolveDefaultProviderSelection returns null when nothing is ready", () => {
  const state: AgentProvidersState = {
    updatedAt: new Date().toISOString(),
    providers: [
      {
        instanceId: "cursor",
        driverKind: "cursor",
        displayName: "Cursor",
        enabled: true,
        status: "unavailable",
        message: "offline",
        models: [{ slug: "composer", name: "Composer" }],
      },
    ],
  }
  assert.equal(resolveDefaultProviderSelection(deriveProviderInstanceEntries(state)), null)
})

test("agentCatalogToProviderState projects catalog agents into picker providers", () => {
  const catalog: AgentCatalogState = {
    updatedAt: new Date().toISOString(),
    agents: [
      {
        id: "codex",
        displayName: "Codex",
        enabled: true,
        activeDriverId: "codex:app-server",
        drivers: [
          {
            id: "codex:app-server",
            kind: "native",
            status: "ready",
            message: null,
          },
        ],
        models: [{ slug: "auto", name: "Auto", shortName: "Auto" }],
      },
    ],
  }
  const state = agentCatalogToProviderState(catalog)
  assert.ok(state)
  const entries = deriveProviderInstanceEntries(state)
  const options = getCustomModelOptionsByInstance(entries)
  assert.equal(options.get("codex")?.[0]?.slug, "auto")
})
