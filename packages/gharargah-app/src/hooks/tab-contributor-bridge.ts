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
    closeTerminalTab: (panelId, tabId) => get().closeTerminalTab(panelId, tabId),
    onTerminalTitleChange: (tabId, title) => get().onTerminalTitleChange(tabId, title),
  }
}

export type TabContributorBridgeRef = { current: TabContributorDeps }

export function bridgeFromRef(ref: TabContributorBridgeRef): TabContributorBridge {
  return createTabContributorBridge(() => ref.current)
}
