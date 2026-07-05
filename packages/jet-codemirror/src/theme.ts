import { tags as t } from "@lezer/highlight"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { EditorView } from "@codemirror/view"
import { isDarkTheme, type JetTheme } from "./theme-types.js"

function buildHighlightStyle(theme: JetTheme): HighlightStyle {
  const c = theme.highlights
  return HighlightStyle.define([
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
    { tag: t.comment, color: c.comment, fontStyle: "italic" },
    { tag: t.operator, color: c.operator },
    { tag: t.punctuation, color: c.operator },
    { tag: t.bracket, color: c.operator },
    { tag: t.paren, color: c.operator },
    { tag: t.brace, color: c.operator },
    { tag: t.squareBracket, color: c.operator },
    { tag: t.character, color: c.string },
    { tag: t.macroName, color: c.function },
    { tag: t.self, color: c.keyword },
    { tag: t.definitionKeyword, color: c.keyword },
    { tag: t.moduleKeyword, color: c.controlKeyword },
    { tag: t.integer, color: c.number },
    { tag: t.float, color: c.number },
    { tag: t.lineComment, color: c.comment, fontStyle: "italic" },
    { tag: t.blockComment, color: c.comment, fontStyle: "italic" },
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
}

/** Must be registered after the language parser extension. */
export function jetSyntaxHighlightingForTheme(theme: JetTheme) {
  return syntaxHighlighting(buildHighlightStyle(theme), { fallback: true })
}

export function jetEditorTheme(theme: JetTheme) {
  const selectionBg = theme.colors.selection + "66"
  const activeLineBg = theme.colors.hover + "66"
  const selectionMatchBg = theme.colors.selection + "33"

  return EditorView.theme(
    {
      "&": {
        backgroundColor: theme.colors.panelRaised,
        color: theme.colors.text,
        height: "100%",
        width: "100%",
        minWidth: 0,
      },
      ".cm-scroller": {
        overflow: "auto",
        minHeight: 0,
        minWidth: 0,
      },
      ".cm-content": {
        caretColor: "transparent",
        fontFamily: '"Geist Mono", "IBM Plex Mono", "SFMono-Regular", monospace',
        fontSize: "1rem",
        whiteSpace: "pre",
      },
      ".cm-line": {
        whiteSpace: "pre",
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
        backgroundColor: theme.colors.hover,
        outline: "none",
        borderRadius: "2px",
      },
      ".cm-panel.cm-search, .jet-search-panel-hidden": {
        display: "none !important",
      },
      ".cm-indent-marker": {
        borderLeft: `1px solid ${theme.colors.border}`,
      },
      ".cm-eol-overlay-wrap": {
        pointerEvents: "none",
        userSelect: "none",
        marginLeft: "0.5ch",
        fontSize: "0.85em",
      },
      ".cm-eol-overlay": {
        marginLeft: "0.5ch",
      },
      ".cm-eol-overlay-type, .cm-eol-overlay-close-brace": {
        color: theme.colors.textMuted,
      },
      ".cm-eol-overlay-diagnostic-error": {
        color: theme.colors.error,
      },
      ".cm-eol-overlay-diagnostic-warning": {
        color: theme.colors.warning,
      },
      ".cm-eol-overlay-diagnostic-info": {
        color: theme.colors.textMuted,
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
      ".cm-tooltip.cm-completionInfo": {
        fontSize: "0.85rem",
        fontFamily: '"Geist Mono", "IBM Plex Mono", "SFMono-Regular", monospace',
      },
      ".cm-lsp-hover-tooltip, .cm-lsp-documentation": {
        fontSize: "0.85rem",
        fontFamily: '"Geist Mono", "IBM Plex Mono", "SFMono-Regular", monospace',
      },
      ".cm-lsp-signature-tooltip": {
        fontSize: "0.85rem",
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
    { dark: isDarkTheme(theme) },
  )
}

/** @deprecated Prefer jetEditorTheme + jetSyntaxHighlightingForTheme with language registered first. */
export function jetThemeExtension(theme: JetTheme) {
  return [jetEditorTheme(theme), jetSyntaxHighlightingForTheme(theme)]
}
