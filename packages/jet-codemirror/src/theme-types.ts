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

export const defaultJetTheme: JetTheme = {
  id: "default",
  name: "Default",
  colors: {
    bg: "#0a0a0c",
    panel: "#070709",
    panelRaised: "#141416",
    text: "#d6d4d0",
    textMuted: "#8a8680",
    accent: "#c4923a",
    hover: "#383028",
    selection: "#a87840",
    border: "#35302c",
    focusBorder: "#c4923acc",
    error: "#e06050",
    warning: "#e0a040",
    success: "#70c070",
    backdrop: "rgba(0,0,0,0.55)",
  },
  highlights: {
    keyword: "#82b8f0",
    controlKeyword: "#82b8f0",
    function: "#f0d070",
    type: "#d8b8f8",
    string: "#90e080",
    number: "#f0a858",
    boolean: "#f0a858",
    comment: "#8a8680",
    operator: "#c8c4bc",
    variable: "#c8c4bc",
    attribute: "#e8c060",
    constant: "#e8eeb8",
    field: "#f0e4c8",
    module: "#c8b0f0",
    label: "#c4923a",
  },
}

export function applyJetThemeCss(theme: JetTheme): void {
  const root = document.documentElement
  const c = theme.colors
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
  root.style.setProperty("--jet-cursor-color", c.accent)
  root.style.setProperty("--jet-row-height", "22px")
  root.style.setProperty("--background", c.bg)
  root.style.setProperty("--foreground", c.text)
  root.style.setProperty("--card", c.panelRaised)
  root.style.setProperty("--muted", c.panel)
  root.style.setProperty("--muted-foreground", c.textMuted)
  root.style.setProperty("--border", c.border)
  root.style.setProperty("--primary", c.accent)
  root.style.setProperty("--ring", c.focusBorder)
}
