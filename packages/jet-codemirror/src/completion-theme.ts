import { EditorView } from "@codemirror/view"

/** Class on CodeMirror's native autocomplete tooltip. */
export const completionTooltipClass = "jet-completion-tooltip"

/** Native CM completion stays on its fast state path; this only gives it Jet's visual language. */
export function completionTooltipTheme() {
  return EditorView.theme({
    ".cm-tooltip.cm-tooltip-autocomplete.jet-completion-tooltip": {
      minWidth: "18rem",
      maxWidth: "min(40rem, calc(100vw - 2rem))",
      overflow: "hidden",
      borderRadius: "6px",
      boxShadow: "0 14px 38px color-mix(in srgb, var(--jet-bg) 68%, transparent), 0 1px 0 color-mix(in srgb, white 6%, transparent) inset",
    },
    ".jet-completion-tooltip > ul": {
      maxHeight: "min(22rem, 42vh)",
      padding: "3px",
      fontFamily: "var(--font-mono)",
    },
    ".jet-completion-tooltip > ul > li": {
      minHeight: "24px",
      padding: "3px 8px 3px 4px",
      borderRadius: "3px",
      display: "flex",
      alignItems: "baseline",
      gap: "6px",
    },
    ".jet-completion-tooltip > ul > li[aria-selected]": {
      background: "color-mix(in srgb, var(--jet-accent) 18%, var(--jet-panel-raised))",
      color: "var(--jet-text)",
    },
    ".jet-completion-tooltip .cm-completionIcon": {
      width: "16px",
      opacity: "0.72",
      color: "var(--jet-accent)",
    },
    ".jet-completion-tooltip .cm-completionMatchedText": {
      color: "var(--jet-accent)",
      textDecoration: "none",
      fontWeight: "650",
    },
    ".jet-completion-tooltip .cm-completionDetail": {
      marginLeft: "auto",
      paddingLeft: "16px",
      opacity: "0.64",
      fontStyle: "normal",
    },
    ".cm-tooltip.cm-completionInfo": {
      maxWidth: "34rem",
      padding: "8px 10px",
      borderRadius: "6px",
      boxShadow: "0 14px 38px color-mix(in srgb, var(--jet-bg) 68%, transparent)",
      lineHeight: "1.45",
    },
  })
}
