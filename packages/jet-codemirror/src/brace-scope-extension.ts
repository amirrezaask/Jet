import { EditorView, ViewPlugin, Decoration, type ViewUpdate } from "@codemirror/view"
import { RangeSetBuilder } from "@codemirror/state"
import { getBraceScopeHost } from "./workers/brace-scope-host.js"
import type { BraceScopeEntry } from "./brace-scope-scan.js"

const guideLine = Decoration.line({ class: "jet-brace-guide" })
const activeScope = Decoration.line({ class: "jet-brace-scope-active" })

let ownerSeq = 0

class BraceScopePlugin {
  decorations = Decoration.none
  private ownerId = ++ownerSeq
  private scopes: BraceScopeEntry[] = []

  constructor(private view: EditorView) {
    this.schedule()
  }

  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.selectionSet) this.schedule()
  }

  destroy() {
    getBraceScopeHost().cancel(this.ownerId)
  }

  private schedule() {
    const { view } = this
    const sel = view.state.selection.main.head
    getBraceScopeHost().schedule(
      this.ownerId,
      {
        changeStamp: view.state.doc.length,
        textOffset: 0,
        lineNumberOffset: 1,
        viewportFrom: view.viewport.from,
        viewportTo: view.viewport.to,
        cursorPos: sel,
        text: view.state.doc.toString(),
      },
      result => {
        this.scopes = result.scopes
        this.decorations = this.buildDeco(view, sel)
        view.requestMeasure()
      },
    )
  }

  private buildDeco(view: EditorView, cursor: number) {
    const b = new RangeSetBuilder<Decoration>()
    for (const s of this.scopes) {
      if (s.openLine < 1 || s.openLine > view.state.doc.lines) continue
      const openLine = view.state.doc.line(s.openLine)
      const inScope = cursor >= s.openPos && cursor <= s.closePos
      b.add(openLine.from, openLine.from, inScope ? activeScope : guideLine)
    }
    return b.finish()
  }
}

export function braceScopeExtension() {
  return ViewPlugin.fromClass(BraceScopePlugin, { decorations: v => v.decorations })
}

export const braceScopeTheme = EditorView.baseTheme({
  ".jet-brace-guide": { borderLeft: "1px solid var(--jet-border)" },
  ".jet-brace-scope-active": {
    borderLeft: "2px solid var(--jet-accent)",
    backgroundColor: "color-mix(in srgb, var(--jet-accent) 8%, transparent)",
  },
})
