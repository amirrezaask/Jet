import { Emitter } from "@jet/shared"

export type LocationListSource =
  | "search"
  | "problems"
  | "references"
  | "definitions"
  | "task-errors"

export type LocationItem = {
  id: string
  fileUri: string
  path: string
  line: number
  column: number
  label: string
  detail?: string
  source: LocationListSource
}

export class LocationListState {
  activeSource: LocationListSource = "search"
  items: LocationItem[] = []
  searchQuery = ""
  searchCaseSensitive = false
  searchRegex = false
  searchFuzzy = false
  searchLoading = false
  searchError: string | null = null

  readonly onDidChange = new Emitter<void>()

  setSource(source: LocationListSource): void {
    if (this.activeSource === source) return
    this.activeSource = source
    this.onDidChange.fire()
  }

  setItems(items: LocationItem[], source?: LocationListSource): void {
    this.items = items
    if (source) this.activeSource = source
    this.onDidChange.fire()
  }

  appendItems(items: LocationItem[], source?: LocationListSource): void {
    this.items = [...this.items, ...items]
    if (source) this.activeSource = source
    this.onDidChange.fire()
  }

  setSearchState(patch: {
    query?: string
    caseSensitive?: boolean
    regex?: boolean
    fuzzy?: boolean
    loading?: boolean
    error?: string | null
  }): void {
    if (patch.query !== undefined) this.searchQuery = patch.query
    if (patch.caseSensitive !== undefined) this.searchCaseSensitive = patch.caseSensitive
    if (patch.regex !== undefined) this.searchRegex = patch.regex
    if (patch.fuzzy !== undefined) this.searchFuzzy = patch.fuzzy
    if (patch.loading !== undefined) this.searchLoading = patch.loading
    if (patch.error !== undefined) this.searchError = patch.error
    this.onDidChange.fire()
  }

  itemsForActiveSource(): LocationItem[] {
    return this.items.filter(i => i.source === this.activeSource)
  }
}
