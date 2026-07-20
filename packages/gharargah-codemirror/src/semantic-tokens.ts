import { StateEffect, StateField, type Extension, type Range } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view"
import { LSPPlugin } from "@codemirror/lsp-client"

type SemanticTokensResult = { data: number[] } | null
type SemanticTokenProvider = {
  legend: { tokenTypes: string[]; tokenModifiers: string[] }
  full?: boolean | { delta?: boolean }
}

const setSemanticTokens = StateEffect.define<DecorationSet>()

const semanticTokenField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes)
    for (const effect of transaction.effects) if (effect.is(setSemanticTokens)) return effect.value
    return value
  },
  provide: field => EditorView.decorations.from(field),
})

function safeClass(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-")
}

function decodeTokens(
  view: EditorView,
  data: number[],
  legend: SemanticTokenProvider["legend"],
): DecorationSet {
  const plugin = LSPPlugin.get(view)
  if (!plugin || data.length % 5 !== 0) return Decoration.none
  const ranges: Range<Decoration>[] = []
  let line = 0
  let character = 0
  for (let index = 0; index < data.length; index += 5) {
    const deltaLine = data[index]!
    const deltaStart = data[index + 1]!
    const length = data[index + 2]!
    const tokenType = data[index + 3]!
    const modifierBits = data[index + 4]!
    line += deltaLine
    character = deltaLine === 0 ? character + deltaStart : deltaStart
    if (length <= 0) continue
    const type = legend.tokenTypes[tokenType]
    if (!type) continue
    const from = plugin.fromPosition({ line, character }, view.state.doc)
    const to = plugin.fromPosition({ line, character: character + length }, view.state.doc)
    if (to <= from || from < 0 || to > view.state.doc.length) continue
    const classes = [`cm-semantic-${safeClass(type)}`]
    for (let bit = 0; bit < legend.tokenModifiers.length && bit < 31; bit++) {
      if ((modifierBits & (1 << bit)) !== 0) {
        classes.push(`cm-semantic-${safeClass(legend.tokenModifiers[bit]!)}`)
      }
    }
    ranges.push(Decoration.mark({ class: classes.join(" ") }).range(from, to))
  }
  return Decoration.set(ranges, true)
}

async function requestSemanticTokens(view: EditorView): Promise<DecorationSet> {
  const plugin = LSPPlugin.get(view)
  const provider = plugin?.client.serverCapabilities?.semanticTokensProvider
  if (!plugin || !provider || typeof provider !== "object" || !("legend" in provider)) {
    return Decoration.none
  }
  plugin.client.sync()
  const result = await plugin.client.request<
    { textDocument: { uri: string } },
    SemanticTokensResult
  >("textDocument/semanticTokens/full", { textDocument: { uri: plugin.uri } })
  return decodeTokens(view, result?.data ?? [], (provider as SemanticTokenProvider).legend)
}

export function semanticTokens(): Extension {
  return [
    semanticTokenField,
    ViewPlugin.define(view => {
      let timer: ReturnType<typeof setTimeout> | null = null
      let stamp = 0
      let connected = LSPPlugin.get(view) != null
      const schedule = () => {
        if (timer != null) clearTimeout(timer)
        const requestStamp = ++stamp
        const doc = view.state.doc
        timer = setTimeout(() => {
          timer = null
          if (view.composing) return
          connected = LSPPlugin.get(view) != null
          void requestSemanticTokens(view).then(tokens => {
            if (requestStamp !== stamp || view.state.doc !== doc) return
            view.dispatch({ effects: setSemanticTokens.of(tokens) })
          }).catch(() => {})
        }, 180)
      }
      schedule()
      return {
        update(update) {
          const justConnected = !connected && LSPPlugin.get(view) != null
          if (justConnected) connected = true
          if (update.docChanged || justConnected) schedule()
        },
        destroy() {
          stamp++
          if (timer != null) clearTimeout(timer)
        },
      }
    }),
    EditorView.theme({
      ".cm-semantic-class, .cm-semantic-interface, .cm-semantic-enum, .cm-semantic-type, .cm-semantic-typeParameter": {
        color: "color-mix(in srgb, var(--gharargah-accent) 76%, var(--gharargah-text))",
      },
      ".cm-semantic-function, .cm-semantic-method, .cm-semantic-macro": {
        color: "color-mix(in srgb, var(--gharargah-accent) 58%, var(--gharargah-text))",
      },
      ".cm-semantic-parameter": {
        fontStyle: "italic",
      },
      ".cm-semantic-deprecated": {
        textDecoration: "line-through",
        opacity: "0.68",
      },
      ".cm-semantic-readonly": {
        fontWeight: "600",
      },
    }),
  ]
}
