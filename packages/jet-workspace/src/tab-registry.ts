import { Emitter } from "@jet/shared"

/**
 * Opaque tab type identifier. Framework treats it as a string; individual apps
 * register their own type ids (e.g. "editor", "explorer", "jet:search").
 */
export type TabKind = string

export const EXPLORER_TAB_ID = "jet:explorer"
export const OUTPUT_TAB_ID = "jet:output"
export const PROBLEMS_TAB_ID = "jet:problems"
export const TERMINAL_TAB_ID_PREFIX = "jet:terminal:"

export function terminalTabId(sessionKey: string): string {
  return `${TERMINAL_TAB_ID_PREFIX}${sessionKey}`
}

export function isTerminalTabId(tabId: string): boolean {
  return tabId.startsWith(TERMINAL_TAB_ID_PREFIX)
}

export type TabDescriptor = {
  id: string
  kind: TabKind
  label: string
}

/**
 * Lightweight per-tab bookkeeping used by workspace helpers that need to look
 * up label/kind by tab id. The real render dispatch lives in `@jet/ui`'s
 * `TabTypeRegistry`; this store is just a workspace-side companion so command
 * handlers can ask "what kind of tab is this?" without importing UI.
 */
export class TabRegistry {
  private tabs = new Map<string, TabDescriptor>()
  readonly onDidChange = new Emitter<{ id: string }>()

  register(tab: TabDescriptor): void {
    this.tabs.set(tab.id, tab)
    this.onDidChange.fire({ id: tab.id })
  }

  get(id: string): TabDescriptor | undefined {
    return this.tabs.get(id)
  }

  update(id: string, patch: Partial<Omit<TabDescriptor, "id">>): void {
    const existing = this.tabs.get(id)
    if (!existing) return
    this.tabs.set(id, { ...existing, ...patch })
    this.onDidChange.fire({ id })
  }

  dispose(id: string): void {
    if (!this.tabs.delete(id)) return
    this.onDidChange.fire({ id })
  }

  labelFor(id: string): string {
    return this.tabs.get(id)?.label ?? id
  }

  kindFor(id: string): TabKind | undefined {
    return this.tabs.get(id)?.kind
  }
}
