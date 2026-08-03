import {
  applyShadcnTokens,
  jetColorsFromShadcn,
  shadcnDefaultDark,
  type JetShadcnTokens,
} from "./shadcn-tokens.js"
import { getDocumentElement } from "./dom-root.js"

export type JetSemanticColors = {
  error: string
  warning: string
  success: string
  backdrop: string
}

export type JetColors = {
  bg: string
  panel: string
  panelRaised: string
  text: string
  textMuted: string
  accent: string
  hover: string
  selection: string
  border: string
  focusBorder: string
  error: string
  warning: string
  success: string
  backdrop: string
}

export type JetHighlightColors = {
  keyword: string
  controlKeyword: string
  function: string
  type: string
  string: string
  number: string
  boolean: string
  comment: string
  operator: string
  variable: string
  attribute: string
  constant: string
  field: string
  module: string
  label: string
}

export type JetTerminalAnsiColors = {
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export type { JetShadcnTokens }
export { shadcnDefaultDark, shadcnDefaultLight, jetColorsFromShadcn, applyShadcnTokens } from "./shadcn-tokens.js"

export type YaadeTheme = {
  id: string
  name: string
  scheme?: ColorScheme
  family?: string
  sourceName?: string
  sourceUrl?: string
  license?: string
  previewSwatches?: string[]
  terminalAnsi?: JetTerminalAnsiColors
  colors: JetColors
  highlights: JetHighlightColors
  /** When set, shell tokens use exact shadcn CSS variables. */
  shadcn?: JetShadcnTokens
}

export type ColorScheme = "dark" | "light"

/** Default dark — shadcn semantics tuned for Yaade (see yaade-ui/src/theme/shadcn.ts). */
export const defaultYaadeTheme: YaadeTheme = {
  id: "default-dark",
  name: "Default Dark",
  family: "Default",
  scheme: "dark",
  colors: jetColorsFromShadcn(shadcnDefaultDark, "dark"),
  shadcn: shadcnDefaultDark,
  highlights: {
    keyword: "oklch(0.704 0.191 22.216)",
    controlKeyword: "oklch(0.704 0.191 22.216)",
    function: "oklch(0.792 0.209 303.407)",
    type: "oklch(0.623 0.214 259.815)",
    string: "oklch(0.696 0.17 162.48)",
    number: "oklch(0.828 0.189 84.429)",
    boolean: "oklch(0.828 0.189 84.429)",
    comment: "oklch(0.708 0 0)",
    operator: "oklch(0.985 0 0)",
    variable: "oklch(0.985 0 0)",
    attribute: "oklch(0.792 0.209 303.407)",
    constant: "oklch(0.623 0.214 259.815)",
    field: "oklch(0.623 0.214 259.815)",
    module: "oklch(0.623 0.214 259.815)",
    label: "oklch(0.704 0.191 22.216)",
  },
}

export function isDarkTheme(theme: YaadeTheme): boolean {
  if (theme.scheme) return theme.scheme === "dark"
  return theme.id.includes("light") ? false : true
}

export function applyYaadeThemeCss(theme: YaadeTheme): void {
  const root = getDocumentElement()
  if (!root) return
  const c = theme.colors
  const onAccent = isDarkTheme(theme) ? "#000000" : "#fafafa"

  root.style.setProperty("--yaade-bg", c.bg)
  root.style.setProperty("--yaade-panel", c.panel)
  root.style.setProperty("--yaade-panel-raised", c.panelRaised)
  root.style.setProperty("--yaade-text", c.text)
  root.style.setProperty("--yaade-text-muted", c.textMuted)
  root.style.setProperty("--yaade-accent", c.accent)
  root.style.setProperty("--yaade-hover", c.hover)
  root.style.setProperty("--yaade-selection", c.selection)
  root.style.setProperty("--yaade-border", c.border)
  root.style.setProperty("--yaade-focus-border", c.focusBorder)
  root.style.setProperty("--yaade-error", c.error)
  root.style.setProperty("--yaade-warning", c.warning)
  root.style.setProperty("--yaade-success", c.success)
  root.style.setProperty("--yaade-backdrop", c.backdrop)
  root.style.setProperty("--yaade-cursor-color", c.text)

  if (theme.shadcn) {
    applyShadcnTokens(theme.shadcn)
  } else {
    root.style.setProperty("--background", c.bg)
    root.style.setProperty("--foreground", c.text)
    root.style.setProperty("--card", c.panelRaised)
    root.style.setProperty("--card-foreground", c.text)
    root.style.setProperty("--popover", c.panelRaised)
    root.style.setProperty("--popover-foreground", c.text)
    root.style.setProperty("--primary", c.accent)
    root.style.setProperty("--primary-foreground", onAccent)
    root.style.setProperty("--secondary", c.hover)
    root.style.setProperty("--secondary-foreground", c.text)
    root.style.setProperty("--muted", c.panel)
    root.style.setProperty("--muted-foreground", c.textMuted)
    root.style.setProperty("--accent", c.hover)
    root.style.setProperty("--accent-foreground", c.text)
    root.style.setProperty("--destructive", c.error)
    root.style.setProperty("--destructive-foreground", onAccent)
    root.style.setProperty("--border", c.border)
    root.style.setProperty("--input", c.border)
    root.style.setProperty("--ring", c.focusBorder)
    root.style.setProperty("--sidebar", c.panel)
    root.style.setProperty("--sidebar-foreground", c.text)
    root.style.setProperty("--sidebar-primary", c.accent)
    root.style.setProperty("--sidebar-primary-foreground", onAccent)
    root.style.setProperty("--sidebar-accent", c.hover)
    root.style.setProperty("--sidebar-accent-foreground", c.text)
    root.style.setProperty("--sidebar-border", c.border)
    root.style.setProperty("--sidebar-ring", c.focusBorder)
  }
  applyJetHighlightCssVars(theme)
  applyYaadeTerminalAnsiCssVars(theme)
  applyAgentChatCssVars(theme)
}

export function applyAgentChatCssVars(theme: YaadeTheme): void {
  const root = getDocumentElement()
  if (!root) return
  const c = theme.colors
  const dark = isDarkTheme(theme)

  root.style.setProperty("--agent-feed-bg", c.bg)
  root.style.setProperty("--agent-feed-primary", c.text)
  root.style.setProperty("--agent-feed-muted", c.textMuted)
  root.style.setProperty(
    "--agent-user-bubble",
    dark
      ? `color-mix(in srgb, ${c.hover} 75%, ${c.panel} 25%)`
      : `color-mix(in srgb, ${c.hover} 88%, ${c.panel} 12%)`,
  )
  root.style.setProperty(
    "--agent-composer-surface",
    dark
      ? `color-mix(in srgb, ${c.panelRaised} 72%, ${c.bg} 28%)`
      : `color-mix(in srgb, ${c.panelRaised} 65%, ${c.bg} 35%)`,
  )
  root.style.setProperty(
    "--agent-composer-border",
    `color-mix(in srgb, ${c.border} 80%, transparent)`,
  )
}

export function applyYaadeTerminalAnsiCssVars(theme: YaadeTheme): void {
  const ansi = theme.terminalAnsi
  const root = getDocumentElement()
  if (!root || !ansi) return
  const entries: [keyof JetTerminalAnsiColors, string][] = [
    ["black", ansi.black],
    ["red", ansi.red],
    ["green", ansi.green],
    ["yellow", ansi.yellow],
    ["blue", ansi.blue],
    ["magenta", ansi.magenta],
    ["cyan", ansi.cyan],
    ["white", ansi.white],
    ["brightBlack", ansi.brightBlack],
    ["brightRed", ansi.brightRed],
    ["brightGreen", ansi.brightGreen],
    ["brightYellow", ansi.brightYellow],
    ["brightBlue", ansi.brightBlue],
    ["brightMagenta", ansi.brightMagenta],
    ["brightCyan", ansi.brightCyan],
    ["brightWhite", ansi.brightWhite],
  ]
  for (const [key, value] of entries) {
    const cssKey = key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
    root.style.setProperty(`--yaade-terminal-ansi-${cssKey}`, value)
  }
}

export function applyJetHighlightCssVars(theme: YaadeTheme): void {
  const h = theme.highlights
  const root = getDocumentElement()
  if (!root) return
  root.style.setProperty("--yaade-hl-keyword", h.keyword)
  root.style.setProperty("--yaade-hl-control-keyword", h.controlKeyword)
  root.style.setProperty("--yaade-hl-function", h.function)
  root.style.setProperty("--yaade-hl-type", h.type)
  root.style.setProperty("--yaade-hl-string", h.string)
  root.style.setProperty("--yaade-hl-number", h.number)
  root.style.setProperty("--yaade-hl-boolean", h.boolean)
  root.style.setProperty("--yaade-hl-comment", h.comment)
  root.style.setProperty("--yaade-hl-operator", h.operator)
  root.style.setProperty("--yaade-hl-variable", h.variable)
  root.style.setProperty("--yaade-hl-attribute", h.attribute)
  root.style.setProperty("--yaade-hl-constant", h.constant)
  root.style.setProperty("--yaade-hl-field", h.field)
  root.style.setProperty("--yaade-hl-module", h.module)
  root.style.setProperty("--yaade-hl-label", h.label)
  root.style.setProperty("--yaade-hl-error", theme.colors.error)
}

export function applyColorScheme(scheme: ColorScheme, theme: YaadeTheme): void {
  const root = getDocumentElement()
  if (!root) return
  root.classList.toggle("dark", scheme === "dark")
  root.dataset.yaadeSurface = "default"
  applyYaadeThemeCss(theme)
}
