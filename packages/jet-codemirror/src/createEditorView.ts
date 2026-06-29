import { Compartment, EditorState, type Extension } from "@codemirror/state"
import { EditorView, keymap, lineNumbers, drawSelection } from "@codemirror/view"
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands"
import { bracketMatching, indentOnInput } from "@codemirror/language"
import { indentationMarkers } from "@replit/codemirror-indentation-markers"
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search"
import { LSPClient } from "@codemirror/lsp-client"
import type { WorkspaceFile } from "@jet/workspace"
import type { WorkspaceService } from "@jet/workspace"
import type { JetKeyBinding } from "@jet/workspace"
import type { KeymapContext } from "@jet/workspace"
import { jetKeyToCodeMirrorKey, matchesWhen } from "@jet/workspace"
import { jetThemeExtension } from "./theme.js"
import { defaultJetTheme, type JetTheme } from "./theme-types.js"
import { motionCursor } from "./motion-cursor.js"
import { multiCursorExtensions } from "./multi-cursor.js"
import { loadLanguage } from "./languages.js"

export const userKeymapCompartment = new Compartment()
export const languageCompartment = new Compartment()
export const lspCompartment = new Compartment()
export const extensionCompartment = new Compartment()

export type CreateJetEditorViewOptions = {
  parent: HTMLElement
  workspace: WorkspaceService
  file: WorkspaceFile
  initialText: string
  theme?: JetTheme
  lspClient?: LSPClient | null
  executeCommand: (name: string) => Promise<void>
  userExtensions?: Extension[]
  onViewCreated?: (view: EditorView) => void
  onSelectionChange?: (line: number, column: number) => void
}

export async function createJetEditorView(opts: CreateJetEditorViewOptions): Promise<EditorView> {
  const theme = opts.theme ?? defaultJetTheme
  const lang = await loadLanguage(opts.file.languageId)

  const extensions: Extension[] = [
    lineNumbers(),
    drawSelection(),
    history(),
    indentOnInput(),
    bracketMatching(),
    indentationMarkers({ highlightActiveBlock: true, markerType: "fullScope" }),
    ...multiCursorExtensions(),
    search({ top: true }),
    highlightSelectionMatches(),
    keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
    jetThemeExtension(theme),
    motionCursor(),
    languageCompartment.of(lang),
    userKeymapCompartment.of([]),
    extensionCompartment.of(opts.userExtensions ?? []),
    EditorView.updateListener.of(update => {
      if (update.docChanged) {
        opts.workspace.markDirty(opts.file.uri, true)
      }
      if (update.selectionSet && opts.onSelectionChange) {
        const pos = update.state.selection.main.head
        const line = update.state.doc.lineAt(pos)
        opts.onSelectionChange(line.number, pos - line.from + 1)
      }
    }),
  ]

  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({ doc: opts.initialText, extensions }),
  })

  if (opts.lspClient) {
    attachLsp(view, opts.file.uri, opts.file.languageId, opts.lspClient).catch(console.error)
  }

  opts.onViewCreated?.(view)
  if (opts.onSelectionChange) {
    const pos = view.state.selection.main.head
    const line = view.state.doc.lineAt(pos)
    opts.onSelectionChange(line.number, pos - line.from + 1)
  }
  return view
}

async function attachLsp(
  view: EditorView,
  uri: string,
  languageId: string,
  client: LSPClient,
): Promise<void> {
  await client.initializing
  view.dispatch({
    effects: lspCompartment.reconfigure(client.plugin(uri, languageId)),
  })
}

export async function reconfigureLsp(
  view: EditorView,
  uri: string,
  languageId: string,
  client: LSPClient,
): Promise<void> {
  await attachLsp(view, uri, languageId, client)
}

export function applyUserExtensions(view: EditorView, extensions: Extension[]): void {
  view.dispatch({
    effects: extensionCompartment.reconfigure(extensions),
  })
}

export function applyUserKeymaps(
  view: EditorView,
  bindings: JetKeyBinding[],
  runBinding: (binding: JetKeyBinding) => void,
  keymapContext?: KeymapContext,
): void {
  const active = keymapContext ? bindings.filter(b => matchesWhen(b, keymapContext)) : bindings
  const cmBindings = active.flatMap(binding => {
    const cmKey = jetKeyToCodeMirrorKey(binding.key)
    if (!cmKey) return []
    return [
      {
        key: cmKey,
        run: () => {
          runBinding(binding)
          return true
        },
      },
    ]
  })
  view.dispatch({
    effects: userKeymapCompartment.reconfigure(keymap.of(cmBindings)),
  })
}

export { openSearchPanel } from "@codemirror/search"

export function isLargeFile(text: string): boolean {
  if (text.length > 4 * 1024 * 1024) return true
  let lines = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 && ++lines > 200_000) return true
  }
  return false
}
