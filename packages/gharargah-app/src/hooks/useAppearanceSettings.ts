import { useCallback, useEffect, useState } from "react"
import {
  defaultThemeId,
  defaultThemeIdForScheme,
  getThemeById,
  siblingThemeForScheme,
  type JetAppearanceSettings,
} from "@gharargah/ui"
import { applyColorScheme } from "@gharargah/codemirror"
import { syncAllEditorThemes, syncNativeChromeFromTheme } from "@gharargah/ui"

type ColorScheme = "dark" | "light"

const THEME_ID_STORAGE_KEY = "jet-theme-id"
const COLOR_SCHEME_KEY = "jet-color-scheme"
const FONT_SIZE_STORAGE_KEY = "jet-font-size"
const APPEARANCE_STORAGE_KEY = "jet-appearance-settings"
const DEFAULT_FONT_SIZE = 13
const FONT_SIZE_STEP = 2
export const DEFAULT_MONO_FONT =
  '"Geist Mono Variable", "Geist Mono", "IBM Plex Mono", "SFMono-Regular", Menlo, monospace'

export const DEFAULT_APPEARANCE_SETTINGS: JetAppearanceSettings = {
  themeId: defaultThemeId,
  fontSize: DEFAULT_FONT_SIZE,
  monoFontFamily: DEFAULT_MONO_FONT,
  terminalLineHeight: 1.2,
  editorLineHeight: 1.45,
  density: "compact",
  cursorBlink: true,
  cursorStyle: "bar",
  cursorMotion: "trail",
  reducedMotion: false,
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function normalizeThemeId(value: unknown): string {
  return getThemeById(typeof value === "string" ? value : null).id
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
    const parsed = JSON.parse(raw) as Partial<JetAppearanceSettings> & {
      terminalCursorStyle?: JetAppearanceSettings["cursorStyle"]
      terminalCursorMotion?: JetAppearanceSettings["cursorMotion"]
    }
    const storedCursorStyle = parsed.cursorStyle ?? parsed.terminalCursorStyle
    const storedCursorMotion = parsed.cursorMotion ?? parsed.terminalCursorMotion
    return {
      themeId: normalizeThemeId(parsed.themeId ?? base.themeId),
      fontSize: clampNumber(parsed.fontSize, base.fontSize, 10, 24),
      monoFontFamily:
        typeof parsed.monoFontFamily === "string" && parsed.monoFontFamily.trim().length > 0
          ? parsed.monoFontFamily
          : base.monoFontFamily,
      terminalLineHeight: clampNumber(parsed.terminalLineHeight, base.terminalLineHeight, 1, 2),
      editorLineHeight: clampNumber(parsed.editorLineHeight, base.editorLineHeight, 1.1, 2),
      density: parsed.density === "comfortable" ? "comfortable" : "compact",
      cursorBlink: parsed.cursorBlink !== false,
      cursorStyle:
        storedCursorStyle === "block" || storedCursorStyle === "underline"
          ? storedCursorStyle
          : "bar",
      cursorMotion:
        storedCursorMotion === "smooth" || storedCursorMotion === "off"
          ? storedCursorMotion
          : "trail",
      reducedMotion: parsed.reducedMotion === true,
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

function applyAppearanceCss(settings: JetAppearanceSettings): void {
  const root = document.documentElement
  root.style.fontSize = `${settings.fontSize}px`
  root.style.setProperty("--font-mono", settings.monoFontFamily)
  root.style.setProperty("--gharargah-editor-line-height", String(settings.editorLineHeight))
  root.style.setProperty("--gharargah-terminal-line-height", String(settings.terminalLineHeight))
  root.style.setProperty("--gharargah-terminal-cursor-blink", settings.cursorBlink ? "1" : "0")
  root.style.setProperty("--gharargah-cursor-style", settings.cursorStyle)
  root.style.setProperty("--gharargah-cursor-motion", settings.cursorMotion)
  root.style.setProperty("--gharargah-terminal-cursor-style", settings.cursorStyle)
  root.style.setProperty("--gharargah-terminal-cursor-motion", settings.cursorMotion)
  root.dataset.jetDensity = settings.density
  root.dataset.jetReducedMotion = settings.reducedMotion ? "true" : "false"
}

export function useAppearanceSettings() {
  const [appearanceSettings, setAppearanceSettings] =
    useState<JetAppearanceSettings>(() => loadAppearanceSettings())
  const activeTheme = getThemeById(appearanceSettings.themeId)
  const colorScheme: ColorScheme = activeTheme.scheme ?? "dark"

  useEffect(() => {
    applyColorScheme(colorScheme, activeTheme)
    syncAllEditorThemes(activeTheme)
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

  const toggleColorScheme = useCallback(() => {
    setAppearanceSettings(prev => {
      const current = getThemeById(prev.themeId)
      const nextScheme: ColorScheme = current.scheme === "light" ? "dark" : "light"
      return { ...prev, themeId: siblingThemeForScheme(prev.themeId, nextScheme).id }
    })
  }, [])

  const setColorScheme = useCallback((scheme: ColorScheme) => {
    setAppearanceSettings(prev => ({
      ...prev,
      themeId: siblingThemeForScheme(prev.themeId, scheme).id,
    }))
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
    toggleColorScheme,
    setColorScheme,
    setThemeId,
  }
}
