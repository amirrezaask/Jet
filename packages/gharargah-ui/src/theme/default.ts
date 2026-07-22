import type { GharargahTheme } from "@gharargah/codemirror"
import type { ColorScheme } from "./theme-palette.js"
import { glassThemeList, glassThemes } from "./glass.js"
import {
  defaultDark,
  defaultLight,
  shadcnThemeList,
  shadcnThemes,
} from "./shadcn.js"

export type { ColorScheme } from "./theme-palette.js"
export { defaultDark, defaultLight } from "./shadcn.js"

export const defaultThemeId = defaultDark.id

export const bundledThemes: Record<string, GharargahTheme> = {
  ...shadcnThemes,
  ...glassThemes,
}

export const bundledThemeList: GharargahTheme[] = [
  ...shadcnThemeList,
  ...glassThemeList,
]

export function getThemeById(id: string | null | undefined): GharargahTheme {
  if (!id) return defaultDark
  return bundledThemes[id] ?? defaultDark
}

export function themePreviewSwatches(theme: GharargahTheme): string[] {
  return theme.previewSwatches?.length
    ? theme.previewSwatches
    : [theme.colors.bg, theme.colors.panel, theme.colors.text, theme.colors.accent]
}

export function defaultThemeIdForScheme(scheme: ColorScheme): string {
  return scheme === "light" ? defaultLight.id : defaultDark.id
}

export function themeForScheme(scheme: ColorScheme): GharargahTheme {
  return getThemeById(defaultThemeIdForScheme(scheme))
}

export function themeFamilyForId(id: string | null | undefined): string {
  return getThemeById(id).family ?? "Default"
}

/** Glass themes stay dark; Default family flips between dark/light siblings. */
export function siblingThemeForScheme(id: string, scheme: ColorScheme): GharargahTheme {
  const current = getThemeById(id)
  if (current.family === "Default") {
    return scheme === "light" ? defaultLight : defaultDark
  }
  return current
}

/** True when theme should enable optical-glass home / modal chrome. */
export function themeUsesGlassSurface(theme: GharargahTheme): boolean {
  return theme.family === "Glass"
}
