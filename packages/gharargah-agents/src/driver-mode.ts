import { defaultAgentDriverId, normalizeAgentId } from "./model.js"

export type AgentDriverMode = "cli" | "native"

export const AGENT_DRIVER_MODE_STORAGE_KEY = "gharargah-agent-driver-mode"

const NATIVE_AGENT_IDS = new Set(["codex", "claude", "cursor", "opencode", "grok"])

type StorageLike = Pick<Storage, "getItem" | "setItem">

const memoryStorage = new Map<string, string>()

const memoryShim: StorageLike = {
  getItem(key: string) {
    return memoryStorage.get(key) ?? null
  },
  setItem(key: string, value: string) {
    memoryStorage.set(key, value)
  },
}

function resolveStorage(
  storage?: Pick<Storage, "getItem" | "setItem"> | null,
): StorageLike {
  if (storage != null) {
    return storage
  }
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage) {
      return globalThis.localStorage
    }
  } catch {
    /* SSR / privacy mode */
  }
  return memoryShim
}

function coerceMode(agentId: string, value: unknown): AgentDriverMode {
  if (!agentSupportsNativeDriver(agentId)) return "cli"
  if (value === "native") return "native"
  return "cli"
}

export function agentSupportsNativeDriver(
  agentId: string | null | undefined,
): boolean {
  return NATIVE_AGENT_IDS.has(normalizeAgentId(agentId))
}

export function defaultAgentDriverMode(
  _agentId: string | null | undefined,
): AgentDriverMode {
  return "cli"
}

export function readAgentDriverModes(
  storage?: Pick<Storage, "getItem" | "setItem"> | null,
): Record<string, AgentDriverMode> {
  const store = resolveStorage(storage)
  try {
    const raw = store.getItem(AGENT_DRIVER_MODE_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const result: Record<string, AgentDriverMode> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const agentId = normalizeAgentId(key)
      if (!agentSupportsNativeDriver(agentId)) continue
      result[agentId] = coerceMode(agentId, value)
    }
    return result
  } catch {
    return {}
  }
}

export function readAgentDriverMode(
  agentId: string,
  storage?: Pick<Storage, "getItem" | "setItem"> | null,
): AgentDriverMode {
  const id = normalizeAgentId(agentId)
  const modes = readAgentDriverModes(storage)
  return modes[id] ?? defaultAgentDriverMode(id)
}

export function writeAgentDriverMode(
  agentId: string,
  mode: AgentDriverMode,
  storage?: Pick<Storage, "getItem" | "setItem"> | null,
): Record<string, AgentDriverMode> {
  const id = normalizeAgentId(agentId)
  const store = resolveStorage(storage)
  const current = readAgentDriverModes(store)
  const nextMode = agentSupportsNativeDriver(id) ? coerceMode(id, mode) : "cli"
  const next = { ...current, [id]: nextMode }
  try {
    store.setItem(AGENT_DRIVER_MODE_STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* quota / private mode */
  }
  return next
}

export function agentDriverIdForMode(
  agentId: string,
  mode: AgentDriverMode,
): string {
  const id = normalizeAgentId(agentId)
  if (mode === "native") return defaultAgentDriverId(id)
  return `${id}:cli`
}
