import { tags as t } from "@lezer/highlight"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { EditorView } from "@codemirror/view"
import type { JetTheme } from "./theme-types.js"

export function jetThemeExtension(theme: JetTheme) {
  const c = theme.highlights
  const selectionBg = theme.colors.selection + "66"
  const activeLineBg = theme.colors.hover + "66"
  const selectionMatchBg = theme.colors.selection + "33"

  const highlightStyle = HighlightStyle.define([
    { tag: t.keyword, color: c.keyword },
    { tag: [t.controlKeyword, t.modifier], color: c.controlKeyword },
    { tag: t.function(t.variableName), color: c.function },
    { tag: t.function(t.definition(t.variableName)), color: c.function },
    { tag: [t.typeName, t.className], color: c.type },
    { tag: t.definition(t.typeName), color: c.type },
    { tag: t.string, color: c.string },
    { tag: [t.special(t.string), t.escape], color: c.string },
    { tag: t.regexp, color: c.string },
    { tag: t.number, color: c.number },
    { tag: t.bool, color: c.boolean },
    { tag: t.comment, color: c.comment },
    { tag: t.operator, color: c.operator },
    { tag: t.punctuation, color: c.operator },
    { tag: t.variableName, color: c.variable },
    { tag: t.definition(t.variableName), color: c.variable },
    { tag: t.local(t.variableName), color: c.variable },
    { tag: t.attributeName, color: c.attribute },
    { tag: t.tagName, color: c.type },
    { tag: t.angleBracket, color: c.operator },
    { tag: t.constant(t.name), color: c.constant },
    { tag: t.propertyName, color: c.field },
    { tag: t.namespace, color: c.module },
    { tag: t.labelName, color: c.label },
    { tag: t.meta, color: c.comment },
    { tag: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4], color: c.keyword },
    { tag: [t.emphasis, t.strong], color: c.variable },
    { tag: t.link, color: c.function },
    { tag: t.invalid, color: theme.colors.error },
  ])

  return [
    EditorView.theme(
      {
        "&": {
          backgroundColor: theme.colors.bg,
          color: theme.colors.text,
          height: "100%",
        },
        ".cm-content": {
          caretColor: "transparent",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "1rem",
        },
        ".cm-gutters": {
          backgroundColor: theme.colors.panel,
          color: theme.colors.textMuted,
          border: "none",
          fontSize: "1rem",
        },
        ".cm-activeLineGutter": { backgroundColor: activeLineBg },
        ".cm-activeLine": { backgroundColor: activeLineBg },
        ".cm-matchingBracket, .cm-nonmatchingBracket": {
          backgroundColor: "transparent",
          outline: `1px solid ${theme.colors.accent}`,
          borderRadius: "2px",
        },
        ".cm-panel.cm-search": {
          backgroundColor: theme.colors.panelRaised,
          color: theme.colors.text,
          border: `1px solid ${theme.colors.border}`,
          fontSize: "1rem",
        },
        ".cm-panel.cm-search input": {
          backgroundColor: theme.colors.panel,
          color: theme.colors.text,
          border: `1px solid ${theme.colors.border}`,
        },
        ".cm-panel.cm-search button": {
          backgroundColor: theme.colors.panel,
          color: theme.colors.text,
          border: `1px solid ${theme.colors.border}`,
        },
        ".cm-indent-marker": {
          borderLeft: `1px solid ${theme.colors.border}`,
        },
        ".cm-close-brace-virtual": {
          color: theme.colors.textMuted,
          pointerEvents: "none",
          userSelect: "none",
        },
        ".cm-brace-guide-line": {
          borderLeft: `1px solid ${theme.colors.border}`,
          marginLeft: "2px",
        },
        ".cm-tooltip": {
          backgroundColor: theme.colors.panelRaised,
          color: theme.colors.text,
          border: `1px solid ${theme.colors.border}`,
          fontSize: "1rem",
        },
        ".cm-tooltip-autocomplete": {
          fontSize: "1rem",
          "& > ul": {
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "1rem",
          },
          "& > ul > li[aria-selected]": {
            backgroundColor: theme.colors.hover,
            color: theme.colors.text,
          },
        },
        ".cm-tooltip.cm-completionInfo": {
          fontSize: "1rem",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        },
        ".cm-lsp-hover-tooltip, .cm-lsp-documentation": {
          fontSize: "1rem",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        },
        ".cm-lsp-signature-tooltip": {
          fontSize: "1rem",
        },
        ".cm-completionLabel": {
          color: theme.colors.text,
        },
        ".cm-completionDetail": {
          color: theme.colors.textMuted,
          fontStyle: "italic",
        },
        ".cm-selectionBackground, .cm-content ::selection": {
          backgroundColor: selectionBg,
        },
        "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
          backgroundColor: selectionBg,
        },
        ".cm-selectionMatch": {
          backgroundColor: selectionMatchBg,
        },
        ".cm-cursor": { visibility: "hidden" },
      },
      { dark: true },
    ),
    syntaxHighlighting(highlightStyle),
  ]
}
