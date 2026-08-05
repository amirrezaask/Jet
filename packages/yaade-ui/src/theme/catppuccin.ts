import type { JetShadcnTokens, YaadeTheme } from "@yaade/shared"
import { jetColorsFromShadcn } from "@yaade/shared"
import {
  makeTheme,
  paletteAnsi,
  paletteHighlights,
  type PaletteThemeInput,
} from "./theme-palette.js"

const SOURCE = "https://github.com/catppuccin/catppuccin"
const LICENSE = "MIT"

function withShadcn(theme: YaadeTheme, tokens: JetShadcnTokens): YaadeTheme {
  return { ...theme, shadcn: tokens }
}

function build(
  input: Omit<
    PaletteThemeInput,
    "family" | "sourceName" | "sourceUrl" | "license" | "colors"
  >,
  tokens: JetShadcnTokens,
): YaadeTheme {
  return withShadcn(
    makeTheme({
      ...input,
      family: "Catppuccin",
      sourceName: "Catppuccin",
      sourceUrl: SOURCE,
      license: LICENSE,
      colors: jetColorsFromShadcn(tokens, input.scheme),
    }),
    tokens,
  )
}

const mochaTokens: JetShadcnTokens = {
  background: "#1e1e2e",
  foreground: "#cdd6f4",
  card: "#181825",
  cardForeground: "#cdd6f4",
  popover: "#313244",
  popoverForeground: "#cdd6f4",
  primary: "#89b4fa",
  primaryForeground: "#1e1e2e",
  secondary: "#313244",
  secondaryForeground: "#cdd6f4",
  muted: "#313244",
  mutedForeground: "#a6adc8",
  accent: "#45475a",
  accentForeground: "#cdd6f4",
  destructive: "#f38ba8",
  destructiveForeground: "#1e1e2e",
  border: "#45475a",
  input: "#45475a",
  ring: "#89b4fa",
  sidebar: "#181825",
  sidebarForeground: "#cdd6f4",
  sidebarPrimary: "#89b4fa",
  sidebarPrimaryForeground: "#1e1e2e",
  sidebarAccent: "#313244",
  sidebarAccentForeground: "#cdd6f4",
  sidebarBorder: "#45475a",
  sidebarRing: "#89b4fa",
}

const macchiatoTokens: JetShadcnTokens = {
  background: "#24273a",
  foreground: "#cad3f5",
  card: "#1e2030",
  cardForeground: "#cad3f5",
  popover: "#363a4f",
  popoverForeground: "#cad3f5",
  primary: "#8aadf4",
  primaryForeground: "#24273a",
  secondary: "#363a4f",
  secondaryForeground: "#cad3f5",
  muted: "#363a4f",
  mutedForeground: "#a5adcb",
  accent: "#494d64",
  accentForeground: "#cad3f5",
  destructive: "#ed8796",
  destructiveForeground: "#24273a",
  border: "#494d64",
  input: "#494d64",
  ring: "#8aadf4",
  sidebar: "#1e2030",
  sidebarForeground: "#cad3f5",
  sidebarPrimary: "#8aadf4",
  sidebarPrimaryForeground: "#24273a",
  sidebarAccent: "#363a4f",
  sidebarAccentForeground: "#cad3f5",
  sidebarBorder: "#494d64",
  sidebarRing: "#8aadf4",
}

const latteTokens: JetShadcnTokens = {
  background: "#eff1f5",
  foreground: "#4c4f69",
  card: "#e6e9ef",
  cardForeground: "#4c4f69",
  popover: "#dce0e8",
  popoverForeground: "#4c4f69",
  primary: "#1e66f5",
  primaryForeground: "#eff1f5",
  secondary: "#ccd0da",
  secondaryForeground: "#4c4f69",
  muted: "#ccd0da",
  mutedForeground: "#6c6f85",
  accent: "#bcc0cc",
  accentForeground: "#4c4f69",
  destructive: "#d20f39",
  destructiveForeground: "#eff1f5",
  border: "#bcc0cc",
  input: "#bcc0cc",
  ring: "#1e66f5",
  sidebar: "#e6e9ef",
  sidebarForeground: "#4c4f69",
  sidebarPrimary: "#1e66f5",
  sidebarPrimaryForeground: "#eff1f5",
  sidebarAccent: "#ccd0da",
  sidebarAccentForeground: "#4c4f69",
  sidebarBorder: "#bcc0cc",
  sidebarRing: "#1e66f5",
}

