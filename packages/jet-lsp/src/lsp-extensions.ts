import { EditorState } from "@codemirror/state"
import {
  hoverTooltips,
  serverCompletionSource,
  serverDiagnostics,
  signatureHelp,
} from "@codemirror/lsp-client"

const semanticTokenTypes = [
  "namespace", "type", "class", "enum", "interface", "struct", "typeParameter",
  "parameter", "variable", "property", "enumMember", "event", "function", "method",
  "macro", "label", "comment", "string", "keyword", "number", "regexp", "operator", "decorator",
]

const semanticTokenModifiers = [
  "declaration", "definition", "readonly", "static", "deprecated", "abstract",
  "async", "modification", "documentation", "defaultLibrary",
]

const semanticTokenCapabilities = {
  clientCapabilities: {
    textDocument: {
      semanticTokens: {
        dynamicRegistration: false,
        requests: { full: true },
        tokenTypes: semanticTokenTypes,
        tokenModifiers: semanticTokenModifiers,
        formats: ["relative"],
        overlappingTokenSupport: false,
        multilineTokenSupport: false,
      },
    },
  },
}

/** LSP client extensions — merges server completions with language-pack sources. */
export function jetLanguageServerExtensions() {
  return [
    // LSPClient only keeps extensions that are arrays or have `.extension`;
    // bare FacetProvider values are dropped, so wrap languageData.
    [EditorState.languageData.of(() => [{ autocomplete: serverCompletionSource }])],
    hoverTooltips({ hoverTime: 750 }),
    signatureHelp({ keymap: false }),
    serverDiagnostics(),
    semanticTokenCapabilities,
  ]
}
