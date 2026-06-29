import {
  hoverTooltips,
  serverCompletion,
  serverDiagnostics,
  signatureHelp,
} from "@codemirror/lsp-client"

/** LSP client extensions without bundled keymaps — Jet KeymapService owns bindings. */
export function jetLanguageServerExtensions() {
  return [serverCompletion(), hoverTooltips(), signatureHelp({ keymap: false }), serverDiagnostics()]
}