const mochaHighlights = paletteHighlights({
  keyword: "#cba6f7",
  function: "#89b4fa",
  type: "#f9e2af",
  string: "#a6e3a1",
  number: "#fab387",
  boolean: "#fab387",
  comment: "#6c7086",
  operator: "#89dceb",
  variable: "#cdd6f4",
  attribute: "#f5c2e7",
  constant: "#f9e2af",
  field: "#89b4fa",
  module: "#94e2d5",
  label: "#cba6f7",
})

const latteHighlights = paletteHighlights({
  keyword: "#8839ef",
  function: "#1e66f5",
  type: "#df8e1d",
  string: "#40a02b",
  number: "#fe640b",
  boolean: "#fe640b",
  comment: "#9ca0b0",
  operator: "#04a5e5",
  variable: "#4c4f69",
  attribute: "#ea76cb",
  constant: "#df8e1d",
  field: "#1e66f5",
  module: "#179299",
  label: "#8839ef",
})

export const catppuccinMocha = build(
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    scheme: "dark",
    highlights: mochaHighlights,
    terminalAnsi: paletteAnsi({
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#f5c2e7",
      cyan: "#94e2d5",
      white: "#a6adc8",
      brightBlack: "#585b70",
      brightRed: "#f37799",
      brightGreen: "#89d88b",
      brightYellow: "#ebd391",
      brightBlue: "#74a8fc",
      brightMagenta: "#f2aede",
      brightCyan: "#6bd7ca",
      brightWhite: "#bac2de",
    }),
  },
  mochaTokens,
)

export const catppuccinMacchiato = build(
  {
    id: "catppuccin-macchiato",
    name: "Catppuccin Macchiato",
    scheme: "dark",
    highlights: paletteHighlights({
      keyword: "#c6a0f6",
      function: "#8aadf4",
      type: "#eed49f",
      string: "#a6da95",
      number: "#f5a97f",
      comment: "#6e738d",
      operator: "#91d7e3",
      variable: "#cad3f5",
      attribute: "#f5bde6",
      constant: "#eed49f",
    }),
    terminalAnsi: paletteAnsi({
      black: "#494d64",
      red: "#ed8796",
      green: "#a6da95",
      yellow: "#eed49f",
      blue: "#8aadf4",
      magenta: "#f5bde6",
      cyan: "#8bd5ca",
      white: "#a5adcb",
      brightBlack: "#5b6078",
      brightRed: "#ed8796",
      brightGreen: "#a6da95",
      brightYellow: "#eed49f",
      brightBlue: "#8aadf4",
      brightMagenta: "#f5bde6",
      brightCyan: "#8bd5ca",
      brightWhite: "#b8c0e0",
    }),
  },
  macchiatoTokens,
)

export const catppuccinLatte = build(
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    scheme: "light",
    highlights: latteHighlights,
    terminalAnsi: paletteAnsi({
      black: "#5c5f77",
      red: "#d20f39",
      green: "#40a02b",
      yellow: "#df8e1d",
      blue: "#1e66f5",
      magenta: "#ea76cb",
      cyan: "#179299",
      white: "#acb0be",
      brightBlack: "#6c6f85",
      brightRed: "#d20f39",
      brightGreen: "#40a02b",
      brightYellow: "#df8e1d",
      brightBlue: "#1e66f5",
      brightMagenta: "#ea76cb",
      brightCyan: "#179299",
      brightWhite: "#bcc0cc",
    }),
  },
  latteTokens,
)

export const catppuccinThemes = {
  [catppuccinMocha.id]: catppuccinMocha,
  [catppuccinMacchiato.id]: catppuccinMacchiato,
  [catppuccinLatte.id]: catppuccinLatte,
}

export const catppuccinThemeList = [
  catppuccinMocha,
  catppuccinMacchiato,
  catppuccinLatte,
]
