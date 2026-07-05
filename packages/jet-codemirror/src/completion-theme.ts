import { EditorView } from "@codemirror/view"
import type { JetTheme } from "./theme-types.js"

/** Class on CodeMirror's native autocomplete tooltip — styled via theme + globals.css. */
export const completionTooltipClass = "jet-completion-tooltip"

export function completionTooltipTheme(theme: JetTheme) {
  return EditorView.theme({
    ".cm-tooltip.cm-tooltip-autocomplete": {
      padding: 0,
      border: "none",
      backgroundColor: "transparent",
      fontSize: "var(--jet-fs-sm)",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": {
      margin: 0,
      padding: "0.25rem",
      listStyle: "none",
      maxHeight: "20rem",
      minWidth: "16rem",
      maxWidth: "min(28rem, 95vw)",
      overflowY: "auto",
      backgroundColor: theme.colors.panelRaised,
      color: theme.colors.text,
      border: `1px solid ${theme.colors.border}`,
      borderRadius: "var(--radius-md)",
      fontFamily: "var(--font-mono)",
      fontSize: "var(--jet-fs-sm)",
      boxShadow: "0 4px 12px rgb(0 0 0 / 0.15)",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
      display: "flex",
      alignItems: "center",
      gap: "0.5rem",
      padding: "0.375rem 0.5rem",
      lineHeight: "1.25rem",
      borderRadius: "var(--radius-sm)",
      cursor: "pointer",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--accent)",
      color: "var(--accent-foreground)",
    },
    ".cm-tooltip.cm-tooltip-autocomplete .cm-completionLabel": {
      flex: "1 1 auto",
      minWidth: 0,
      overflow: "hidden",
      textOverflow: "ellipsis",
      color: "inherit",
      fontStyle: "normal",
    },
    ".cm-tooltip.cm-tooltip-autocomplete .cm-completionDetail": {
      flex: "0 0 auto",
      marginLeft: "auto",
      paddingLeft: "0.5rem",
      fontSize: "var(--jet-fs-2xs)",
      color: "var(--muted-foreground)",
      fontStyle: "normal",
    },
    ".cm-tooltip.cm-tooltip-autocomplete .cm-completionIcon": {
      opacity: 0.55,
      fontSize: "0.85em",
    },
    ".cm-tooltip.cm-completionInfo": {
      fontSize: "var(--jet-fs-xs)",
      fontFamily: "var(--font-mono)",
      backgroundColor: theme.colors.panelRaised,
      color: theme.colors.text,
      border: `1px solid ${theme.colors.border}`,
      borderRadius: "var(--radius-md)",
    },
  })
}
