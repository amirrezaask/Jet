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

export type { JetShadcnTokens }
export { shadcnDefaultDark, shadcnDefaultLight, jetColorsFromShadcn, applyShadcnTokens } from "./shadcn-tokens.js"

export type JetTheme = {
  id: string
  name: string
  colors: JetColors
  highlights: JetHighlightColors
  /** When set, shell tokens use exact shadcn CSS variables. */
  shadcn?: JetShadcnTokens
}

export type ColorScheme = "dark" | "light"

/** Default dark — shadcn/ui palette (see jet-ui/src/theme/default.ts). */
export const defaultJetTheme: JetTheme = {
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

export function isDarkTheme(theme: JetTheme): boolean {
  return theme.id.includes("light") ? false : true
}

export function applyJetThemeCss(theme: JetTheme): void {
  const root = document.documentElement
  const c = theme.colors
  const onAccent = isDarkTheme(theme) ? "#000000" : "#fafafa"

  root.style.setProperty("--jet-bg", c.bg)
  root.style.setProperty("--jet-panel", c.panel)
  root.style.setProperty("--jet-panel-raised", c.panelRaised)
  root.style.setProperty("--jet-text", c.text)
  root.style.setProperty("--jet-text-muted", c.textMuted)
  root.style.setProperty("--jet-accent", c.accent)
  root.style.setProperty("--jet-hover", c.hover)
  root.style.setProperty("--jet-selection", c.selection)
  root.style.setProperty("--jet-border", c.border)
  root.style.setProperty("--jet-focus-border", c.focusBorder)
  root.style.setProperty("--jet-error", c.error)
  root.style.setProperty("--jet-warning", c.warning)
  root.style.setProperty("--jet-success", c.success)
  root.style.setProperty("--jet-backdrop", c.backdrop)
  root.style.setProperty("--jet-cursor-color", c.text)
  root.style.setProperty("--jet-row-height", "22px")

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

export function applyJetHighlightCssVars(theme: JetTheme): void {
  const h = theme.highlights
  const root = document.documentElement
  root.style.setProperty("--jet-hl-keyword", h.keyword)
  root.style.setProperty("--jet-hl-control-keyword", h.controlKeyword)
  root.style.setProperty("--jet-hl-function", h.function)
  root.style.setProperty("--jet-hl-type", h.type)
  root.style.setProperty("--jet-hl-string", h.string)
  root.style.setProperty("--jet-hl-number", h.number)
  root.style.setProperty("--jet-hl-boolean", h.boolean)
  root.style.setProperty("--jet-hl-comment", h.comment)
  root.style.setProperty("--jet-hl-operator", h.operator)
  root.style.setProperty("--jet-hl-variable", h.variable)
  root.style.setProperty("--jet-hl-attribute", h.attribute)
  root.style.setProperty("--jet-hl-constant", h.constant)
  root.style.setProperty("--jet-hl-field", h.field)
  root.style.setProperty("--jet-hl-module", h.module)
  root.style.setProperty("--jet-hl-label", h.label)
  root.style.setProperty("--jet-hl-error", theme.colors.error)
}

export function applyColorScheme(scheme: ColorScheme, theme: JetTheme): void {
  document.documentElement.classList.toggle("dark", scheme === "dark")
  applyJetThemeCss(theme)
}
