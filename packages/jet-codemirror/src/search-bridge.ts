import { EditorState, Prec, type Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { keymap } from "@codemirror/view"
import {
  getSearchQuery,
  setSearchQuery,
  SearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
} from "@codemirror/search"

export { getSearchQuery, findNext, findPrevious, replaceNext, replaceAll }

function matchCase(source: string, replacement: string): string {
  if (!source) return replacement
  if (source === source.toUpperCase() && source !== source.toLowerCase()) {
    return replacement.toUpperCase()
  }
  if (source === source.toLowerCase()) return replacement.toLowerCase()
  const first = source[0]
  if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
    return replacement[0]?.toUpperCase() + replacement.slice(1)
  }
  return replacement
}

/** Replace all occurrences preserving the original case pattern of each match. */
export function replaceAllPreserveCase(view: EditorView): boolean {
  const query = getSearchQuery(view.state)
  if (!query.search) return false
  if (query.regexp) return replaceAll(view)
  const doc = view.state.doc.toString()
  const needle = query.caseSensitive ? query.search : query.search.toLowerCase()
  const hay = query.caseSensitive ? doc : doc.toLowerCase()
  const changes: { from: number; to: number; insert: string }[] = []
  let idx = 0
  while ((idx = hay.indexOf(needle, idx)) >= 0) {
    const end = idx + needle.length
    const original = doc.slice(idx, end)
    if (query.wholeWord) {
      const before = doc[idx - 1] ?? ""
      const after = doc[end] ?? ""
      if (/\w/.test(before) || /\w/.test(after)) {
        idx = end
        continue
      }
    }
    changes.push({ from: idx, to: end, insert: matchCase(original, query.replace) })
    idx = end
  }
  if (!changes.length) return false
  view.dispatch({ changes })
  return true
}


export type JetSearchMode = "find" | "replace"

export type JetSearchState = {
  view: EditorView
  panelId?: number
  open: boolean
  mode: JetSearchMode
  /** Bumps when the CM SearchQuery changes so React re-reads view.state. */
  version: number
}

type Listener = (state: JetSearchState | null) => void

const listeners = new Set<Listener>()
let currentState: JetSearchState | null = null
let version = 0

function emit(state: JetSearchState | null): void {
  currentState = state
  for (const fn of listeners) fn(state)
}

function emitCurrent(): void {
  if (!currentState) return
  version += 1
  emit({ ...currentState, version })
}

export function subscribeSearch(fn: Listener): () => void {
  listeners.add(fn)
  fn(currentState)
  return () => {
    listeners.delete(fn)
  }
}

export function getJetSearchState(): JetSearchState | null {
  return currentState
}

function readPriorQuery(state: EditorState): SearchQuery | undefined {
  try {
    return getSearchQuery(state)
  } catch {
    return undefined
  }
}

function seedSearchQuery(state: EditorState, fallback?: SearchQuery): SearchQuery {
  const sel = state.selection.main
  const selText =
    sel.empty || sel.to > sel.from + 100 ? "" : state.sliceDoc(sel.from, sel.to)
  if (fallback && !selText) return fallback
  return new SearchQuery({
    search: (fallback?.literal ?? false) ? selText : selText.replace(/\n/g, "\\n"),
    replace: fallback?.replace ?? "",
    caseSensitive: fallback?.caseSensitive ?? false,
    literal: fallback?.literal ?? false,
    regexp: fallback?.regexp ?? false,
    wholeWord: fallback?.wholeWord ?? false,
  })
}

export function openJetSearch(view: EditorView, mode: JetSearchMode, panelId?: number): void {
  const prev = readPriorQuery(view.state)
  const query = seedSearchQuery(view.state, prev)
  view.dispatch({ effects: setSearchQuery.of(query) })
  version += 1
  emit({ view, panelId, open: true, mode, version })
}

export function closeJetSearch(view: EditorView): void {
  if (currentState?.view === view) emit(null)
  view.focus()
}

export function closeJetSearchForView(view: EditorView): void {
  if (currentState?.view === view) emit(null)
}

export type JetSearchQueryPatch = {
  search?: string
  replace?: string
  caseSensitive?: boolean
  literal?: boolean
  regexp?: boolean
  wholeWord?: boolean
}

export function patchJetSearchQuery(view: EditorView, patch: JetSearchQueryPatch): void {
  const q = getSearchQuery(view.state)
  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({
        search: patch.search ?? q.search,
        replace: patch.replace ?? q.replace,
        caseSensitive: patch.caseSensitive ?? q.caseSensitive,
        literal: patch.literal ?? q.literal,
        regexp: patch.regexp ?? q.regexp,
        wholeWord: patch.wholeWord ?? q.wholeWord,
      }),
    ),
  })
  emitCurrent()
}

/** Hidden CM panel factory — search state/highlights stay in @codemirror/search. */
export function hiddenSearchPanel(): { dom: HTMLElement; top: boolean } {
  const dom = document.createElement("div")
  dom.className = "jet-search-panel-hidden"
  dom.setAttribute("aria-hidden", "true")
  return { dom, top: true }
}

/** Intercept Mod-f / Mod-h before CM's native search panel keymap. */
export function jetSearchPanelKeymap(): Extension {
  return Prec.highest(
    keymap.of([
      {
        key: "Mod-f",
        run(view) {
          openJetSearch(view, "find")
          return true
        },
      },
      {
        key: "Mod-h",
        run(view) {
          openJetSearch(view, "replace")
          return true
        },
      },
      {
        key: "Escape",
        run(view) {
          if (!currentState?.open || currentState.view !== view) return false
          closeJetSearch(view)
          return true
        },
      },
    ]),
  )
}
