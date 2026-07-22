import type { GharargahTheme } from "@gharargah/codemirror"
import {
  jetColorsFromShadcn,
  shadcnDefaultDark,
  shadcnDefaultLight,
} from "@gharargah/codemirror"
import {
  makeTheme,
  paletteAnsi,
  paletteHighlights,
} from "./theme-palette.js"

const shadcnSource = "https://ui.shadcn.com/themes"

const darkHighlights = paletteHighlights({
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
})

const lightHighlights = paletteHighlights({
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
})

const darkAnsi = paletteAnsi({
  black: "oklch(0.145 0 0)",
  red: "oklch(0.704 0.191 22.216)",
  green: "oklch(0.696 0.17 162.48)",
  yellow: "oklch(0.828 0.189 84.429)",
  blue: "oklch(0.623 0.214 259.815)",
  magenta: "oklch(0.792 0.209 303.407)",
  cyan: "oklch(0.696 0.17 162.48)",
  white: "oklch(0.985 0 0)",
  brightBlack: "oklch(0.708 0 0)",
  brightRed: "oklch(0.704 0.191 22.216)",
  brightGreen: "oklch(0.696 0.17 162.48)",
  brightYellow: "oklch(0.828 0.189 84.429)",
  brightBlue: "oklch(0.623 0.214 259.815)",
  brightMagenta: "oklch(0.792 0.209 303.407)",
  brightCyan: "oklch(0.696 0.17 162.48)",
  brightWhite: "oklch(1 0 0)",
})

const lightAnsi = paletteAnsi({
  black: "oklch(0.145 0 0)",
  red: "oklch(0.577 0.245 27.325)",
  green: "oklch(0.527 0.154 150.069)",
  yellow: "oklch(0.666 0.179 58.318)",
  blue: "oklch(0.488 0.243 264.376)",
  magenta: "oklch(0.496 0.265 301.924)",
  cyan: "oklch(0.527 0.154 150.069)",
  white: "oklch(0.985 0 0)",
  brightBlack: "oklch(0.556 0 0)",
  brightRed: "oklch(0.577 0.245 27.325)",
  brightGreen: "oklch(0.527 0.154 150.069)",
  brightYellow: "oklch(0.666 0.179 58.318)",
  brightBlue: "oklch(0.488 0.243 264.376)",
  brightMagenta: "oklch(0.496 0.265 301.924)",
  brightCyan: "oklch(0.527 0.154 150.069)",
  brightWhite: "oklch(1 0 0)",
})

function withShadcn(
  theme: GharargahTheme,
  tokens: typeof shadcnDefaultDark,
): GharargahTheme {
  return { ...theme, shadcn: tokens }
}

export const defaultDark = withShadcn(
  makeTheme({
    id: "default-dark",
    name: "Default Dark",
    family: "Default",
    scheme: "dark",
    sourceName: "shadcn/ui",
    sourceUrl: shadcnSource,
    license: "MIT",
    colors: jetColorsFromShadcn(shadcnDefaultDark, "dark"),
    highlights: darkHighlights,
    terminalAnsi: darkAnsi,
  }),
  shadcnDefaultDark,
)

export const defaultLight = withShadcn(
  makeTheme({
    id: "default-light",
    name: "Default Light",
    family: "Default",
    scheme: "light",
    sourceName: "shadcn/ui",
    sourceUrl: shadcnSource,
    license: "MIT",
    colors: jetColorsFromShadcn(shadcnDefaultLight, "light"),
    highlights: lightHighlights,
    terminalAnsi: lightAnsi,
  }),
  shadcnDefaultLight,
)

export const shadcnThemes = {
  [defaultDark.id]: defaultDark,
  [defaultLight.id]: defaultLight,
}

export const shadcnThemeList = [defaultDark, defaultLight]
