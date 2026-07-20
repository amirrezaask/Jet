import { StateEffect, StateField, type Extension, type Range } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from "@codemirror/view"
import { LSPPlugin } from "@codemirror/lsp-client"
import { fetchInlayHints, type InlayHint } from "./lsp-editor-commands.js"

const setInlayHints = StateEffect.define<DecorationSet>()

const inlayHintField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes)
    for (const effect of transaction.effects) if (effect.is(setInlayHints)) return effect.value
    return value
  },
  provide: field => EditorView.decorations.from(field),
})

function labelText(label: InlayHint["label"]): string {
  return typeof label === "string" ? label : label.map(part => part.value).join("")
}

class InlayHintWidget extends WidgetType {
  constructor(
    private readonly text: string,
    private readonly paddingLeft: boolean,
    private readonly paddingRight: boolean,
  ) {
    super()
  }

  eq(other: InlayHintWidget): boolean {
    return this.text === other.text && this.paddingLeft === other.paddingLeft && this.paddingRight === other.paddingRight
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span")
    element.className = "cm-inlay-hint"
    element.textContent = `${this.paddingLeft ? " " : ""}${this.text}${this.paddingRight ? " " : ""}`
    element.setAttribute("aria-hidden", "true")
    return element
  }

  ignoreEvent(): boolean {
    return true
  }
}

function decorations(view: EditorView, hints: InlayHint[]): DecorationSet {
  const plugin = LSPPlugin.get(view)
  if (!plugin) return Decoration.none
  const ranges: Range<Decoration>[] = []
  for (const hint of hints) {
    const pos = plugin.fromPosition(hint.position, view.state.doc)
    const text = labelText(hint.label).trim()
    if (!text || pos < 0 || pos > view.state.doc.length) continue
    ranges.push(
      Decoration.widget({
        widget: new InlayHintWidget(text, hint.paddingLeft === true, hint.paddingRight === true),
        side: 1,
      }).range(pos),
    )
  }
  return Decoration.set(ranges, true)
}

export function inlayHints(): Extension {
  return [
    inlayHintField,
    ViewPlugin.define(view => {
      let timer: ReturnType<typeof setTimeout> | null = null
      let stamp = 0
      let connected = LSPPlugin.get(view) != null
      const schedule = () => {
        if (timer != null) clearTimeout(timer)
        const requestStamp = ++stamp
        timer = setTimeout(() => {
          timer = null
          if (view.composing) return
          connected = LSPPlugin.get(view) != null
          const { from, to } = view.viewport
          void fetchInlayHints(view, from, to).then(hints => {
            if (requestStamp !== stamp) return
            view.dispatch({ effects: setInlayHints.of(decorations(view, hints)) })
          }).catch(() => {})
        }, 120)
      }
      schedule()
      return {
        update(update) {
          const justConnected = !connected && LSPPlugin.get(view) != null
          if (justConnected) connected = true
          if (update.docChanged || update.viewportChanged || justConnected) schedule()
        },
        destroy() {
          stamp++
          if (timer != null) clearTimeout(timer)
        },
      }
    }),
    EditorView.theme({
      ".cm-inlay-hint": {
        color: "color-mix(in srgb, var(--gharargah-text-muted) 82%, transparent)",
        background: "color-mix(in srgb, var(--gharargah-panel-raised) 64%, transparent)",
        borderRadius: "3px",
        fontSize: "0.82em",
        fontStyle: "italic",
        padding: "0 2px",
        margin: "0 1px",
        userSelect: "none",
      },
    }),
  ]
}
