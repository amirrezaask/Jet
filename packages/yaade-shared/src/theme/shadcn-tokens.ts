/**
 * Shadcn-compatible semantic palette for YAADE's island workbench.
 *
 * The neutral ramp and focus blue are adapted from T3 Code's standard theme;
 * status colors stay purpose-built for readable badges, git state, and terminals.
 */
import { getDocumentElement } from "./dom-root.js"

export type YaadeSemanticTokens = {
  background: string
  foreground: string
  card: string
  cardForeground: string
  popover: string
  popoverForeground: string
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  muted: string
  mutedForeground: string
  accent: string
  accentForeground: string
  destructive: string
  destructiveForeground: string
  success: string
  successForeground: string
  warning: string
  warningForeground: string
  info: string
  infoForeground: string
  backdrop: string
  gitAdded: string
  gitAddedForeground: string
  gitModified: string
  gitModifiedForeground: string
  gitDeleted: string
  gitDeletedForeground: string
  gitConflict: string
  gitConflictForeground: string
  border: string
  input: string
  ring: string
  sidebar: string
  sidebarForeground: string
  sidebarPrimary: string
  sidebarPrimaryForeground: string
  sidebarAccent: string
  sidebarAccentForeground: string
  sidebarBorder: string
  sidebarRing: string
}

/** @deprecated Use `YaadeSemanticTokens`. */
export type JetShadcnTokens = YaadeSemanticTokens

export const shadcnDefaultLight: YaadeSemanticTokens = {
  background: "oklch(0.991069 0 89.876)",
  foreground: "oklch(0.273936 0.005477 286.033)",
  card: "oklch(1 0 89.876)",
  cardForeground: "oklch(0.273936 0.005477 286.033)",
  popover: "oklch(1 0 89.876)",
  popoverForeground: "oklch(0.273936 0.005477 286.033)",
  primary: "oklch(0.487701 0.217531 264.105)",
  primaryForeground: "oklch(1 0 89.876)",
  secondary: "oklch(0.985104 0 89.876)",
  secondaryForeground: "oklch(0.273936 0.005477 286.033)",
  muted: "oklch(0.985104 0 89.876)",
  mutedForeground: "oklch(0.552018 0.015347 285.886)",
  accent: "oklch(0.967434 0.001326 286.375)",
  accentForeground: "oklch(0.210331 0.00586 285.885)",
  destructive: "oklch(0.57924 0.192407 23.704)",
  destructiveForeground: "oklch(1 0 89.876)",
  success: "oklch(0.695873 0.149074 162.48)",
  successForeground: "oklch(0.267902 0.055926 159.604)",
  warning: "oklch(0.76859 0.164659 70.08)",
  warningForeground: "oklch(0.285655 0.063931 53.813)",
  info: "oklch(0.54615 0.215208 262.881)",
  infoForeground: "oklch(1 0 89.876)",
  backdrop: "rgba(0, 0, 0, 0.48)",
  gitAdded: "oklch(0.695873 0.149074 162.48)",
  gitAddedForeground: "oklch(0.267902 0.055926 159.604)",
  gitModified: "oklch(0.54615 0.215208 262.881)",
  gitModifiedForeground: "oklch(1 0 89.876)",
  gitDeleted: "oklch(0.57924 0.192407 23.704)",
  gitDeletedForeground: "oklch(1 0 89.876)",
  gitConflict: "oklch(0.76859 0.164659 70.08)",
  gitConflictForeground: "oklch(0.285655 0.063931 53.813)",
  border: "oklch(0.919729 0.004031 286.32)",
  input: "oklch(0.635019 0.007384 286.188)",
  ring: "oklch(0.487701 0.217531 264.105)",
  sidebar: "oklch(0.985104 0 89.876)",
  sidebarForeground: "oklch(0.273936 0.005477 286.033)",
  sidebarPrimary: "oklch(0.487701 0.217531 264.105)",
  sidebarPrimaryForeground: "oklch(1 0 89.876)",
  sidebarAccent: "oklch(0.967434 0.001326 286.375)",
  sidebarAccentForeground: "oklch(0.210331 0.00586 285.885)",
  sidebarBorder: "oklch(0.919729 0.004031 286.32)",
  sidebarRing: "oklch(0.487701 0.217531 264.105)",
}

