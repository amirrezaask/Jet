import { useCallback, useEffect, useState } from "react"
import {
  defaultThemeId,
  defaultThemeIdForScheme,
  getThemeById,
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  type JetAppearanceSettings,
} from "@gharargah/ui"
import { applyColorScheme, syncNativeChromeFromTheme } from "@gharargah/ui"

type ColorScheme = "dark" | "light"

const THEME_ID_STORAGE_KEY = "jet-theme-id"
const COLOR_SCHEME_KEY = "jet-color-scheme"
const FONT_SIZE_STORAGE_KEY = "jet-font-size"
const APPEARANCE_STORAGE_KEY = "jet-appearance-settings"
const DEFAULT_FONT_SIZE = 13
const FONT_SIZE_STEP = 2

export const DEFAULT_APPEARANCE_SETTINGS: JetAppearanceSettings = {
  themeId: defaultThemeId,
  fontSize: DEFAULT_FONT_SIZE,
  fontFamily: DEFAULT_UI_FONT_FAMILY,
  monoFontFamily: DEFAULT_MONO_FONT_FAMILY,
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function normalizeThemeId(value: unknown): string {
  return getThemeById(typeof value === "string" ? value : null).id
}

function normalizeFontFamily(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
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
      fontFamily: normalizeFontFamily(parsed.fontFamily, base.fontFamily),
      monoFontFamily: normalizeFontFamily(parsed.monoFontFamily, base.monoFontFamily),
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
  root.style.setProperty(
    "--font-sans",
    normalizeFontFamily(settings.fontFamily, DEFAULT_UI_FONT_FAMILY),
  )
  root.style.setProperty(
    "--font-mono",
    normalizeFontFamily(settings.monoFontFamily, DEFAULT_MONO_FONT_FAMILY),
  )
  root.style.setProperty("--gharargah-editor-line-height", "1.45")
  root.style.setProperty("--gharargah-terminal-line-height", "1.2")
  root.style.setProperty("--gharargah-terminal-cursor-blink", "1")
  root.style.setProperty("--gharargah-cursor-style", "bar")
  root.style.setProperty("--gharargah-cursor-motion", "trail")
  root.style.setProperty("--gharargah-terminal-cursor-style", "bar")
  root.style.setProperty("--gharargah-terminal-cursor-motion", "trail")
  root.dataset.jetDensity = "compact"
  root.dataset.jetReducedMotion = "false"
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

  useEffect(() => {
    persistAppearanceSettings(appearanceSettings)
    applyAppearanceCss(appearanceSettings)
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
