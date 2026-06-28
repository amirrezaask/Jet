import type { JetTheme } from "@jet/codemirror"
import { defaultJetTheme } from "@jet/codemirror"

export const bundledThemes: Record<string, JetTheme> = {
  default: defaultJetTheme,
  four_coder: {
    ...defaultJetTheme,
    id: "four_coder",
    name: "4coder",
    colors: {
      ...defaultJetTheme.colors,
      bg: "#0c0c0c",
      text: "#90b080",
      accent: "#3c57dc",
      panel: "#101010",
      panelRaised: "#181818",
      border: "#323232",
    },
  },
  catppuccin_mocha: {
    ...defaultJetTheme,
    id: "catppuccin_mocha",
    name: "Catppuccin Mocha",
    colors: {
      ...defaultJetTheme.colors,
      bg: "#1e1e2e",
      text: "#cdd6f4",
      accent: "#cba6f7",
      panel: "#181825",
      panelRaised: "#313244",
      border: "#45475a",
    },
  },
  one_dark: {
    ...defaultJetTheme,
    id: "one_dark",
    name: "One Dark",
    colors: {
      ...defaultJetTheme.colors,
      bg: "#282c34",
      text: "#abb2bf",
      accent: "#61afef",
      panel: "#21252b",
      panelRaised: "#2c313a",
      border: "#3e4451",
    },
  },
  gruvbox_dark: {
    ...defaultJetTheme,
    id: "gruvbox_dark",
    name: "Gruvbox Dark",
    colors: {
      ...defaultJetTheme.colors,
      bg: "#282828",
      text: "#ebdbb2",
      accent: "#b8bb26",
      panel: "#1d2021",
      panelRaised: "#32302f",
      border: "#504945",
    },
  },
  nord: {
    ...defaultJetTheme,
    id: "nord",
    name: "Nord",
    colors: {
      ...defaultJetTheme.colors,
      bg: "#2e3440",
      text: "#d8dee9",
      accent: "#88c0d0",
      panel: "#3b4252",
      panelRaised: "#434c5e",
      border: "#4c566a",
    },
  },
}

export { defaultJetTheme, applyJetThemeCss } from "@jet/codemirror"
