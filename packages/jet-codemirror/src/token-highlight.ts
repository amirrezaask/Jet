import { EditorView, ViewPlugin, Decoration, type ViewUpdate } from "@codemirror/view"
import { syntaxTree } from "@codemirror/language"

const tokenMark = Decoration.mark({ class: "jet-cursor-token" })
const occMark = Decoration.mark({ class: "jet-token-occurrence" })

class TokenHighlightPlugin {
  decorations = Decoration.none

  constructor(private view: EditorView) {
    this.recompute()
  }

  update(u: ViewUpdate) {
    if (u.docChanged || u.selectionSet || u.viewportChanged) this.recompute()
  }

  private recompute() {
    const { view } = this
    const pos = view.state.selection.main.head
    const tree = syntaxTree(view.state)
    const node = tree.resolveInner(pos, 1)
    if (!node || node.name === "Document") {
      this.decorations = Decoration.none
      return
    }
    const text = view.state.sliceDoc(node.from, node.to)
    if (!/^[A-Za-z_$][\w$]*$/.test(text)) {
      this.decorations = Decoration.none
      return
    }
    const ranges: { from: number; to: number; mark: Decoration }[] = []
    ranges.push({ from: node.from, to: node.to, mark: tokenMark })
    const doc = view.state.doc.toString()
    let idx = 0
    while ((idx = doc.indexOf(text, idx)) >= 0) {
      const end = idx + text.length
      if (idx !== node.from) ranges.push({ from: idx, to: end, mark: occMark })
      idx = end
    }
    ranges.sort((a, b) => a.from - b.from)
    this.decorations = Decoration.set(ranges.map(r => r.mark.range(r.from, r.to)))
  }
}

export function cursorTokenHighlightExtension() {
  return ViewPlugin.fromClass(TokenHighlightPlugin, { decorations: v => v.decorations })
}

export const cursorTokenTheme = EditorView.baseTheme({
  ".jet-cursor-token": {
    textDecoration: "underline",
    textDecorationColor: "var(--jet-accent)",
    textUnderlineOffset: "3px",
  },
  ".jet-token-occurrence": {
    backgroundColor: "color-mix(in srgb, var(--jet-accent) 12%, transparent)",
  },
})
