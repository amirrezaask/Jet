import { Emitter } from "@jet/shared"

export type TabKind =
  | "editor"
  | "explorer"
  | "output"
  | "search"
  | "problems"
  | "references"
  | "definitions"
  | "task-errors"

export const EXPLORER_TAB_ID = "jet:explorer"
export const OUTPUT_TAB_ID = "jet:output"
export const PROBLEMS_TAB_ID = "jet:problems"

export type TabDescriptor = {
  id: string
  kind: TabKind
  label: string
}

export function isListTabKind(kind: TabKind): boolean {
  return (
    kind === "search" ||
    kind === "problems" ||
    kind === "references" ||
    kind === "definitions" ||
    kind === "task-errors"
  )
}

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
