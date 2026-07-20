import {
  applyShadcnTokens,
  jetColorsFromShadcn,
  shadcnDefaultDark,
  type JetShadcnTokens,
} from "./shadcn-tokens.js"

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

export type GharargahTheme = {
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

/** Default dark — shadcn/ui palette (see jet-ui/src/theme/default.ts). */
export const defaultGharargahTheme: GharargahTheme = {
  id: "default-dark",
  name: "Default Dark",
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

export function isDarkTheme(theme: GharargahTheme): boolean {
  if (theme.scheme) return theme.scheme === "dark"
  return theme.id.includes("light") ? false : true
}

export function applyGharargahThemeCss(theme: GharargahTheme): void {
  const root = document.documentElement
  const c = theme.colors
  const onAccent = isDarkTheme(theme) ? "#000000" : "#fafafa"

  root.style.setProperty("--gharargah-bg", c.bg)
  root.style.setProperty("--gharargah-panel", c.panel)
  root.style.setProperty("--gharargah-panel-raised", c.panelRaised)
  root.style.setProperty("--gharargah-text", c.text)
  root.style.setProperty("--gharargah-text-muted", c.textMuted)
  root.style.setProperty("--gharargah-accent", c.accent)
  root.style.setProperty("--gharargah-hover", c.hover)
  root.style.setProperty("--gharargah-selection", c.selection)
  root.style.setProperty("--gharargah-border", c.border)
  root.style.setProperty("--gharargah-focus-border", c.focusBorder)
  root.style.setProperty("--gharargah-error", c.error)
  root.style.setProperty("--gharargah-warning", c.warning)
  root.style.setProperty("--gharargah-success", c.success)
  root.style.setProperty("--gharargah-backdrop", c.backdrop)
  root.style.setProperty("--gharargah-cursor-color", c.text)

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
}

export function applyJetHighlightCssVars(theme: GharargahTheme): void {
  const h = theme.highlights
  const root = document.documentElement
  root.style.setProperty("--gharargah-hl-keyword", h.keyword)
  root.style.setProperty("--gharargah-hl-control-keyword", h.controlKeyword)
  root.style.setProperty("--gharargah-hl-function", h.function)
  root.style.setProperty("--gharargah-hl-type", h.type)
  root.style.setProperty("--gharargah-hl-string", h.string)
  root.style.setProperty("--gharargah-hl-number", h.number)
  root.style.setProperty("--gharargah-hl-boolean", h.boolean)
  root.style.setProperty("--gharargah-hl-comment", h.comment)
  root.style.setProperty("--gharargah-hl-operator", h.operator)
  root.style.setProperty("--gharargah-hl-variable", h.variable)
  root.style.setProperty("--gharargah-hl-attribute", h.attribute)
  root.style.setProperty("--gharargah-hl-constant", h.constant)
  root.style.setProperty("--gharargah-hl-field", h.field)
  root.style.setProperty("--gharargah-hl-module", h.module)
  root.style.setProperty("--gharargah-hl-label", h.label)
  root.style.setProperty("--gharargah-hl-error", theme.colors.error)
}

export function applyColorScheme(scheme: ColorScheme, theme: GharargahTheme): void {
  document.documentElement.classList.toggle("dark", scheme === "dark")
  applyGharargahThemeCss(theme)
}
