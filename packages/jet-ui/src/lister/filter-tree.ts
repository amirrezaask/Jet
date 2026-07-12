import { fuzzyScore } from "./fuzzy.js"

export type TreeFilterRow = {
  searchText: string
  depth: number
  expanded: boolean
  isBranch: boolean
}

/**
 * Filter flattened tree rows while preserving expand/collapse.
 * Keeps: matches, ancestors of matches, and all descendants under
 * an expanded matching branch (so toggling open reveals children).
 * Preserves tree order (no score re-sort).
 */
export function filterTreeRows<T extends TreeFilterRow>(
  query: string,
  rows: readonly T[],
): T[] {
  const trimmed = query.trim()
  if (!trimmed || rows.length === 0) return rows.slice()

  const match = rows.map(r => fuzzyScore(trimmed, r.searchText) !== null)
  const keep = match.slice()

  // Ancestors of matches
  for (let i = 0; i < rows.length; i++) {
    if (!match[i]) continue
    let depth = rows[i]!.depth
    for (let j = i - 1; j >= 0 && depth > 0; j--) {
      if (rows[j]!.depth < depth) {
        keep[j] = true
        depth = rows[j]!.depth
      }
    }
  }

  // Descendants of expanded matching branches (expansion must reveal children)
  for (let i = 0; i < rows.length; i++) {
    if (!match[i] || !rows[i]!.isBranch || !rows[i]!.expanded) continue
    const base = rows[i]!.depth
    for (let j = i + 1; j < rows.length && rows[j]!.depth > base; j++) {
      keep[j] = true
    }
  }

  return rows.filter((_, i) => keep[i])
}
