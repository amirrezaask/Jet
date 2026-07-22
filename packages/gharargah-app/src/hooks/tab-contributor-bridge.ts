import type { TabContributorDeps } from "../tabs/deps.js"

/**
 * Stable bridge object passed to registerBuiltinTabTypes. Individual fields are
 * ref-backed getters so tab render closures never stale-close over React state.
 */
export type TabContributorBridge = TabContributorDeps

export function createTabContributorBridge(
  get: () => TabContributorDeps,
): TabContributorBridge {
  return {
    get workspace() {
      return get().workspace
    },
    getTheme: () => get().getTheme(),
    resolveLspClient: fileUri => get().resolveLspClient(fileUri),
    getLspRevision: () => get().getLspRevision(),
    executeCommand: name => get().executeCommand(name),
    runKeyBinding: (binding, view) => get().runKeyBinding(binding, view),
    getKeymapBindings: () => get().getKeymapBindings(),
    getUserExtensions: () => get().getUserExtensions(),
    getKeymapRevision: () => get().getKeymapRevision(),
    getKeymapContext: () => get().getKeymapContext(),
    onEditorFocusChange: focused => get().onEditorFocusChange(focused),
    onEditorSelectionChange: (line, column, rangeCount) =>
      get().onEditorSelectionChange(line, column, rangeCount),
    onLspAttachFailed: fileUri => get().onLspAttachFailed(fileUri),
    onProblemsChange: () => get().onProblemsChange(),
    closeTerminalTab: (panelId, tabId) => get().closeTerminalTab(panelId, tabId),
    onTerminalTitleChange: (tabId, title) => get().onTerminalTitleChange(tabId, title),
  }
}

export type TabContributorBridgeRef = { current: TabContributorDeps }

export function bridgeFromRef(ref: TabContributorBridgeRef): TabContributorBridge {
  return createTabContributorBridge(() => ref.current)
}
