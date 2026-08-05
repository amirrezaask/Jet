export const DEFAULT_UI_FONT_FAMILY =
  '"Geist Variable", "Geist", ui-sans-serif, system-ui, sans-serif'

/** Bundled default monospace face (also listed in the settings picker). */
export const DEFAULT_MONO_FONT_NAME = "Commit Mono"

export const DEFAULT_MONO_FONT_FAMILY = `"${DEFAULT_MONO_FONT_NAME}", ui-monospace, monospace`

/** Generic CSS fallbacks always appended after the chosen face. */
export const MONO_FONT_FALLBACKS = "ui-monospace, monospace"

/**
 * Build a CSS `font-family` stack from a primary face name.
 * If `family` already looks like a stack (contains a comma), return it as-is.
 */
export function buildMonoFontStack(family: string): string {
  const trimmed = family.trim()
  if (!trimmed) return DEFAULT_MONO_FONT_FAMILY
  if (trimmed.includes(",")) return trimmed
  const quoted =
    trimmed.startsWith('"') || trimmed.startsWith("'")
      ? trimmed
      : `"${trimmed.replaceAll('"', '\\"')}"`
  return `${quoted}, ${MONO_FONT_FALLBACKS}`
}

/**
 * Common monospace faces checked when Local Font Access is unavailable
 * or returns an empty set. Only faces the browser can resolve are shown.
 */
export const CURATED_MONO_FONT_NAMES: readonly string[] = [
  DEFAULT_MONO_FONT_NAME,
  "SF Mono",
  "Menlo",
  "Monaco",
  "Cascadia Code",
  "Cascadia Mono",
  "Consolas",
  "Courier New",
  "DejaVu Sans Mono",
  "Fira Code",
  "Fira Mono",
  "Hack",
  "IBM Plex Mono",
  "Inconsolata",
  "JetBrains Mono",
  "Lucida Console",
  "Source Code Pro",
  "Ubuntu Mono",
]
