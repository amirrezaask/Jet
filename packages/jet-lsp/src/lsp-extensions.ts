import { autocompletion, completionKeymap } from "@codemirror/autocomplete"
import { Prec } from "@codemirror/state"
import { keymap } from "@codemirror/view"
import {
  hoverTooltips,
  serverCompletionSource,
  serverDiagnostics,
  signatureHelp,
} from "@codemirror/lsp-client"

/** LSP client extensions — completion keymap at Prec.highest; Jet KeymapService mirrors Ctrl-Space. */
export function jetLanguageServerExtensions() {
  return [
    autocompletion({
      override: [serverCompletionSource],
      activateOnTyping: true,
      defaultKeymap: true,
      interactionDelay: 0,
    }),
    Prec.highest(keymap.of(completionKeymap)),
    hoverTooltips(),
    signatureHelp({ keymap: false }),
    serverDiagnostics(),
  ]
}
