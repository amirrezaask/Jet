import { useCallback, useEffect, useRef, useState } from "react"
import {
  defaultThemeId,
  defaultThemeIdForScheme,
  getThemeById,
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  type JetAppearanceSettings,
  type SessionLayout,
} from "@yaade/ui"
import { applyColorScheme, syncNativeChromeFromTheme } from "@yaade/ui"

type ColorScheme = "dark" | "light"

const THEME_ID_STORAGE_KEY = "jet-theme-id"
const COLOR_SCHEME_KEY = "jet-color-scheme"
const FONT_SIZE_STORAGE_KEY = "jet-font-size"
const APPEARANCE_STORAGE_KEY = "jet-appearance-settings"
const DEFAULT_FONT_SIZE = 13
const FONT_SIZE_STEP = 2
const DEFAULT_SIDEBAR_WIDTH = 300
const MIN_SIDEBAR_WIDTH = 240
const MAX_SIDEBAR_WIDTH = 480

export const DEFAULT_APPEARANCE_SETTINGS: JetAppearanceSettings = {
  themeId: defaultThemeId,
  fontSize: DEFAULT_FONT_SIZE,
  sessionLayout: "sidebar",
  sidebarCollapsed: false,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  sidebarProjectFilterPath: null,
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function normalizeThemeId(value: unknown): string {
  return getThemeById(typeof value === "string" ? value : null).id
}

export function normalizeSessionLayout(_value: unknown): SessionLayout {
  // Legacy localStorage may hold "cards" | "tabs" — always coerce to sidebar.
  return "sidebar"
}

function normalizeProjectFilterPath(value: unknown): string | null {
  if (value == null || value === "" || value === "all") return null
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  // Older builds briefly persisted root URIs — accept those too.
  if (trimmed.startsWith("file://")) {
    try {
      const path = decodeURIComponent(trimmed.replace(/^file:\/\//, ""))
      return path.length > 0 ? path : null
    } catch {
      return null
    }
  }
  return trimmed
}

function loadStoredFontSize(): number {
  try {
    const raw = localStorage.getItem(FONT_SIZE_STORAGE_KEY)
    if (!raw) return DEFAULT_FONT_SIZE
    const n = parseFloat(raw)
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_FONT_SIZE
    return n
  } catch {
    return DEFAULT_FONT_SIZE
  }
}

function loadStoredThemeId(): string {
  try {
    const rawTheme = localStorage.getItem(THEME_ID_STORAGE_KEY)
    if (rawTheme) return normalizeThemeId(rawTheme)
    const rawScheme = localStorage.getItem(COLOR_SCHEME_KEY)
    if (rawScheme === "light" || rawScheme === "dark") {
      return defaultThemeIdForScheme(rawScheme)
    }
  } catch {
    /* ignore */
  }
  return defaultThemeId
}

function loadAppearanceSettings(): JetAppearanceSettings {
  const base: JetAppearanceSettings = {
    ...DEFAULT_APPEARANCE_SETTINGS,
    themeId: loadStoredThemeId(),
    fontSize: loadStoredFontSize(),
  }
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Partial<JetAppearanceSettings>
    return {
      themeId: normalizeThemeId(parsed.themeId ?? base.themeId),
      fontSize: clampNumber(parsed.fontSize, base.fontSize, 10, 24),
      sessionLayout: normalizeSessionLayout(parsed.sessionLayout),
      sidebarCollapsed: parsed.sidebarCollapsed === true,
      sidebarWidth: clampNumber(
        parsed.sidebarWidth,
        DEFAULT_SIDEBAR_WIDTH,
        MIN_SIDEBAR_WIDTH,
        MAX_SIDEBAR_WIDTH,
      ),
      sidebarProjectFilterPath: normalizeProjectFilterPath(
        (parsed as { sidebarProjectFilterPath?: unknown }).sidebarProjectFilterPath ??
          (parsed as { sidebarProjectFilterRootUri?: unknown })
            .sidebarProjectFilterRootUri ??
          (parsed as { sidebarProjectFilterId?: unknown }).sidebarProjectFilterId,
      ),
    }
  } catch {
    return base
  }
}

function persistAppearanceSettings(settings: JetAppearanceSettings): void {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings))
    localStorage.setItem(THEME_ID_STORAGE_KEY, settings.themeId)
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(settings.fontSize))
    localStorage.setItem(COLOR_SCHEME_KEY, getThemeById(settings.themeId).scheme ?? "dark")
  } catch {
    /* ignore */
  }
}

/** Apply persisted appearance tokens onto :root. */
function applyAppearanceCss(settings: JetAppearanceSettings): void {
  const root = document.documentElement
  root.style.fontSize = `${settings.fontSize}px`
  root.style.setProperty("--font-sans", DEFAULT_UI_FONT_FAMILY)
  root.style.setProperty("--font-mono", DEFAULT_MONO_FONT_FAMILY)
  root.style.setProperty("--yaade-editor-line-height", "1.45")
  root.style.setProperty("--yaade-terminal-line-height", "1")
  root.style.setProperty("--yaade-terminal-cursor-blink", "1")
  root.dataset.jetDensity = "compact"
  root.dataset.jetReducedMotion = "false"
  root.dataset.yaadeSessionLayout = settings.sessionLayout
}

export function useAppearanceSettings() {
  const [appearanceSettings, setAppearanceSettings] = useState<JetAppearanceSettings>(() =>
    loadAppearanceSettings(),
  )
  const activeTheme = getThemeById(appearanceSettings.themeId)
  const colorScheme: ColorScheme = activeTheme.scheme ?? "dark"

  useEffect(() => {
    applyColorScheme(colorScheme, activeTheme)
    syncNativeChromeFromTheme()
  }, [colorScheme, activeTheme])

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    applyAppearanceCss(appearanceSettings)
    if (persistTimerRef.current != null) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null
      persistAppearanceSettings(appearanceSettings)
    }, 250)
    return () => {
      if (persistTimerRef.current == null) return
      clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
      persistAppearanceSettings(appearanceSettings)
    }
  }, [appearanceSettings])

  const handleZoom = useCallback((delta: number) => {
    setAppearanceSettings(prev => ({
      ...prev,
      fontSize: Math.max(10, Math.min(24, prev.fontSize + delta * FONT_SIZE_STEP)),
    }))
  }, [])

  const setFontSize = useCallback((px: number) => {
    setAppearanceSettings(prev => ({
      ...prev,
      fontSize: Math.max(10, Math.min(24, px)),
    }))
  }, [])

  const resetAppearanceSettings = useCallback(() => {
    setAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS)
  }, [])

  const setThemeId = useCallback((themeId: string) => {
    setAppearanceSettings(prev => ({ ...prev, themeId: normalizeThemeId(themeId) }))
  }, [])

  return {
    appearanceSettings,
    setAppearanceSettings,
    activeTheme,
    colorScheme,
    fontSize: appearanceSettings.fontSize,
    handleZoom,
    setFontSize,
    resetAppearanceSettings,
    setThemeId,
  }
}
