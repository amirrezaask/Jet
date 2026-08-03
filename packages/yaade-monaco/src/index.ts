export { monacoLanguageId, isLargeFile } from "./language.js"
export { setModelLanguage } from "./model-language.js"
export { ensureMonacoEnvironment, configureMonacoWorkers, type MonacoWorkerFactories } from "./monaco-env.js"
export {
  registerYaadeMonacoTheme,
  applyYaadeMonacoTheme,
  yaadeMonacoThemeName,
  isYaadeMonacoThemeRegistered,
} from "./theme.js"
export {
  MonacoModelRegistry,
  monacoModels,
  DIFF_ORIGINAL_SCHEME,
  DIFF_MODIFIED_SCHEME,
} from "./model-registry.js"
export {
  setPendingEditorNavigation,
  consumePendingEditorNavigation,
  setPendingInitialContent,
  consumePendingInitialContent,
  revealPosition,
  highlightRangeTemporarily,
  applyPendingNavigation,
  type PendingEditorNavigation,
} from "./navigation.js"
export {
  getActiveMonacoEditor,
  setActiveMonacoEditor,
  getEditorContent,
  setEditorContent,
  getCursorPosition,
  setCursorPosition,
  focusEditor,
  layoutEditor,
  triggerFind,
  triggerReplace,
  formatDocument,
  undoEditor,
  redoEditor,
  selectAll,
  getSelectedText,
  insertText,
  getEditorUri,
  isEditorFocused,
  getEditorSelectionRange,
  setEditorSelection,
  type MonacoEditorHandle,
} from "./editor-api.js"
export { MonacoEditorHost, type MonacoEditorHostProps } from "./MonacoEditorHost.js"
export { MonacoDiffEditorHost, type MonacoDiffEditorHostProps } from "./MonacoDiffEditorHost.js"
export {
  lspSeverityToMarkerSeverity,
  lspTagsToMarkerTags,
  lspRangeToMonacoRange,
  lspDiagnosticToMarker,
  markersForDiagnostics,
  LspDiagnosticSeverity,
  LspDiagnosticTag,
  MonacoMarkerSeverity,
  MonacoMarkerTag,
  type LspDiagnostic,
  type LspPosition,
  type LspRange,
  type LspRelatedInformation,
  type MonacoMarkerData,
} from "./diagnostics.js"
export { setLspMarkers, clearLspMarkers } from "./diagnostics.js"
export { offsetToPosition, positionToOffset, type Utf16Position } from "./utf16.js"
export {
  applyWorkspaceEdit,
  applyTextEditsToString,
  monacoRangeToLspRange,
  type LspTextEdit,
  type LspTextDocumentEdit,
  type LspWorkspaceEdit,
  type LspDocumentChange,
  type LspCreateFile,
  type LspRenameFile,
  type LspDeleteFile,
  type FileOperation,
  type ApplyWorkspaceEditOptions,
  type ApplyWorkspaceEditResult,
  type SkippedEdit,
} from "./apply-edit.js"
