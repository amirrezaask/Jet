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
}

export { defaultJetTheme, applyJetThemeCss } from "@jet/codemirror"
