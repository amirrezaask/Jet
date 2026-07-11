import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { showSignatureHelp, LSPPlugin } from "@codemirror/lsp-client"

const TRIGGER_CHARS = new Set(["(", ","])

/** After completion accept (and similar), upstream only auto-fires on `input.type`. */
export function signatureHelpAfterComplete(): Extension {
  return EditorView.updateListener.of(update => {
    if (!update.docChanged) return
    if (!LSPPlugin.get(update.view)) return
    const fromComplete = update.transactions.some(tr => tr.isUserEvent("input.complete"))
    if (!fromComplete) return
    let hit = false
    update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
      if (hit) return
      const text = inserted.toString()
      for (const ch of text) {
        if (TRIGGER_CHARS.has(ch)) {
          hit = true
          break
        }
      }
    })
    if (hit) showSignatureHelp(update.view)
  })
}
