import { EditorView, Decoration, ViewPlugin, WidgetType } from "@codemirror/view"
import { StateEffect, StateField, Range, type Extension } from "@codemirror/state"
import type { BraceScopeEntry } from "./brace-scope-scan.js"
import { snapshotViewportLines } from "./brace-scope-scan.js"
import { getBraceScopeHost } from "./workers/brace-scope-host.js"
import { perfMeasure } from "./perf-instrumentation.js"

class CloseBraceVirtualWidget extends WidgetType {
  constructor(readonly label: string) {
    super()
  }

  eq(other: CloseBraceVirtualWidget): boolean {
    return other.label === this.label
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span")
    span.className = "cm-close-brace-virtual"
    span.textContent = `${this.label} `
    span.setAttribute("aria-hidden", "true")
    return span
  }

  ignoreEvent(): boolean {
    return true
  }
}

const closeBraceVirtualMark = Decoration.mark({ class: "cm-close-brace-virtual-wrap" })
const braceGuideMark = Decoration.line({ class: "cm-brace-guide-line" })

const setBraceScopeDeco = StateEffect.define<ReturnType<typeof Decoration.set>>()

const braceScopeField = StateField.define({
  create() {
    return Decoration.none
  },
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setBraceScopeDeco)) return e.value
    }
    return deco.map(tr.changes)
  },
  provide: f => EditorView.decorations.from(f),
})

function buildDecorations(view: EditorView, scopes: BraceScopeEntry[]) {
  const deco: Range<Decoration>[] = []
  const doc = view.state.doc
  for (const scope of scopes) {
    if (scope.openLine + 1 <= scope.closeLine - 1) {
      for (let ln = scope.openLine + 1; ln <= scope.closeLine - 1; ln++) {
        deco.push(braceGuideMark.range(doc.line(ln + 1).from))
      }
    }
    deco.push(
      Decoration.widget({
        widget: new CloseBraceVirtualWidget(scope.label),
        side: -1,
        marks: [closeBraceVirtualMark],
      }).range(scope.closePos),
    )
  }
  return Decoration.set(deco, true)
}

type ScanEntry = {
  ownerId: number
  stamp: number
  debounce: ReturnType<typeof setTimeout> | null
}

const viewState = new WeakMap<EditorView, ScanEntry>()
let nextOwnerId = 1

function runScan(view: EditorView, entry: ScanEntry): void {
  const stamp = ++entry.stamp
  const { state } = view
  const vp = view.viewport
  const lineSnapshots: { from: number; to: number; text: string; number: number }[] = []
  for (let n = state.doc.lineAt(vp.from).number; n <= state.doc.lineAt(vp.to).number; n++) {
    const line = state.doc.line(n)
    lineSnapshots.push({ from: line.from, to: line.to, text: line.text, number: n })
  }
  const snap = snapshotViewportLines(lineSnapshots, vp.from, vp.to)

  perfMeasure("jet:brace-scope-prep", () => {
    const fullText = state.doc.toString()
    getBraceScopeHost().schedule(
      entry.ownerId,
      {
        changeStamp: stamp,
        viewportFrom: snap.textFrom,
        viewportTo: snap.textTo,
        cursorPos: state.selection.main.head,
        fullText,
      },
      result => {
        if (result.changeStamp !== stamp) return
        view.dispatch({
          effects: setBraceScopeDeco.of(buildDecorations(view, result.scopes)),
        })
      },
    )
  })
}

function scheduleScan(view: EditorView, entry: ScanEntry): void {
  if (entry.debounce != null) clearTimeout(entry.debounce)
  entry.debounce = setTimeout(() => {
    entry.debounce = null
    runScan(view, entry)
  }, 16)
}

export function braceScopeExtension(): Extension {
  return [
    braceScopeField,
    ViewPlugin.define(view => {
      const entry: ScanEntry = { ownerId: nextOwnerId++, stamp: 0, debounce: null }
      viewState.set(view, entry)
      scheduleScan(view, entry)
      return {
        update(u) {
          if (u.docChanged || u.viewportChanged) scheduleScan(view, entry)
        },
        destroy() {
          if (entry.debounce != null) clearTimeout(entry.debounce)
          viewState.delete(view)
          getBraceScopeHost().cancel(entry.ownerId)
        },
      }
    }),
  ]
}
