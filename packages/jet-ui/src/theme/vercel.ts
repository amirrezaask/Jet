import type { JetHighlightColors, JetTheme } from "@jet/codemirror"

/** Palette from vercel-theme/README.md — single source for shell + CM syntax. */

const darkSyntax: JetHighlightColors = {
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
}

const lightSyntax: JetHighlightColors = {
  keyword: "#b32c62",
  controlKeyword: "#b32c62",
  function: "#7200c4",
  type: "#005ee9",
  string: "#397c3b",
  number: "#005ee9",
  boolean: "#005ee9",
  comment: "#666666",
  operator: "#171717",
  variable: "#171717",
  attribute: "#7200c4",
  constant: "#005ee9",
  field: "#005ee9",
  module: "#005ee9",
  label: "#b32c62",
}

export const vercelDark: JetTheme = {
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
  highlights: darkSyntax,
}

export const vercelLight: JetTheme = {
  id: "vercel-light",
  name: "Vercel Light",
  colors: {
    bg: "#ffffff",
    panel: "#fafafa",
    panelRaised: "#fafafa",
    text: "#171717",
    textMuted: "#666666",
    accent: "#171717",
    hover: "#f5f5f5",
    selection: "#cccccc",
    border: "#cccccc",
    focusBorder: "#171717",
    error: "#c62128",
    warning: "#9e5200",
    success: "#397c3b",
    backdrop: "rgba(0,0,0,0.4)",
  },
  highlights: lightSyntax,
}

export type ColorScheme = "dark" | "light"

export const bundledThemes: Record<string, JetTheme> = {
  dark: vercelDark,
  light: vercelLight,
}

export function themeForScheme(scheme: ColorScheme): JetTheme {
  return scheme === "light" ? vercelLight : vercelDark
}
