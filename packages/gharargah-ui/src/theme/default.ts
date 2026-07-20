import type { GharargahTheme } from "@gharargah/codemirror"
import type { ColorScheme } from "./theme-palette.js"
import { glassBlue, glassThemeList, glassThemes } from "./glass.js"

export type { ColorScheme } from "./theme-palette.js"

export const defaultThemeId = glassBlue.id

export const bundledThemes: Record<string, GharargahTheme> = { ...glassThemes }

export const bundledThemeList: GharargahTheme[] = [...glassThemeList]

export const defaultDark = glassBlue
/** All glass themes are dark; light fallback stays Glass Blue. */
export const defaultLight = glassBlue

export function getThemeById(id: string | null | undefined): GharargahTheme {
  if (!id) return glassBlue
  return bundledThemes[id] ?? glassBlue
}

export function themePreviewSwatches(theme: GharargahTheme): string[] {
  return theme.previewSwatches?.length
    ? theme.previewSwatches
    : [theme.colors.bg, theme.colors.panel, theme.colors.text, theme.colors.accent]
}

export function defaultThemeIdForScheme(_scheme: ColorScheme): string {
  return glassBlue.id
}

export function themeForScheme(scheme: ColorScheme): GharargahTheme {
  return getThemeById(defaultThemeIdForScheme(scheme))
}

export function themeFamilyForId(id: string | null | undefined): string {
  return getThemeById(id).family ?? "Glass"
}

export function siblingThemeForScheme(id: string, _scheme: ColorScheme): GharargahTheme {
  return getThemeById(id)
}
