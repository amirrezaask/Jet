import { EditorState } from "@codemirror/state"
import {
  hoverTooltips,
  serverCompletionSource,
  serverDiagnostics,
  signatureHelp,
} from "@codemirror/lsp-client"

/** LSP client extensions — merges server completions with language-pack sources. */
export function jetLanguageServerExtensions() {
  return [
    EditorState.languageData.of(() => [{ autocomplete: serverCompletionSource }]),
    hoverTooltips(),
    signatureHelp({ keymap: false }),
    serverDiagnostics(),
  ]
}
