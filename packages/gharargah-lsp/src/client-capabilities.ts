/** Initialize params capabilities advertised to language servers. */
export const gharargahLspClientCapabilities = {
  textDocument: {
    synchronization: { dynamicRegistration: false, willSave: false, didSave: true, didClose: true },
    completion: {
      completionItem: { snippetSupport: true, documentationFormat: ["markdown", "plaintext"] },
    },
    hover: { contentFormat: ["markdown", "plaintext"] },
    signatureHelp: { signatureInformation: { documentationFormat: ["markdown", "plaintext"] } },
    definition: { linkSupport: true },
    declaration: { linkSupport: true },
    implementation: { linkSupport: true },
    references: {},
    documentSymbol: {},
    workspaceSymbol: {},
    rename: { prepareSupport: true },
    formatting: {},
    rangeFormatting: {},
    codeAction: {
      codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix", "refactor"] } },
    },
    publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } },
    semanticTokens: {
      requests: { full: true },
      tokenTypes: [
        "namespace", "type", "class", "enum", "interface", "struct", "typeParameter",
        "parameter", "variable", "property", "enumMember", "event", "function", "method",
        "macro", "label", "comment", "string", "keyword", "number", "regexp", "operator", "decorator",
      ],
      tokenModifiers: [
        "declaration", "definition", "readonly", "static", "deprecated", "abstract",
        "async", "modification", "documentation", "defaultLibrary",
      ],
      formats: ["relative"],
    },
    inlayHint: {},
  },
  workspace: {
    applyEdit: true,
    workspaceEdit: { documentChanges: true },
    workspaceFolders: true,
    configuration: true,
    symbol: {},
  },
  window: { showMessage: {}, workDoneProgress: true },
  general: { progress: true },
} as const
