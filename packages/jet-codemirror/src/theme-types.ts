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

export type JetTheme = {
  id: string
  name: string
  colors: JetColors
  highlights: JetHighlightColors
}

export type ColorScheme = "dark" | "light"

/** Vercel dark — canonical default (see vercel-theme/README.md). */
export const defaultJetTheme: JetTheme = {
  id: "vercel-dark",
  name: "Vercel Dark",
  colors: {
    bg: "#000000",
    panel: "#000000",
    panelRaised: "#0a0a0a",
    text: "#ededed",
    textMuted: "#a1a1a1",
    accent: "#ededed",
    hover: "#1a1a1a",
    selection: "#333333",
    border: "#333333",
    focusBorder: "#ededed",
    error: "#f56464",
    warning: "#f99902",
    success: "#58c760",
    backdrop: "rgba(0,0,0,0.6)",
  },
  highlights: {
    keyword: "#f05b8d",
    controlKeyword: "#f05b8d",
    function: "#b675f1",
    type: "#62a6ff",
    string: "#58c760",
    number: "#62a6ff",
    boolean: "#62a6ff",
    comment: "#a1a1a1",
    operator: "#ededed",
    variable: "#ededed",
    attribute: "#b675f1",
    constant: "#62a6ff",
    field: "#62a6ff",
    module: "#62a6ff",
    label: "#f05b8d",
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
