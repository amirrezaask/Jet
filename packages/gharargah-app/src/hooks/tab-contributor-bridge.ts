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
    resolveLspClient: uri => get().resolveLspClient(uri),
    getLspRevision: () => get().getLspRevision(),
    executeCommand: name => get().executeCommand(name),
    runKeyBinding: (binding, view) => get().runKeyBinding(binding, view),
    getKeymapBindings: () => get().getKeymapBindings(),
    getUserExtensions: () => get().getUserExtensions(),
    getKeymapRevision: () => get().getKeymapRevision(),
    getKeymapContext: () => get().getKeymapContext(),
    onEditorFocusChange: f => get().onEditorFocusChange(f),
    onEditorSelectionChange: (l, c, r) => get().onEditorSelectionChange(l, c, r),
    onLspAttachFailed: uri => get().onLspAttachFailed(uri),
    onProblemsChange: () => get().onProblemsChange(),
    onOpenFile: (uri, path) => get().onOpenFile(uri, path),
    onOpenListItem: item => get().onOpenListItem(item),
    getSearchFolders: () => get().getSearchFolders(),
    getAgentExplorerGroups: () => get().getAgentExplorerGroups(),
    getAgentSnapshot: rootUri => get().getAgentSnapshot(rootUri),
    getAgentThread: (rootUri, threadId) => get().getAgentThread(rootUri, threadId),
    subscribeAgentThread: (rootUri, threadId, listener) =>
      get().subscribeAgentThread(rootUri, threadId, listener),
    getAgentProviders: () => get().getAgentProviders(),
    refreshAgentProviders: () => get().refreshAgentProviders(),
    updateAgentThreadSettings: (rootUri, threadId, settings) =>
      get().updateAgentThreadSettings(rootUri, threadId, settings),
    openAgentThread: (rootUri, threadId) => get().openAgentThread(rootUri, threadId),
    createAgentThread: (rootUri, rootPath) => get().createAgentThread(rootUri, rootPath),
    sendAgentMessage: (rootUri, threadId, payload) =>
      get().sendAgentMessage(rootUri, threadId, payload),
    interruptAgentTurn: (rootUri, threadId) => get().interruptAgentTurn(rootUri, threadId),
    archiveAgentThread: (rootUri, rootPath, threadId) =>
      get().archiveAgentThread(rootUri, rootPath, threadId),
    unarchiveAgentThread: (rootUri, rootPath, threadId) =>
      get().unarchiveAgentThread(rootUri, rootPath, threadId),
    getTerminalExplorerGroups: () => get().getTerminalExplorerGroups(),
    focusTerminalTab: (panelId, tabId) => get().focusTerminalTab(panelId, tabId),
    newTerminalInWorkspace: rootUri => get().newTerminalInWorkspace(rootUri),
    launchAgentTerminal: (rootUri, shortcut) => get().launchAgentTerminal(rootUri, shortcut),
    closeTerminalTab: (panelId, tabId) => get().closeTerminalTab(panelId, tabId),
    getActiveTerminalTabId: () => get().getActiveTerminalTabId(),
    onTerminalTitleChange: (tabId, title) => get().onTerminalTitleChange(tabId, title),
  }
}

export type TabContributorBridgeRef = { current: TabContributorDeps }

export function bridgeFromRef(ref: TabContributorBridgeRef): TabContributorBridge {
  return createTabContributorBridge(() => ref.current)
}
