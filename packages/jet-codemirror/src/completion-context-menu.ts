import { type Extension } from "@codemirror/state"
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view"
import {
  acceptCompletion,
  closeCompletion,
  completionStatus,
  currentCompletions,
  moveCompletionSelection,
  selectedCompletionIndex,
  setSelectedCompletion,
  type Completion,
} from "@codemirror/autocomplete"

/** Class applied to CodeMirror's own autocomplete tooltip so it can be hidden.
 *  We render the popup via shadcn ContextMenu in React — CM tooltip stays present
 *  only to keep autocomplete state alive; visually suppressed by `completionContextMenuTheme`. */
export const completionContextMenuClass = "jet-completion-hidden-tooltip"

export type JetCompletionItem = {
  label: string
  detail?: string
  info?: string
  type?: string
}

export type JetCompletionState = {
  view: EditorView
  items: JetCompletionItem[]
  selected: number
  coords: { left: number; top: number; bottom: number } | null
}

type Listener = (state: JetCompletionState | null) => void
const listeners = new Set<Listener>()
let currentState: JetCompletionState | null = null

export function subscribeCompletion(fn: Listener): () => void {
  listeners.add(fn)
  fn(currentState)
  return () => {
    listeners.delete(fn)
  }
}

export function getCompletionState(): JetCompletionState | null {
  return currentState
}

function emit(state: JetCompletionState | null): void {
  currentState = state
  for (const fn of listeners) fn(state)
}

function toItem(c: Completion): JetCompletionItem {
  return {
    label: c.label,
    detail: c.detail,
    info: typeof c.info === "string" ? c.info : undefined,
    type: c.type,
  }
}

function computeCoords(view: EditorView): JetCompletionState["coords"] {
  const head = view.state.selection.main.head
  const coords = view.coordsAtPos(head)
  if (!coords) return null
  return { left: coords.left, top: coords.top, bottom: coords.bottom }
}

function publishCompletion(view: EditorView): void {
  const status = completionStatus(view.state)
  const list = currentCompletions(view.state)
  if (list.length === 0) {
    if (status !== "pending") {
      if (currentState?.view === view) emit(null)
    }
    return
  }
  const idx = selectedCompletionIndex(view.state) ?? 0
  emit({
    view,
    items: list.map(toItem),
    selected: idx,
    coords: computeCoords(view),
  })
}

/** Bridge selectedCompletionIndex / currentCompletions to React state. */
export function completionContextMenuPlugin(): Extension {
  return ViewPlugin.fromClass(
    class {
      raf = 0
      retryTimer = 0
      constructor(view: EditorView) {
        this.schedule(view)
      }
      update(update: ViewUpdate) {
        this.schedule(update.view)
      }
      schedule(view: EditorView) {
        if (this.raf) cancelAnimationFrame(this.raf)
        if (this.retryTimer) clearTimeout(this.retryTimer)
        const tick = () => {
          this.raf = 0
          publishCompletion(view)
          const status = completionStatus(view.state)
          const list = currentCompletions(view.state)
          if (list.length === 0 && status === "pending") {
            this.retryTimer = window.setTimeout(tick, 100)
          }
        }
        this.raf = requestAnimationFrame(tick)
      }
      destroy() {
        if (this.raf) cancelAnimationFrame(this.raf)
        if (this.retryTimer) clearTimeout(this.retryTimer)
        if (currentState?.view) emit(null)
      }
    },
  )
}

/** Hide CodeMirror's default autocomplete tooltip — we render our own via ContextMenu. */
export function completionContextMenuTheme(): Extension {
  return EditorView.theme({
    ".cm-tooltip-autocomplete, .jet-completion-hidden-tooltip": {
      display: "none !important",
    },
  })
}

export function completionMoveSelection(view: EditorView, forward: boolean): boolean {
  return moveCompletionSelection(forward)(view)
}

export function completionAccept(view: EditorView): boolean {
  return acceptCompletion(view)
}

export function pickCompletionAt(view: EditorView, index: number): boolean {
  view.dispatch({ effects: setSelectedCompletion(index) })
  return acceptCompletion(view)
}

export function completionClose(view: EditorView): boolean {
  return closeCompletion(view)
}
