/** 1-based line/column range; the end position is exclusive. */
export type SearchMatchRange = {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

export type ProjectSearchResult = {
  path: string
  line: number
  column: number
  preview: string
  ranges: SearchMatchRange[]
}

export type SearchPage<T> = {
  items: T[]
  /** True when a configured result/file cap stopped collection. */
  truncated: boolean
}

export type SearchPathOptions = {
  /** Ripgrep-style positive glob filters. */
  include?: string[]
  /** Ripgrep-style negative glob filters. */
  exclude?: string[]
}

export type ProjectSearchOptions = SearchPathOptions & {
  caseSensitive?: boolean
  regex?: boolean
  fuzzy?: boolean
  wholeWord?: boolean
}

export type FileSearchOptions = SearchPathOptions & {
  pageSize?: number
  currentFile?: string
}
