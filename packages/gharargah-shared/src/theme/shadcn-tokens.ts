/** Shadcn-compatible semantic palette tuned for Gharargah's dense terminal UI. */
import { getDocumentElement } from "./dom-root.js"

export type JetShadcnTokens = {
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

export const shadcnDefaultLight: JetShadcnTokens = {
  background: "oklch(0.985 0.004 255)",
  foreground: "oklch(0.19 0.012 255)",
  card: "oklch(1 0 0)",
  cardForeground: "oklch(0.19 0.012 255)",
  popover: "oklch(1 0 0)",
  popoverForeground: "oklch(0.19 0.012 255)",
  primary: "oklch(0.48 0.16 255)",
  primaryForeground: "oklch(0.985 0.004 255)",
  secondary: "oklch(0.94 0.015 255)",
  secondaryForeground: "oklch(0.24 0.02 255)",
  muted: "oklch(0.95 0.01 255)",
  mutedForeground: "oklch(0.46 0.018 255)",
  accent: "oklch(0.925 0.03 255)",
  accentForeground: "oklch(0.22 0.025 255)",
  destructive: "oklch(0.54 0.2 25)",
  destructiveForeground: "oklch(0.985 0.004 255)",
  border: "oklch(0.84 0.015 255)",
  input: "oklch(0.64 0.02 255)",
  ring: "oklch(0.48 0.16 255)",
  sidebar: "oklch(0.96 0.008 255)",
  sidebarForeground: "oklch(0.19 0.012 255)",
  sidebarPrimary: "oklch(0.48 0.16 255)",
  sidebarPrimaryForeground: "oklch(0.985 0.004 255)",
  sidebarAccent: "oklch(0.91 0.025 255)",
  sidebarAccentForeground: "oklch(0.22 0.025 255)",
  sidebarBorder: "oklch(0.84 0.015 255)",
  sidebarRing: "oklch(0.48 0.16 255)",
}

export const shadcnDefaultDark: JetShadcnTokens = {
  background: "oklch(0.145 0.008 255)",
  foreground: "oklch(0.94 0.008 255)",
  card: "oklch(0.19 0.012 255)",
  cardForeground: "oklch(0.94 0.008 255)",
  popover: "oklch(0.2 0.014 255)",
  popoverForeground: "oklch(0.94 0.008 255)",
  primary: "oklch(0.72 0.14 250)",
  primaryForeground: "oklch(0.18 0.015 255)",
  secondary: "oklch(0.255 0.018 255)",
  secondaryForeground: "oklch(0.94 0.008 255)",
  muted: "oklch(0.235 0.012 255)",
  mutedForeground: "oklch(0.72 0.015 255)",
  accent: "oklch(0.285 0.035 250)",
  accentForeground: "oklch(0.95 0.008 255)",
  destructive: "oklch(0.7 0.17 25)",
  destructiveForeground: "oklch(0.145 0.008 255)",
  border: "oklch(0.32 0.015 255)",
  input: "oklch(0.48 0.02 255)",
  ring: "oklch(0.72 0.14 250)",
  sidebar: "oklch(0.18 0.012 255)",
  sidebarForeground: "oklch(0.94 0.008 255)",
  sidebarPrimary: "oklch(0.72 0.14 250)",
  sidebarPrimaryForeground: "oklch(0.18 0.015 255)",
  sidebarAccent: "oklch(0.27 0.03 250)",
  sidebarAccentForeground: "oklch(0.95 0.008 255)",
  sidebarBorder: "oklch(0.32 0.015 255)",
  sidebarRing: "oklch(0.72 0.14 250)",
}

export function applyShadcnTokens(tokens: JetShadcnTokens): void {
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

export function jetColorsFromShadcn(tokens: JetShadcnTokens, scheme: "dark" | "light") {
  return {
    bg: tokens.background,
    panel: tokens.sidebar,
    panelRaised: tokens.card,
    text: tokens.foreground,
    textMuted: tokens.mutedForeground,
    accent: tokens.primary,
    hover: tokens.accent,
    selection: tokens.secondary,
    border: tokens.border,
    focusBorder: tokens.ring,
    error: tokens.destructive,
    warning: scheme === "dark" ? "oklch(0.828 0.189 84.429)" : "oklch(0.666 0.179 58.318)",
    success: scheme === "dark" ? "oklch(0.696 0.17 162.48)" : "oklch(0.527 0.154 150.069)",
    backdrop: scheme === "dark" ? "oklch(0 0 0 / 60%)" : "oklch(0 0 0 / 40%)",
  }
}
