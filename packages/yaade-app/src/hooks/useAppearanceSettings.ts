import { useCallback, useEffect, useRef, useState } from "react"
import {
  defaultThemeId,
  defaultThemeIdForScheme,
  getThemeById,
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_MONO_FONT_NAME,
  DEFAULT_UI_FONT_FAMILY,
  buildMonoFontStack,
  type JetAppearanceSettings,
  type SessionLayout,
  applyColorScheme,
} from "@yaade/ui/appearance"

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
const LEGACY_LIGHT_THEME_IDS = new Set([
  "catppuccin-latte",
  "tokyonight-day",
])
const LEGACY_DARK_THEME_IDS = new Set([
  "catppuccin-mocha",
  "catppuccin-macchiato",
  "tokyonight-night",
  "tokyonight-storm",
])

export const DEFAULT_APPEARANCE_SETTINGS: JetAppearanceSettings = {
  themeId: defaultThemeId,
  fontSize: DEFAULT_FONT_SIZE,
  monoFontFamily: DEFAULT_MONO_FONT_NAME,
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

export function normalizeThemeId(
  value: unknown,
  fallbackScheme: ColorScheme = "dark",
): string {
  if (typeof value === "string") {
    if (LEGACY_LIGHT_THEME_IDS.has(value)) return defaultThemeIdForScheme("light")
    if (LEGACY_DARK_THEME_IDS.has(value)) return defaultThemeIdForScheme("dark")
    const resolved = getThemeById(value)
    if (resolved.id === value) return resolved.id
  }
  return defaultThemeIdForScheme(fallbackScheme)
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
    const rawScheme = localStorage.getItem(COLOR_SCHEME_KEY)
    const scheme = rawScheme === "light" ? "light" : "dark"
    if (rawTheme) return normalizeThemeId(rawTheme, scheme)
    if (rawScheme === "light" || rawScheme === "dark") {
      return defaultThemeIdForScheme(rawScheme)
    }
  } catch {
    /* ignore */
  }
  return defaultThemeId
}

function normalizeMonoFontFamily(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_MONO_FONT_NAME
  const trimmed = value.trim()
  if (!trimmed) return DEFAULT_MONO_FONT_NAME
  // Legacy builds may have persisted a full CSS stack.
  if (trimmed.includes(",")) {
    const primary = trimmed.split(",")[0]?.trim().replace(/^["']|["']$/g, "")
    return primary || DEFAULT_MONO_FONT_NAME
  }
  return trimmed.replace(/^["']|["']$/g, "") || DEFAULT_MONO_FONT_NAME
}

export function loadAppearanceSettings(): JetAppearanceSettings {
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
      themeId: normalizeThemeId(
        parsed.themeId ?? base.themeId,
        getThemeById(base.themeId).scheme ?? "dark",
      ),
      fontSize: clampNumber(parsed.fontSize, base.fontSize, 10, 24),
      monoFontFamily: normalizeMonoFontFamily(
        (parsed as { monoFontFamily?: unknown }).monoFontFamily ??
          base.monoFontFamily,
      ),
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
export function applyAppearanceCss(settings: JetAppearanceSettings): void {
  const root = document.documentElement
  root.style.fontSize = `${settings.fontSize}px`
  root.style.setProperty("--font-sans", DEFAULT_UI_FONT_FAMILY)
  root.style.setProperty(
    "--font-mono",
    buildMonoFontStack(settings.monoFontFamily) || DEFAULT_MONO_FONT_FAMILY,
  )
  root.style.setProperty("--yaade-editor-line-height", "1.45")
  root.style.setProperty("--yaade-terminal-line-height", "1")
  root.style.setProperty("--yaade-terminal-cursor-blink", "1")
  root.dataset.jetDensity = "compact"
  root.dataset.yaadeReducedMotion = "false"
  root.dataset.yaadeSessionLayout = settings.sessionLayout
}

/** Apply persisted appearance before React mounts to avoid a theme flash. */
export function applyInitialAppearance(): JetAppearanceSettings {
  const settings = loadAppearanceSettings()
  const theme = getThemeById(settings.themeId)
  applyColorScheme(theme.scheme ?? "dark", theme)
  applyAppearanceCss(settings)
  return settings
}

export function useAppearanceSettings() {
  const [appearanceSettings, setAppearanceSettings] = useState<JetAppearanceSettings>(() =>
    loadAppearanceSettings(),
  )
  const activeTheme = getThemeById(appearanceSettings.themeId)
  const colorScheme: ColorScheme = activeTheme.scheme ?? "dark"

  useEffect(() => {
    applyColorScheme(colorScheme, activeTheme)
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
