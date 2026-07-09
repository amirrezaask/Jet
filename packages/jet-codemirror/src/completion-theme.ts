import { EditorView } from "@codemirror/view"

/** Class on CodeMirror's native autocomplete tooltip — hidden; Jet renders Radix ContextMenu. */
export const completionTooltipClass = "jet-completion-tooltip"

/** Hide CodeMirror's native autocomplete UI; completion is rendered in EditorTabHost. */
export function completionTooltipTheme() {
  return EditorView.theme({
    ".cm-tooltip.cm-tooltip-autocomplete": {
      display: "none !important",
    },
    ".cm-tooltip.cm-completionInfo": {
      display: "none !important",
    },
  })
}
