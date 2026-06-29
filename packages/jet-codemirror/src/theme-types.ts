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
  name: "Machined Instrument",
  colors: {
    bg: "#0B0D10",
    panel: "#11151A",
    panelRaised: "#151A20",
    text: "#D6D8D2",
    textMuted: "#8B929C",
    accent: "#C99A45",
    hover: "#1D242C",
    selection: "#6F5A2F",
    border: "#2A3138",
    focusBorder: "#C99A45CC",
    error: "#E06B5F",
    warning: "#D1A247",
    success: "#77BE88",
    backdrop: "rgba(6,8,10,0.72)",
  },
  highlights: {
    keyword: "#8AA6C1",
    controlKeyword: "#8AA6C1",
    function: "#D8BA74",
    type: "#C9B791",
    string: "#87B77D",
    number: "#D9A56A",
    boolean: "#D9A56A",
    comment: "#6D7681",
    operator: "#C3C6C0",
    variable: "#D6D8D2",
    attribute: "#C9B791",
    constant: "#E0D0A2",
    field: "#E5E3DB",
    module: "#B29D7A",
    label: "#C99A45",
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
