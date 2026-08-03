import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import { isDarkTheme, type YaadeTheme } from "@yaade/shared"
import { cssToHex, monacoCssColor } from "./css-color.js"
import { monacoLanguageId } from "./language.js"

export { cssToHex, monacoCssColor, oklchToSrgb } from "./css-color.js"

const registeredThemes = new Set<string>()

function tokenForeground(color: string, fallback: string): string {
  return monacoCssColor(color, undefined, fallback).slice(1)
}

/** Register (or re-register) a Yaade theme with Monaco. Returns the Monaco theme name. */
export function registerYaadeMonacoTheme(theme: YaadeTheme): string {
  const name = `yaade-${theme.id}`
  const dark = isDarkTheme(theme)
  const c = theme.colors
  const h = theme.highlights
  const textFallback = dark ? "#e5e5e5" : "#171717"
  const bgFallback = dark ? "#0a0a0a" : "#ffffff"
  const mutedFallback = dark ? "#a3a3a3" : "#737373"
  const safeBg = cssToHex(c.bg) ?? cssToHex(c.panel) ?? bgFallback
  const safeText = cssToHex(c.text) ?? textFallback
  const safeMuted = cssToHex(c.textMuted) ?? mutedFallback

  monaco.editor.defineTheme(name, {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "", foreground: safeText.slice(1) },
      {
        token: "comment",
        foreground: tokenForeground(h.comment, mutedFallback),
        fontStyle: "italic",
      },
      { token: "keyword", foreground: tokenForeground(h.keyword, safeText) },
      {
        token: "keyword.control",
        foreground: tokenForeground(h.controlKeyword, safeText),
      },
      {
        token: "keyword.operator",
        foreground: tokenForeground(h.operator, safeText),
      },
      { token: "operator", foreground: tokenForeground(h.operator, safeText) },
      { token: "delimiter", foreground: tokenForeground(h.operator, safeText) },
      { token: "string", foreground: tokenForeground(h.string, safeText) },
      {
        token: "string.escape",
        foreground: tokenForeground(h.string, safeText),
      },
      { token: "number", foreground: tokenForeground(h.number, safeText) },
      { token: "regexp", foreground: tokenForeground(h.string, safeText) },
      { token: "type", foreground: tokenForeground(h.type, safeText) },
      {
        token: "type.identifier",
        foreground: tokenForeground(h.type, safeText),
      },
      { token: "class", foreground: tokenForeground(h.type, safeText) },
      { token: "interface", foreground: tokenForeground(h.type, safeText) },
      { token: "function", foreground: tokenForeground(h.function, safeText) },
      { token: "method", foreground: tokenForeground(h.function, safeText) },
      { token: "variable", foreground: tokenForeground(h.variable, safeText) },
      {
        token: "variable.predefined",
        foreground: tokenForeground(h.constant, safeText),
      },
      { token: "constant", foreground: tokenForeground(h.constant, safeText) },
      { token: "property", foreground: tokenForeground(h.field, safeText) },
      {
        token: "attribute.name",
        foreground: tokenForeground(h.attribute, safeText),
      },
      { token: "namespace", foreground: tokenForeground(h.module, safeText) },
      { token: "tag", foreground: tokenForeground(h.type, safeText) },
      { token: "metatag", foreground: tokenForeground(h.label, safeText) },
      { token: "invalid", foreground: tokenForeground(c.error, "#ef4444") },
    ],
    colors: {
      "editor.background": safeBg,
      "editor.foreground": safeText,
      "editor.lineHighlightBackground": monacoCssColor(c.hover, "66", safeBg),
      "editorLineNumber.foreground": safeMuted,
      "editorLineNumber.activeForeground": safeText,
      "editorCursor.foreground": monacoCssColor(c.accent, undefined, "#3b82f6"),
      "editor.selectionBackground": monacoCssColor(c.selection, "99", "#3b82f666"),
      "editor.inactiveSelectionBackground": monacoCssColor(
        c.selection,
        "44",
        "#3b82f644",
      ),
      "editor.selectionHighlightBackground": monacoCssColor(
        c.selection,
        "33",
        "#3b82f633",
      ),
      "editor.findMatchBackground": monacoCssColor(c.accent, "55", "#3b82f655"),
      "editor.findMatchHighlightBackground": monacoCssColor(
        c.accent,
        "33",
        "#3b82f633",
      ),
      "editorBracketMatch.background": monacoCssColor(c.hover, "88", safeBg),
      "editorBracketMatch.border": monacoCssColor(
        c.focusBorder,
        undefined,
        "#3b82f6",
      ),
      "editorError.foreground": monacoCssColor(c.error, undefined, "#ef4444"),
      "editorWarning.foreground": monacoCssColor(c.warning, undefined, "#f59e0b"),
      "editorInfo.foreground": monacoCssColor(c.accent, undefined, "#3b82f6"),
      "editorHint.foreground": safeMuted,
      "editorGutter.background": monacoCssColor(c.panel, undefined, safeBg),
      "editorWidget.background": monacoCssColor(
        c.panelRaised,
        undefined,
        safeBg,
      ),
      "editorWidget.foreground": safeText,
      "editorWidget.border": monacoCssColor(c.border, undefined, safeMuted),
      "diffEditor.insertedTextBackground": monacoCssColor(
        c.success,
        "33",
        "#22c55e33",
      ),
      "diffEditor.removedTextBackground": monacoCssColor(
        c.error,
        "33",
        "#ef444433",
      ),
      "diffEditor.insertedLineBackground": monacoCssColor(
        c.success,
        "22",
        "#22c55e22",
      ),
      "diffEditor.removedLineBackground": monacoCssColor(
        c.error,
        "22",
        "#ef444422",
      ),
      "editorSuggestWidget.background": monacoCssColor(
        c.panelRaised,
        undefined,
        safeBg,
      ),
      "editorSuggestWidget.foreground": safeText,
      "editorSuggestWidget.border": monacoCssColor(c.border, undefined, safeMuted),
      "editorSuggestWidget.selectedBackground": monacoCssColor(
        c.hover,
        "cc",
        "#3b82f644",
      ),
      "editorSuggestWidget.highlightForeground": monacoCssColor(
        c.accent,
        undefined,
        "#3b82f6",
      ),
      "editorHoverWidget.background": monacoCssColor(
        c.panelRaised,
        undefined,
        safeBg,
      ),
      "editorHoverWidget.foreground": safeText,
      "editorHoverWidget.border": monacoCssColor(c.border, undefined, safeMuted),
      "minimap.background": monacoCssColor(c.panel, undefined, safeBg),
      "scrollbarSlider.background": monacoCssColor(c.textMuted, "44", "#a3a3a344"),
      "scrollbarSlider.hoverBackground": monacoCssColor(
        c.textMuted,
        "66",
        "#a3a3a366",
      ),
      "scrollbarSlider.activeBackground": monacoCssColor(
        c.textMuted,
        "88",
        "#a3a3a388",
      ),
      "focusBorder": monacoCssColor(c.focusBorder, undefined, "#3b82f6"),
      "input.background": monacoCssColor(c.panel, undefined, safeBg),
      "input.foreground": safeText,
      "input.border": monacoCssColor(c.border, undefined, safeMuted),
    },
  })

  registeredThemes.add(name)
  return name
}

/** Apply a Yaade theme to Monaco editors. */
export function applyYaadeMonacoTheme(theme: YaadeTheme): string {
  const name = registerYaadeMonacoTheme(theme)
  monaco.editor.setTheme(name)
  return name
}

export function yaadeMonacoThemeName(theme: YaadeTheme): string {
  return `yaade-${theme.id}`
}

export function isYaadeMonacoThemeRegistered(theme: YaadeTheme): boolean {
  return registeredThemes.has(yaadeMonacoThemeName(theme))
}

/** Set Monaco model language from a Yaade language id. */
export function setModelLanguage(
  model: monaco.editor.ITextModel,
  languageId: string,
): void {
  monaco.editor.setModelLanguage(model, monacoLanguageId(languageId))
}
