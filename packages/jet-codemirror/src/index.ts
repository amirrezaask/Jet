export {
  createJetEditorView,
  applyUserKeymaps,
  applyUserExtensions,
  applyTheme,
  reconfigureLanguage,
  reconfigureLsp,
  detachLsp,
  isLargeFile,
  openSearchPanel,
  setReadOnly,
  setLineWrapping,
  userKeymapCompartment,
  extensionCompartment,
  lspCompartment,
  themeCompartment,
  highlightCompartment,
  languageCompartment,
  readOnlyCompartment,
  lineWrappingCompartment,
} from "./createEditorView.js"
export { detectIndent, indentUnitFor, type DetectedIndent } from "./detect-indent.js"
export { openReplaceSearchPanel, jumpToLine } from "./editor-actions.js"
export {
  openJetSearch,
  closeJetSearch,
  closeJetSearchForView,
  subscribeSearch,
  patchJetSearchQuery,
  getJetSearchState,
  getSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  replaceAllPreserveCase,
  type JetSearchMode,
  type JetSearchState,
} from "./search-bridge.js"
export { setPendingEditorNavigation, consumePendingEditorNavigation } from "./editor-navigation.js"
export { setPendingInitialContent, consumePendingInitialContent } from "./pending-content.js"
export { collectProblemsFromViews, problemsFingerprint } from "./diagnostics.js"
export { motionCursor } from "./motion-cursor.js"
export { smoothEditorScroll } from "./smooth-scroll.js"
export { definitionLink } from "./definition-link.js"
export { inlayHints } from "./inlay-hints.js"
export { semanticTokens } from "./semantic-tokens.js"
export { jetThemeExtension, jetEditorTheme, jetSyntaxHighlightingForTheme } from "./theme.js"
export { defaultJetTheme, applyJetThemeCss, applyColorScheme, isDarkTheme, type JetTheme, type JetColors, type JetHighlightColors, type JetTerminalAnsiColors, type JetShadcnTokens, type ColorScheme, shadcnDefaultDark, shadcnDefaultLight, jetColorsFromShadcn, applyShadcnTokens } from "./theme-types.js"
export { loadLanguage } from "./languages.js"
export { simpleWebSocketTransport } from "./lsp-transport.js"
export type { LSPClient } from "@codemirror/lsp-client"
export {
  runFormatDocument,
  runRenameSymbol,
  requestFindReferences,
  runParameterHints,
  requestGoToDefinition,
  runGoToDeclaration,
  runGoToTypeDefinition,
  runGoToImplementation,
  runTriggerSuggest,
  runShowHover,
  lspPluginForView,
  fetchDocumentOutline,
  fetchCodeActions,
  fetchInlayHints,
  fetchWorkspaceSymbols,
  type OutlineSymbol,
  type CodeAction,
  type InlayHint,
  type WorkspaceSymbol,
} from "./lsp-editor-commands.js"
export {
  symbolRangeAt,
  symbolTextAt,
  lspOffsetForSymbol,
  normalizeLspLocations,
  fetchLspReferences,
  fetchLspDefinitions,
  type LspLocation,
  type LspRange,
  type LspPosition,
} from "./lsp-locations.js"
export { completionTooltipClass, completionTooltipTheme } from "./completion-theme.js"
export { signatureHelpAfterComplete } from "./signature-help-trigger.js"
export { eolOverlayExtension } from "./eol-overlays.js"
export { jetReloadAnnotation } from "./reload-annotation.js"
export { skipNextOccurrence } from "./multi-cursor.js"
