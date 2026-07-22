import type {
  JetColors,
  JetHighlightColors,
  JetTerminalAnsiColors,
  GharargahTheme,
} from "@gharargah/codemirror"

export type ColorScheme = "dark" | "light"

type ThemeFamily =
  | "Default"
  | "Ayu"
  | "Everforest"
  | "Gruvbox"
  | "TokyoNight"
  | "RAD"
  | "Glass"

export type PaletteThemeInput = {
  id: string
  name: string
  family: ThemeFamily
  scheme: ColorScheme
  sourceName?: string
  sourceUrl?: string
  license?: string
  colors: JetColors
  highlights: JetHighlightColors
  terminalAnsi: JetTerminalAnsiColors
}

function swatches(theme: Pick<PaletteThemeInput, "colors" | "highlights" | "terminalAnsi">): string[] {
  return [
    theme.colors.bg,
    theme.colors.panel,
    theme.colors.text,
    theme.colors.accent,
    theme.highlights.keyword,
    theme.highlights.function,
    theme.highlights.string,
    theme.terminalAnsi.yellow,
    theme.terminalAnsi.cyan,
    theme.colors.error,
  ]
}

export function makeTheme(input: PaletteThemeInput): GharargahTheme {
  return {
    ...input,
    previewSwatches: swatches(input),
  }
}

export function paletteColors(input: {
  bg: string
  panel: string
  panelRaised: string
  text: string
  textMuted: string
  accent: string
  hover: string
  selection: string
  border: string
  focusBorder?: string
  error: string
  warning: string
  success: string
}): JetColors {
  return {
    ...input,
    focusBorder: input.focusBorder ?? input.accent,
    backdrop: "#00000080",
  }
}

export function paletteHighlights(input: {
  keyword: string
  controlKeyword?: string
  function: string
  type: string
  string: string
  number: string
  boolean?: string
  comment: string
  operator: string
  variable: string
  attribute?: string
  constant?: string
  field?: string
  module?: string
  label?: string
}): JetHighlightColors {
  return {
    keyword: input.keyword,
    controlKeyword: input.controlKeyword ?? input.keyword,
    function: input.function,
    type: input.type,
    string: input.string,
    number: input.number,
    boolean: input.boolean ?? input.number,
    comment: input.comment,
    operator: input.operator,
    variable: input.variable,
    attribute: input.attribute ?? input.function,
    constant: input.constant ?? input.type,
    field: input.field ?? input.type,
    module: input.module ?? input.type,
    label: input.label ?? input.keyword,
  }
}

export function paletteAnsi(input: {
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack?: string
  brightRed?: string
  brightGreen?: string
  brightYellow?: string
  brightBlue?: string
  brightMagenta?: string
  brightCyan?: string
  brightWhite?: string
}): JetTerminalAnsiColors {
  return {
    ...input,
    brightBlack: input.brightBlack ?? input.black,
    brightRed: input.brightRed ?? input.red,
    brightGreen: input.brightGreen ?? input.green,
    brightYellow: input.brightYellow ?? input.yellow,
    brightBlue: input.brightBlue ?? input.blue,
    brightMagenta: input.brightMagenta ?? input.magenta,
    brightCyan: input.brightCyan ?? input.cyan,
    brightWhite: input.brightWhite ?? input.white,
  }
}
