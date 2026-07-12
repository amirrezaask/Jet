import type { CSSProperties, ReactElement, ReactNode } from "react"

export type ListerNodeId = string

export type ListerNode<T> = {
  id: ListerNodeId
  data: T
  isBranch?: boolean
  /** Haystack for local fuzzy filter. */
  searchText: string
}

export type ListerItemContext = {
  depth: number
  selected: boolean
  expanded: boolean
  loading: boolean
  isBranch: boolean
  active: boolean
  query: string
}

export type ListerDataSource<T> = {
  getRoots(): ListerNode<T>[]
  getChildren(id: ListerNodeId): Promise<ListerNode<T>[]> | ListerNode<T>[] | null
  subscribe?(fn: () => void): () => void
}

export type ListerFilterMode = "local" | "external" | "none"

export type ListerProps<T> = {
  listId: string
  mode: "flat" | "tree"
  items?: ListerNode<T>[]
  source?: ListerDataSource<T>
  render: (node: ListerNode<T>, ctx: ListerItemContext) => ReactNode
  /**
   * Initial search-field visibility only.
   * Typing always reveals the input while `query` is non-empty (all listers).
   */
  showInput?: boolean
  /**
   * Focus the search field on mount when visible.
   * Defaults to `showInput || query.length > 0` when omitted.
   */
  autoFocusInput?: boolean
  placeholder?: string
  query?: string
  onQueryChange?: (query: string) => void
  filter?: ListerFilterMode
  onActivate: (node: ListerNode<T>) => void
  emptyState?: ReactNode
  initiallyExpanded?: ListerNodeId[]
  syncExpanded?: boolean
  activeId?: ListerNodeId | null
  indentPx?: number
  rowActions?: (node: ListerNode<T>) => ReactNode
  wrapRow?: (node: ListerNode<T>, row: ReactElement) => ReactNode
  rowAriaLabel?: (node: ListerNode<T>) => string
  estimateSize?: (node: ListerNode<T>, depth: number) => number
  /** When true (palette), empty query forces no selection highlight. */
  requireQueryForSelection?: boolean
  /**
   * flat chrome:
   * - plain — positioning only; render supplies focusable row (`data-jet-list-item`)
   * - palette — CommandItem-like button wrapper (hot-glow + selected accent)
   */
  flatVariant?: "plain" | "palette"
  itemClassName?: string
  itemStyle?: (node: ListerNode<T>) => CSSProperties | undefined
  className?: string
  listClassName?: string
  inputDisabled?: boolean
  /** Renders between search input and list (palette status row). */
  betweenInputAndList?: ReactNode
  "aria-label"?: string
  role?: "listbox" | "tree" | "list"
}
