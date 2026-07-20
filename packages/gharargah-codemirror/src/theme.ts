import { tags as t } from "@lezer/highlight"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { EditorView } from "@codemirror/view"
import { isDarkTheme, type GharargahTheme } from "./theme-types.js"

function buildHighlightStyle(theme: GharargahTheme): HighlightStyle {
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
export function jetSyntaxHighlightingForTheme(theme: GharargahTheme) {
  return syntaxHighlighting(buildHighlightStyle(theme), { fallback: true })
}

export function jetEditorTheme(theme: GharargahTheme) {
  const selectionBg = theme.colors.selection + "66"
  const activeLineBg = theme.colors.hover + "66"
  const selectionMatchBg = theme.colors.selection + "33"

  return EditorView.theme(
    {
      "&": {
        backgroundColor: theme.colors.bg,
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
        caretColor: theme.colors.accent,
        fontFamily: "var(--font-mono, 'Geist Mono', 'IBM Plex Mono', 'SFMono-Regular', monospace)",
        fontSize: "var(--gharargah-editor-fs, 1rem)",
        lineHeight: "var(--gharargah-editor-line-height, 1.45)",
        whiteSpace: "pre",
      },
      ".cm-line": {
        lineHeight: "var(--gharargah-editor-line-height, 1.45)",
        whiteSpace: "pre",
      },
      ".cm-gutters": {
        backgroundColor: theme.colors.panel,
        color: theme.colors.textMuted,
        border: "none",
        fontSize: "var(--gharargah-editor-fs, 1rem)",
        paddingRight: "1rem",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        paddingLeft: "0.5rem",
        paddingRight: "0.75rem",
        minWidth: "2.5em",
      },
      ".cm-activeLineGutter": { backgroundColor: activeLineBg },
      ".cm-activeLine": { backgroundColor: activeLineBg },
      ".cm-matchingBracket, .cm-nonmatchingBracket": {
        backgroundColor: theme.colors.hover,
        outline: "none",
        borderRadius: "2px",
      },
      ".cm-panel.cm-search, \.gharargah-search-panel-hidden": {
        display: "none !important",
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
      ".cm-tooltip": {
        backgroundColor: theme.colors.panelRaised,
        color: theme.colors.text,
        border: `1px solid ${theme.colors.border}`,
        fontSize: "var(--gharargah-editor-fs, 1rem)",
      },
      ".cm-tooltip.cm-completionInfo": {
        fontSize: "var(--gharargah-fs-sm, 0.85rem)",
        fontFamily: "var(--font-mono, 'Geist Mono', 'IBM Plex Mono', 'SFMono-Regular', monospace)",
      },
      ".cm-lsp-hover-tooltip, .cm-lsp-documentation": {
        fontSize: "var(--gharargah-fs-sm, 0.85rem)",
        fontFamily: "var(--font-mono, 'Geist Mono', 'IBM Plex Mono', 'SFMono-Regular', monospace)",
      },
      ".cm-tooltip.cm-lsp-signature-tooltip, .cm-lsp-signature-tooltip": {
        maxWidth: "min(40rem, calc(100vw - 2rem))",
        padding: "6px 10px",
        borderRadius: "6px",
        boxShadow:
          "0 14px 38px color-mix(in srgb, var(--gharargah-bg) 68%, transparent), 0 1px 0 color-mix(in srgb, white 6%, transparent) inset",
        fontSize: "var(--gharargah-fs-sm, 0.85rem)",
        fontFamily: "var(--font-mono, 'Geist Mono', 'IBM Plex Mono', 'SFMono-Regular', monospace)",
        lineHeight: "1.45",
      },
      ".cm-lsp-signature-tooltip .cm-lsp-signature": {
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      },
      ".cm-lsp-signature-tooltip .cm-lsp-active-parameter": {
        color: theme.colors.accent,
        fontWeight: "650",
        textDecoration: "underline",
        textUnderlineOffset: "2px",
      },
      ".cm-lsp-signature-tooltip .cm-lsp-signature-num": {
        color: theme.colors.textMuted,
        fontSize: "var(--gharargah-fs-2xs, 0.77rem)",
        marginBottom: "2px",
      },
      ".cm-lsp-signature-tooltip .cm-lsp-signature-documentation": {
        marginTop: "6px",
        paddingTop: "6px",
        borderTop: `1px solid ${theme.colors.border}`,
        color: theme.colors.textMuted,
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
      ".cm-cursor, .cm-dropCursor": {
        borderLeftWidth: "2px",
        borderLeftColor: theme.colors.accent,
        marginLeft: "-1px",
      },
    },
    { dark: isDarkTheme(theme) },
  )
}

/** @deprecated Prefer jetEditorTheme + jetSyntaxHighlightingForTheme with language registered first. */
export function jetThemeExtension(theme: GharargahTheme) {
  return [jetEditorTheme(theme), jetSyntaxHighlightingForTheme(theme)]
}
