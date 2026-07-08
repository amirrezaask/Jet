import type { JetHighlightColors, JetTheme } from "@jet/codemirror"
import {
  jetColorsFromShadcn,
  shadcnDefaultDark,
  shadcnDefaultLight,
  type JetShadcnTokens,
} from "@jet/codemirror"

const defaultDarkSyntax: JetHighlightColors = {
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
}

const defaultLightSyntax: JetHighlightColors = {
  keyword: "oklch(0.577 0.245 27.325)",
  controlKeyword: "oklch(0.577 0.245 27.325)",
  function: "oklch(0.496 0.265 301.924)",
  type: "oklch(0.488 0.243 264.376)",
  string: "oklch(0.527 0.154 150.069)",
  number: "oklch(0.666 0.179 58.318)",
  boolean: "oklch(0.666 0.179 58.318)",
  comment: "oklch(0.556 0 0)",
  operator: "oklch(0.145 0 0)",
  variable: "oklch(0.145 0 0)",
  attribute: "oklch(0.496 0.265 301.924)",
  constant: "oklch(0.488 0.243 264.376)",
  field: "oklch(0.488 0.243 264.376)",
  module: "oklch(0.488 0.243 264.376)",
  label: "oklch(0.577 0.245 27.325)",
}

function buildDefaultTheme(
  id: string,
  name: string,
  shadcn: JetShadcnTokens,
  scheme: "dark" | "light",
  highlights: JetHighlightColors,
): JetTheme {
  return {
    id,
    name,
    colors: jetColorsFromShadcn(shadcn, scheme),
    highlights,
    shadcn,
  }
}

export const defaultDark: JetTheme = buildDefaultTheme(
  "default-dark",
  "Default Dark",
  shadcnDefaultDark,
  "dark",
  defaultDarkSyntax,
)

export const defaultLight: JetTheme = buildDefaultTheme(
  "default-light",
  "Default Light",
  shadcnDefaultLight,
  "light",
  defaultLightSyntax,
)

export type ColorScheme = "dark" | "light"

export const bundledThemes: Record<string, JetTheme> = {
  dark: defaultDark,
  light: defaultLight,
}

export function themeForScheme(scheme: ColorScheme): JetTheme {
  return scheme === "light" ? defaultLight : defaultDark
}
