import { useCallback, useMemo, useSyncExternalStore } from "react"
import type { ProviderInstanceId } from "./t3contracts.js"

export type ClientSettings = {
  favorites: ReadonlyArray<{ readonly provider: ProviderInstanceId; readonly model: string }>
}

const STORAGE_KEY = "jet-agent-client-settings"

const defaultSettings: ClientSettings = { favorites: [] }

let settings: ClientSettings = defaultSettings

function readSettings(): ClientSettings {
  if (typeof localStorage === "undefined") return settings
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return settings
    const parsed = JSON.parse(raw) as Partial<ClientSettings>
    settings = {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
    }
  } catch {
    settings = defaultSettings
  }
  return settings
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit() {
  for (const listener of listeners) listener()
}

function useClientSettingsValue(): ClientSettings {
  return useSyncExternalStore(subscribe, readSettings, readSettings)
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

export function useUpdateClientSettings() {
  return useCallback((patch: Partial<ClientSettings>) => {
    settings = { ...readSettings(), ...patch }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    }
    emit()
  }, [])
}
