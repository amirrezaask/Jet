import type { JetShadcnTokens, YaadeTheme } from "@yaade/shared"
import { jetColorsFromShadcn } from "@yaade/shared"
import {
  makeTheme,
  paletteAnsi,
  paletteHighlights,
  type PaletteThemeInput,
} from "./theme-palette.js"

const SOURCE = "https://github.com/folke/tokyonight.nvim"
const LICENSE = "Apache-2.0"

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
      family: "TokyoNight",
      sourceName: "Tokyo Night",
      sourceUrl: SOURCE,
      license: LICENSE,
      colors: jetColorsFromShadcn(tokens, input.scheme),
    }),
    tokens,
  )
}

const nightTokens: JetShadcnTokens = {
  background: "#1a1b26",
  foreground: "#c0caf5",
  card: "#16161e",
  cardForeground: "#c0caf5",
  popover: "#16161e",
  popoverForeground: "#c0caf5",
  primary: "#7aa2f7",
  primaryForeground: "#1a1b26",
  secondary: "#292e42",
  secondaryForeground: "#c0caf5",
  muted: "#292e42",
  mutedForeground: "#565f89",
  accent: "#292e42",
  accentForeground: "#c0caf5",
  destructive: "#f7768e",
  destructiveForeground: "#1a1b26",
  border: "#15161e",
  input: "#15161e",
  ring: "#7aa2f7",
  sidebar: "#16161e",
  sidebarForeground: "#c0caf5",
  sidebarPrimary: "#7aa2f7",
  sidebarPrimaryForeground: "#1a1b26",
  sidebarAccent: "#292e42",
  sidebarAccentForeground: "#c0caf5",
  sidebarBorder: "#15161e",
  sidebarRing: "#7aa2f7",
}

const stormTokens: JetShadcnTokens = {
  background: "#24283b",
  foreground: "#c0caf5",
  card: "#1f2335",
  cardForeground: "#c0caf5",
  popover: "#1f2335",
  popoverForeground: "#c0caf5",
  primary: "#7aa2f7",
  primaryForeground: "#24283b",
  secondary: "#292e42",
  secondaryForeground: "#c0caf5",
  muted: "#292e42",
  mutedForeground: "#565f89",
  accent: "#292e42",
  accentForeground: "#c0caf5",
  destructive: "#f7768e",
  destructiveForeground: "#24283b",
  border: "#1f2335",
  input: "#1f2335",
  ring: "#7aa2f7",
  sidebar: "#1f2335",
  sidebarForeground: "#c0caf5",
  sidebarPrimary: "#7aa2f7",
  sidebarPrimaryForeground: "#24283b",
  sidebarAccent: "#292e42",
  sidebarAccentForeground: "#c0caf5",
  sidebarBorder: "#1f2335",
  sidebarRing: "#7aa2f7",
}

const dayTokens: JetShadcnTokens = {
  background: "#e1e2e7",
  foreground: "#3760bf",
  card: "#d0d5e3",
  cardForeground: "#3760bf",
  popover: "#d0d5e3",
  popoverForeground: "#3760bf",
  primary: "#2e7de9",
  primaryForeground: "#e1e2e7",
  secondary: "#c4c8da",
  secondaryForeground: "#3760bf",
  muted: "#c4c8da",
  mutedForeground: "#6172b0",
  accent: "#c4c8da",
  accentForeground: "#3760bf",
  destructive: "#f52a65",
  destructiveForeground: "#e1e2e7",
  border: "#a1a6c5",
  input: "#a1a6c5",
  ring: "#2e7de9",
  sidebar: "#d0d5e3",
  sidebarForeground: "#3760bf",
  sidebarPrimary: "#2e7de9",
  sidebarPrimaryForeground: "#e1e2e7",
  sidebarAccent: "#c4c8da",
  sidebarAccentForeground: "#3760bf",
  sidebarBorder: "#a1a6c5",
  sidebarRing: "#2e7de9",
}

const nightHighlights = paletteHighlights({
  keyword: "#bb9af7",
  function: "#7aa2f7",
  type: "#2ac3de",
  string: "#9ece6a",
  number: "#ff9e64",
  boolean: "#ff9e64",
  comment: "#565f89",
  operator: "#89ddff",
  variable: "#c0caf5",
  attribute: "#7dcfff",
  constant: "#ff9e64",
  field: "#73daca",
  module: "#7aa2f7",
  label: "#bb9af7",
})

const dayHighlights = paletteHighlights({
  keyword: "#9854f1",
  function: "#2e7de9",
  type: "#188092",
  string: "#587539",
  number: "#b15c00",
  comment: "#848cb5",
  operator: "#006a83",
  variable: "#3760bf",
  attribute: "#007197",
  constant: "#b15c00",
})

export const tokyoNightNight = build(
  {
    id: "tokyonight-night",
    name: "Tokyo Night",
    scheme: "dark",
    highlights: nightHighlights,
    terminalAnsi: paletteAnsi({
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    }),
  },
  nightTokens,
)

export const tokyoNightStorm = build(
  {
    id: "tokyonight-storm",
    name: "Tokyo Night Storm",
    scheme: "dark",
    highlights: nightHighlights,
    terminalAnsi: paletteAnsi({
      black: "#1d202f",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    }),
  },
  stormTokens,
)

export const tokyoNightDay = build(
  {
    id: "tokyonight-day",
    name: "Tokyo Night Day",
    scheme: "light",
    highlights: dayHighlights,
    terminalAnsi: paletteAnsi({
      black: "#e9e9ed",
      red: "#f52a65",
      green: "#587539",
      yellow: "#8c6c3e",
      blue: "#2e7de9",
      magenta: "#9854f1",
      cyan: "#007197",
      white: "#6172b0",
      brightBlack: "#a1a6c5",
      brightRed: "#f52a65",
      brightGreen: "#587539",
      brightYellow: "#8c6c3e",
      brightBlue: "#2e7de9",
      brightMagenta: "#9854f1",
      brightCyan: "#007197",
      brightWhite: "#3760bf",
    }),
  },
  dayTokens,
)

export const tokyoNightThemes = {
  [tokyoNightNight.id]: tokyoNightNight,
  [tokyoNightStorm.id]: tokyoNightStorm,
  [tokyoNightDay.id]: tokyoNightDay,
}

export const tokyoNightThemeList = [
  tokyoNightNight,
  tokyoNightStorm,
  tokyoNightDay,
]