export const shadcnDefaultDark: YaadeSemanticTokens = {
  background: "oklch(0.144788 0 89.876)",
  foreground: "oklch(0.970151 0 89.876)",
  card: "oklch(0.177638 0 89.876)",
  cardForeground: "oklch(0.970151 0 89.876)",
  popover: "oklch(0.213423 0 89.876)",
  popoverForeground: "oklch(0.970151 0 89.876)",
  primary: "oklch(0.570701 0.215599 264.003)",
  primaryForeground: "oklch(1 0 89.876)",
  secondary: "oklch(0.191251 0 89.876)",
  secondaryForeground: "oklch(0.970151 0 89.876)",
  muted: "oklch(0.191251 0 89.876)",
  mutedForeground: "oklch(0.603247 0 89.876)",
  accent: "oklch(0.221039 0.001537 197.045)",
  accentForeground: "oklch(0.970151 0 89.876)",
  destructive: "oklch(0.655108 0.221148 23.473)",
  destructiveForeground: "oklch(0.144788 0 89.876)",
  success: "oklch(0.695873 0.149074 162.48)",
  successForeground: "oklch(0.267902 0.055926 159.604)",
  warning: "oklch(0.76859 0.164659 70.08)",
  warningForeground: "oklch(0.285655 0.063931 53.813)",
  info: "oklch(0.623083 0.188015 259.815)",
  infoForeground: "oklch(0.144788 0 89.876)",
  backdrop: "rgba(0, 0, 0, 0.72)",
  gitAdded: "oklch(0.695873 0.149074 162.48)",
  gitAddedForeground: "oklch(0.267902 0.055926 159.604)",
  gitModified: "oklch(0.623083 0.188015 259.815)",
  gitModifiedForeground: "oklch(0.144788 0 89.876)",
  gitDeleted: "oklch(0.655108 0.221148 23.473)",
  gitDeletedForeground: "oklch(0.144788 0 89.876)",
  gitConflict: "oklch(0.76859 0.164659 70.08)",
  gitConflictForeground: "oklch(0.285655 0.063931 53.813)",
  border: "oklch(0.213423 0 89.876)",
  input: "oklch(0.503229 0 89.876)",
  ring: "oklch(0.570701 0.215599 264.003)",
  sidebar: "oklch(0 0 0)",
  sidebarForeground: "oklch(0.970151 0 89.876)",
  sidebarPrimary: "oklch(0.570701 0.215599 264.003)",
  sidebarPrimaryForeground: "oklch(1 0 89.876)",
  sidebarAccent: "oklch(0.186741 0 89.876)",
  sidebarAccentForeground: "oklch(0.970151 0 89.876)",
  sidebarBorder: "oklch(0.191251 0 89.876)",
  sidebarRing: "oklch(0.570701 0.215599 264.003)",
}

/**
 * Canvas consumers such as xterm do not consistently parse CSS Color 4.
 * Convert authored OKLCH tokens to a clipped sRGB color for compatibility
 * views while leaving the canonical semantic values untouched.
 */
export function toSrgbColor(value: string): string {
  const match = value.trim().match(
    /^oklch\(\s*([+-]?[\d.]+)(%)?\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)(?:\s*\/\s*([+-]?[\d.]+)(%)?)?\s*\)$/i,
  )
  if (!match) return value

  const lightness = Number(match[1]) / (match[2] ? 100 : 1)
  const chroma = Number(match[3])
  const hue = (Number(match[4]) * Math.PI) / 180
  const alpha = match[5]
    ? Number(match[5]) / (match[6] ? 100 : 1)
    : 1
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)

  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b
  const l = lPrime ** 3
  const m = mPrime ** 3
  const s = sPrime ** 3

  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  const channels = linear.map(channel => {
    const encoded =
      channel <= 0.0031308
        ? 12.92 * channel
        : 1.055 * channel ** (1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, encoded)) * 255)
  })
  if (alpha < 1) {
    return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${Math.min(1, Math.max(0, alpha))})`
  }
  return `#${channels.map(channel => channel.toString(16).padStart(2, "0")).join("")}`
}

