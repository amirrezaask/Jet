import { useCallback, useMemo, useSyncExternalStore } from "react"
import type { ProviderInstanceId } from "@gharargah/agents"

export type ClientSettings = {
  favorites: ReadonlyArray<{ readonly provider: ProviderInstanceId; readonly model: string }>
}

const STORAGE_KEY = "jet-agent-client-settings"
const defaultSettings: ClientSettings = { favorites: [] }

let settings: ClientSettings = defaultSettings
let hydrated = false

function parseSettings(raw: string): ClientSettings {
  try {
    const parsed = JSON.parse(raw) as Partial<ClientSettings>
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
    }
  } catch {
    return defaultSettings
  }
}

function hydrateFromStorage(): void {
  if (hydrated || typeof localStorage === "undefined") return
  hydrated = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    settings = parseSettings(raw)
  } catch {
    settings = defaultSettings
  }
}

/** Stable getSnapshot for useSyncExternalStore (re-parse → React #185). */
export function getClientSettingsSnapshot(): ClientSettings {
  hydrateFromStorage()
  return settings
}

export function getClientSettingsServerSnapshot(): ClientSettings {
  return defaultSettings
}

/** Test-only reset. */
export function resetClientSettingsForTests(): void {
  settings = defaultSettings
  hydrated = false
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(STORAGE_KEY)
  }
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit() {
  for (const listener of listeners) listener()
}

function useClientSettingsValue(): ClientSettings {
  return useSyncExternalStore(
    subscribe,
    getClientSettingsSnapshot,
    getClientSettingsServerSnapshot,
  )
}

export function useClientSettings<T = ClientSettings>(
  selector?: (settings: ClientSettings) => T,
): T {
  const value = useClientSettingsValue()
  return useMemo(
    () => (selector ? selector(value) : (value as T)),
    [selector, value],
  )
}

export function updateClientSettings(patch: Partial<ClientSettings>): void {
  hydrateFromStorage()
  settings = { ...settings, ...patch }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }
  emit()
}

export function useUpdateClientSettings() {
  return useCallback((patch: Partial<ClientSettings>) => {
    updateClientSettings(patch)
  }, [])
}
