import { Emitter } from "@jet/shared"

export type ListItem = {
  id: string
  fileUri: string
  path: string
  line: number
  column: number
  label: string
  detail?: string
}

export type ListFeedKind = "search" | "problems" | "references" | "definitions" | "task-errors"

export type ListDocument = {
  id: string
  title: string
  feed: ListFeedKind
  items: ListItem[]
  searchQuery?: string
  searchCaseSensitive?: boolean
  searchRegex?: boolean
  searchFuzzy?: boolean
  searchLoading?: boolean
  searchError?: string | null
  taskLabel?: string
  taskStatus?: "running" | "done" | "failed"
}

let nextListId = 1

export function allocListId(): string {
  return `list-${nextListId++}-${Date.now()}`
}

export const PROBLEMS_LIST_ID = "problems-live"

export class ListDocumentStore {
  private docs = new Map<string, ListDocument>()
  readonly onDidChange = new Emitter<{ id: string }>()

  create(doc: ListDocument): void {
    this.docs.set(doc.id, doc)
    this.onDidChange.fire({ id: doc.id })
  }

  get(id: string): ListDocument | undefined {
    return this.docs.get(id)
  }

  update(id: string, patch: Partial<Omit<ListDocument, "id">>): void {
    const existing = this.docs.get(id)
    if (!existing) return
    this.docs.set(id, { ...existing, ...patch })
    this.onDidChange.fire({ id })
  }

  dispose(id: string): void {
    if (!this.docs.delete(id)) return
    this.onDidChange.fire({ id })
  }

  titleFor(id: string): string {
    return this.docs.get(id)?.title ?? id
  }
}
