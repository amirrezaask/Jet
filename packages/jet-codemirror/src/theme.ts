import { tags as t } from "@lezer/highlight"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { EditorView } from "@codemirror/view"
import type { JetTheme } from "./theme-types.js"

export function jetThemeExtension(theme: JetTheme) {
  const c = theme.highlights
  const highlightStyle = HighlightStyle.define([
    { tag: t.keyword, color: c.keyword },
    { tag: [t.controlKeyword, t.modifier], color: c.controlKeyword },
    { tag: t.function(t.variableName), color: c.function },
    { tag: [t.typeName, t.className], color: c.type },
    { tag: t.string, color: c.string },
    { tag: t.number, color: c.number },
    { tag: t.bool, color: c.boolean },
    { tag: t.comment, color: c.comment },
    { tag: t.operator, color: c.operator },
    { tag: t.variableName, color: c.variable },
    { tag: t.attributeName, color: c.attribute },
    { tag: t.constant(t.name), color: c.constant },
    { tag: t.propertyName, color: c.field },
    { tag: t.namespace, color: c.module },
    { tag: t.labelName, color: c.label },
  ])

  return [
    EditorView.theme({
      "&": {
        backgroundColor: theme.colors.bg,
        color: theme.colors.text,
        height: "100%",
      },
      ".cm-content": {
        caretColor: "transparent",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "13px",
      },
      ".cm-gutters": {
        backgroundColor: theme.colors.panel,
        color: theme.colors.textMuted,
        border: "none",
      },
      ".cm-activeLineGutter": { backgroundColor: theme.colors.hover },
      ".cm-activeLine": { backgroundColor: theme.colors.hover },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: theme.colors.selection + "66",
      },
      ".cm-cursor": { visibility: "hidden" },
    }),
    syntaxHighlighting(highlightStyle),
  ]
}
