import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { applyAgentChatCssVars, defaultGharargahTheme, type GharargahTheme } from "./theme-types.js"

type MockRoot = {
  style: {
    setProperty(name: string, value: string): void
  }
  classList: { toggle(): void }
  dataset: Record<string, string | undefined>
}

function withMockDocument(run: (vars: Map<string, string>) => void): void {
  const vars = new Map<string, string>()
  const root: MockRoot = {
    style: {
      setProperty(name, value) {
        vars.set(name, value)
      },
    },
    classList: { toggle() {} },
    dataset: {},
  }
  const previous = (globalThis as { document?: { documentElement: MockRoot } }).document
  ;(globalThis as { document?: { documentElement: MockRoot } }).document = {
    documentElement: root,
  }
  try {
    run(vars)
  } finally {
    if (previous) {
      ;(globalThis as { document?: { documentElement: MockRoot } }).document = previous
    } else {
      delete (globalThis as { document?: unknown }).document
    }
  }
}

const lightTheme: GharargahTheme = {
  ...defaultGharargahTheme,
  id: "test-light",
  scheme: "light",
  colors: {
    ...defaultGharargahTheme.colors,
    bg: "#fafafa",
    panel: "#f4f4f5",
    panelRaised: "#ffffff",
    text: "#09090b",
    textMuted: "#71717a",
    hover: "#f4f4f5",
    border: "#e4e4e7",
  },
}

const altDarkTheme: GharargahTheme = {
  ...defaultGharargahTheme,
  id: "alt-dark",
  scheme: "dark",
  colors: {
    ...defaultGharargahTheme.colors,
    bg: "#05070c",
    panel: "#0a1018",
    panelRaised: "#0e1622",
    text: "#d8e6f7",
    textMuted: "#6b8499",
    hover: "#121c2c",
    border: "#1a2a3d",
  },
}

describe("applyAgentChatCssVars", () => {
  it("derives composer surface from active theme colors", () => {
    withMockDocument(vars => {
      applyAgentChatCssVars(lightTheme)
      const lightSurface = vars.get("--agent-composer-surface")
      assert.ok(lightSurface)
      assert.match(lightSurface, /#ffffff|#fafafa/i)

      applyAgentChatCssVars(altDarkTheme)
      const altSurface = vars.get("--agent-composer-surface")
      assert.ok(altSurface)
      assert.match(altSurface, /#0e1622|#05070c/i)

      applyAgentChatCssVars(defaultGharargahTheme)
      const darkSurface = vars.get("--agent-composer-surface")
      assert.ok(darkSurface)
      assert.notEqual(darkSurface, altSurface)
    })
  })
})