export function applySemanticTokens(tokens: YaadeSemanticTokens): void {
  const root = getDocumentElement()
  if (!root) return
  root.style.setProperty("--background", tokens.background)
  root.style.setProperty("--foreground", tokens.foreground)
  root.style.setProperty("--card", tokens.card)
  root.style.setProperty("--card-foreground", tokens.cardForeground)
  root.style.setProperty("--popover", tokens.popover)
  root.style.setProperty("--popover-foreground", tokens.popoverForeground)
  root.style.setProperty("--primary", tokens.primary)
  root.style.setProperty("--primary-foreground", tokens.primaryForeground)
  root.style.setProperty("--secondary", tokens.secondary)
  root.style.setProperty("--secondary-foreground", tokens.secondaryForeground)
  root.style.setProperty("--muted", tokens.muted)
  root.style.setProperty("--muted-foreground", tokens.mutedForeground)
  root.style.setProperty("--accent", tokens.accent)
  root.style.setProperty("--accent-foreground", tokens.accentForeground)
  root.style.setProperty("--destructive", tokens.destructive)
  root.style.setProperty("--destructive-foreground", tokens.destructiveForeground)
  root.style.setProperty("--success", tokens.success)
  root.style.setProperty("--success-foreground", tokens.successForeground)
  root.style.setProperty("--warning", tokens.warning)
  root.style.setProperty("--warning-foreground", tokens.warningForeground)
  root.style.setProperty("--info", tokens.info)
  root.style.setProperty("--info-foreground", tokens.infoForeground)
  root.style.setProperty("--backdrop", tokens.backdrop)
  root.style.setProperty("--git-added", tokens.gitAdded)
  root.style.setProperty("--git-added-foreground", tokens.gitAddedForeground)
  root.style.setProperty("--git-modified", tokens.gitModified)
  root.style.setProperty("--git-modified-foreground", tokens.gitModifiedForeground)
  root.style.setProperty("--git-deleted", tokens.gitDeleted)
  root.style.setProperty("--git-deleted-foreground", tokens.gitDeletedForeground)
  root.style.setProperty("--git-conflict", tokens.gitConflict)
  root.style.setProperty("--git-conflict-foreground", tokens.gitConflictForeground)
  root.style.setProperty("--border", tokens.border)
  root.style.setProperty("--input", tokens.input)
  root.style.setProperty("--ring", tokens.ring)
  root.style.setProperty("--sidebar", tokens.sidebar)
  root.style.setProperty("--sidebar-foreground", tokens.sidebarForeground)
  root.style.setProperty("--sidebar-primary", tokens.sidebarPrimary)
  root.style.setProperty("--sidebar-primary-foreground", tokens.sidebarPrimaryForeground)
  root.style.setProperty("--sidebar-accent", tokens.sidebarAccent)
  root.style.setProperty("--sidebar-accent-foreground", tokens.sidebarAccentForeground)
  root.style.setProperty("--sidebar-border", tokens.sidebarBorder)
  root.style.setProperty("--sidebar-ring", tokens.sidebarRing)
}

/** @deprecated Use `applySemanticTokens`. */
export const applyShadcnTokens = applySemanticTokens

export function jetColorsFromTokens(tokens: YaadeSemanticTokens) {
  return {
    bg: toSrgbColor(tokens.background),
    panel: toSrgbColor(tokens.sidebar),
    panelRaised: toSrgbColor(tokens.card),
    text: toSrgbColor(tokens.foreground),
    textMuted: toSrgbColor(tokens.mutedForeground),
    accent: toSrgbColor(tokens.primary),
    hover: toSrgbColor(tokens.accent),
    selection: toSrgbColor(tokens.secondary),
    border: toSrgbColor(tokens.border),
    focusBorder: toSrgbColor(tokens.ring),
    error: toSrgbColor(tokens.destructive),
    warning: toSrgbColor(tokens.warning),
    success: toSrgbColor(tokens.success),
    backdrop: toSrgbColor(tokens.backdrop),
  }
}

/** @deprecated Use `jetColorsFromTokens`. */
export function jetColorsFromShadcn(
  tokens: YaadeSemanticTokens,
  _scheme?: "dark" | "light",
) {
  return jetColorsFromTokens(tokens)
}
