export {
  createJetEditorView,
  applyUserKeymaps,
  applyUserExtensions,
  applyTheme,
  reconfigureLsp,
  detachLsp,
  isLargeFile,
  openSearchPanel,
  userKeymapCompartment,
  extensionCompartment,
  lspCompartment,
  themeCompartment,
} from "./createEditorView.js"
export { detectIndent, indentUnitFor, type DetectedIndent } from "./detect-indent.js"
export { openReplaceSearchPanel, jumpToLine } from "./editor-actions.js"
export { setPendingEditorNavigation, consumePendingEditorNavigation } from "./editor-navigation.js"
export { setPendingInitialContent, consumePendingInitialContent } from "./pending-content.js"
export { collectProblemsFromViews, problemsFingerprint } from "./diagnostics.js"
export { motionCursor } from "./motion-cursor.js"
export { jetThemeExtension } from "./theme.js"
export { defaultJetTheme, applyJetThemeCss, applyColorScheme, isDarkTheme, type JetTheme, type JetColors, type JetHighlightColors, type ColorScheme } from "./theme-types.js"
export { loadLanguage } from "./languages.js"
export { simpleWebSocketTransport } from "./lsp-transport.js"
export type { LSPClient } from "@codemirror/lsp-client"
export {
  runFormatDocument,
  runRenameSymbol,
  runFindReferences,
  runParameterHints,
  runGoToDefinition,
  runGoToDeclaration,
  runGoToTypeDefinition,
  runGoToImplementation,
  runTriggerSuggest,
  runShowHover,
  lspPluginForView,
  fetchDocumentOutline,
  type OutlineSymbol,
} from "./lsp-editor-commands.js"
export { eolOverlayExtension, braceScopeExtension } from "./eol-overlays.js"
export { jetReloadAnnotation } from "./reload-annotation.js"
