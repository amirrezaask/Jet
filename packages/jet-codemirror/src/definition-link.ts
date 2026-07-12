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
  private lastPointer: { x: number; y: number } | null = null
  private modHeld = false
  private doc: EditorView["state"]["doc"]
  private readonly cache = new Map<string, { available: boolean; preview: string }>()

  constructor(
    private readonly view: EditorView,
    private readonly executeCommand: (name: string) => Promise<void>,
  ) {
    this.doc = view.state.doc
    view.dom.addEventListener("mousemove", this.onMouseMove)
    view.dom.addEventListener("mousedown", this.onMouseDown, true)
    view.dom.addEventListener("mouseleave", this.onMouseLeave)
    window.addEventListener("keydown", this.onKeyDown, true)
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
    this.lastPointer = { x: event.clientX, y: event.clientY }
    this.modHeld = event.metaKey || event.ctrlKey
    if (!this.modHeld || event.altKey) {
      this.clearLinkOnly()
      return
    }
    this.resolveAtClientPoint(event.clientX, event.clientY)
  }

  private readonly onMouseLeave = (): void => {
    this.lastPointer = null
    this.clearLinkOnly()
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Meta" && event.key !== "Control") return
    this.modHeld = true
    if (!this.lastPointer) return
    this.resolveAtClientPoint(this.lastPointer.x, this.lastPointer.y)
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.key !== "Meta" && event.key !== "Control") return
    this.modHeld = false
    this.clearLinkOnly()
  }

  private resolveAtClientPoint(x: number, y: number): void {
    const pos = this.view.posAtCoords({ x, y })
    if (pos == null) return this.clearLinkOnly()
    const word = symbolRangeAt(this.view.state, pos)
    if (!word) return this.clearLinkOnly()
    if (this.activeRange?.from === word.from && this.activeRange.to === word.to) return
    // Optimistic underline so Cmd+hover feels instant; LSP confirms in background.
    this.apply({ from: word.from, to: word.to, preview: "Go to definition" })
    void this.resolve(word.from, word.to, pos)
  }

  private async resolve(from: number, to: number, clickPos: number): Promise<void> {
    const plugin = LSPPlugin.get(this.view)
    if (!plugin) return
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
      if (!this.modHeld) return
      const available = normalizeLspLocations(definition).length > 0
      const preview = hover ? plainHoverSnippet(hover).slice(0, 140) || "Go to definition" : "Go to definition"
      if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value ?? "")
      this.cache.set(key, { available, preview })
      this.apply(available ? { from, to, preview } : null)
    } catch {
      if (stamp === this.requestStamp && this.modHeld) {
        // Keep optimistic underline; click still attempts goto-def.
      }
    }
  }

  private apply(value: { from: number; to: number; preview: string } | null): void {
    this.activeRange = value ? { from: value.from, to: value.to } : null
    this.view.dispatch({ effects: setDefinitionLink.of(value) })
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.button !== 0) return
    const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY })
    const word = pos != null ? symbolRangeAt(this.view.state, pos) : null
    const range = this.activeRange ?? word
    if (pos == null || !range || pos < range.from || pos >= range.to) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.view.dispatch({ selection: { anchor: pos }, scrollIntoView: false, userEvent: "select.pointer" })
    void this.executeCommand("editor.action.revealDefinition")
  }

  private clearLinkOnly = (): void => {
    this.requestStamp++
    if (!this.activeRange) return
    this.apply(null)
  }

  private readonly clear = (): void => {
    this.modHeld = false
    this.lastPointer = null
    this.clearLinkOnly()
  }

  destroy(): void {
    this.requestStamp++
    this.view.dom.removeEventListener("mousemove", this.onMouseMove)
    this.view.dom.removeEventListener("mousedown", this.onMouseDown, true)
    this.view.dom.removeEventListener("mouseleave", this.onMouseLeave)
    window.removeEventListener("keydown", this.onKeyDown, true)
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
