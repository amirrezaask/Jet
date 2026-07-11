import { StateEffect, StateField, type Extension } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view"
import { LSPPlugin } from "@codemirror/lsp-client"
import { fetchHoverPlaintext } from "./lsp-editor-commands.js"
import { plainHoverSnippet } from "./hover-signature.js"
import {
  lspOffsetForSymbol,
  normalizeLspLocations,
  symbolRangeAt,
} from "./lsp-locations.js"

const setDefinitionLink = StateEffect.define<{ from: number; to: number; preview: string } | null>()

const definitionLinkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (!effect.is(setDefinitionLink)) continue
      if (!effect.value) return Decoration.none
      return Decoration.set([
        Decoration.mark({
          class: "cm-definition-link",
          attributes: {
            title: effect.value.preview || "Go to definition",
            "data-jet-definition-link": "",
          },
        }).range(effect.value.from, effect.value.to),
      ])
    }
    return value
  },
  provide: field => EditorView.decorations.from(field),
})

class DefinitionLinkPlugin {
  private requestStamp = 0
  private activeRange: { from: number; to: number } | null = null
  private doc: EditorView["state"]["doc"]
  private readonly cache = new Map<string, { available: boolean; preview: string }>()

  constructor(
    private readonly view: EditorView,
    private readonly executeCommand: (name: string) => Promise<void>,
  ) {
    this.doc = view.state.doc
    view.dom.addEventListener("mousemove", this.onMouseMove)
    view.dom.addEventListener("mousedown", this.onMouseDown, true)
    view.dom.addEventListener("mouseleave", this.clear)
    window.addEventListener("keyup", this.onKeyUp, true)
    window.addEventListener("blur", this.clear)
  }

  update(update: ViewUpdate): void {
    if (update.state.doc === this.doc) return
    this.doc = update.state.doc
    this.cache.clear()
    this.clear()
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) {
      this.clear()
      return
    }
    const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos == null) return this.clear()
    const word = symbolRangeAt(this.view.state, pos)
    if (!word) return this.clear()
    if (this.activeRange?.from === word.from && this.activeRange.to === word.to) return
    void this.resolve(word.from, word.to, pos)
  }

  private async resolve(from: number, to: number, clickPos: number): Promise<void> {
    const plugin = LSPPlugin.get(this.view)
    if (!plugin) {
      this.clear()
      return
    }
    const key = `${from}:${to}`
    const cached = this.cache.get(key)
    if (cached) {
      this.apply(cached.available ? { from, to, preview: cached.preview } : null)
      return
    }
    const stamp = ++this.requestStamp
    const lspPos = lspOffsetForSymbol(this.view.state, clickPos)
    plugin.client.sync()
    try {
      const [definition, hover] = await Promise.all([
        plugin.client.request(
          "textDocument/definition",
          {
            textDocument: { uri: plugin.uri },
            position: plugin.toPosition(lspPos),
          },
        ),
        fetchHoverPlaintext(this.view, lspPos).catch(() => null),
      ])
      if (stamp !== this.requestStamp || this.view.state.doc !== this.doc) return
      const available = normalizeLspLocations(definition).length > 0
      const preview = hover ? plainHoverSnippet(hover).slice(0, 140) || "Go to definition" : "Go to definition"
      if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value ?? "")
      this.cache.set(key, { available, preview })
      this.apply(available ? { from, to, preview } : null)
    } catch {
      if (stamp === this.requestStamp) this.apply(null)
    }
  }

  private apply(value: { from: number; to: number; preview: string } | null): void {
    this.activeRange = value ? { from: value.from, to: value.to } : null
    this.view.dispatch({ effects: setDefinitionLink.of(value) })
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.button !== 0) return
    const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY })
    const range = this.activeRange
    if (pos == null || !range || pos < range.from || pos >= range.to) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.view.dispatch({ selection: { anchor: pos }, scrollIntoView: false, userEvent: "select.pointer" })
    void this.executeCommand("editor.action.revealDefinition")
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === "Meta" || event.key === "Control") this.clear()
  }

  private readonly clear = (): void => {
    this.requestStamp++
    if (!this.activeRange) return
    this.apply(null)
  }

  destroy(): void {
    this.requestStamp++
    this.view.dom.removeEventListener("mousemove", this.onMouseMove)
    this.view.dom.removeEventListener("mousedown", this.onMouseDown, true)
    this.view.dom.removeEventListener("mouseleave", this.clear)
    window.removeEventListener("keyup", this.onKeyUp, true)
    window.removeEventListener("blur", this.clear)
  }
}

export function definitionLink(executeCommand: (name: string) => Promise<void>): Extension {
  return [
    definitionLinkField,
    ViewPlugin.define(view => new DefinitionLinkPlugin(view, executeCommand)),
    EditorView.theme({
      ".cm-definition-link": {
        cursor: "pointer",
        color: "var(--jet-accent)",
        background: "color-mix(in srgb, var(--jet-accent) 14%, transparent)",
        textDecoration: "underline",
        textDecorationColor: "color-mix(in srgb, var(--jet-accent) 78%, transparent)",
        textUnderlineOffset: "3px",
        borderRadius: "2px",
      },
    }),
  ]
}
