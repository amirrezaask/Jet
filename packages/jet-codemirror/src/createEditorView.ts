import { Compartment, EditorState, Text, type Extension } from "@codemirror/state"
import { EditorView, keymap, lineNumbers, drawSelection } from "@codemirror/view"
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands"
import { autocompletion, completeAnyWord, completionKeymap, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete"
import {
  completionContextMenuClass,
  completionContextMenuPlugin,
  completionContextMenuTheme,
} from "./completion-context-menu.js"
import { bracketMatching, indentOnInput, indentUnit } from "@codemirror/language"
import { indentationMarkers } from "@replit/codemirror-indentation-markers"
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search"
import { LSPClient, jumpToDefinition } from "@codemirror/lsp-client"
import { lspLanguageIdFromJet } from "@jet/shared"
import type { WorkspaceFile } from "@jet/workspace"
import type { WorkspaceService } from "@jet/workspace"
import type { JetKeyBinding } from "@jet/workspace"
import type { KeymapContext } from "@jet/workspace"
import { jetKeyToCodeMirrorKey, matchesWhen, isEditorKeyBinding } from "@jet/workspace"
import { jetEditorTheme, jetSyntaxHighlightingForTheme } from "./theme.js"
import { defaultJetTheme, type JetTheme } from "./theme-types.js"
import { motionCursor } from "./motion-cursor.js"
import { multiCursorExtensions } from "./multi-cursor.js"
import { loadLanguage } from "./languages.js"
import { eolOverlayExtension } from "./eol-overlays.js"
import { braceScopeExtension } from "./brace-scope-extension.js"
import { perfMeasure } from "./perf-instrumentation.js"
import { jetReloadAnnotation } from "./reload-annotation.js"
import { detectIndent, indentUnitFor, type DetectedIndent } from "./detect-indent.js"

export const userKeymapCompartment = new Compartment()
export const languageCompartment = new Compartment()
export const completionCompartment = new Compartment()
export const lspCompartment = new Compartment()
export const extensionCompartment = new Compartment()
export const themeCompartment = new Compartment()
export const highlightCompartment = new Compartment()
export const indentMarkerCompartment = new Compartment()

function indentMarkerExtension(theme: JetTheme, largeFile: boolean): Extension {
  return indentationMarkers({
    highlightActiveBlock: true,
    markerType: largeFile ? "codeOnly" : "fullScope",
    colors: {
      light: theme.colors.border,
      dark: theme.colors.border,
      activeLight: theme.colors.accent + "44",
      activeDark: theme.colors.accent + "44",
    },
  })
}

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
  onSelectionChange?: (line: number, column: number, rangeCount: number) => void
  onDocChange?: (doc: Text, meta: { isReload: boolean }) => void
  onViewUpdate?: (view: EditorView) => void
  largeFile?: boolean
  indent?: DetectedIndent
}

const goToDefinitionOnClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false
    jumpToDefinition(view)
    event.preventDefault()
    return true
  },
})

function jetWordCompletionSource(
  context: CompletionContext,
): CompletionResult | null | Promise<CompletionResult | null> {
  const result = completeAnyWord(context)
  if (!result) return null
  if (result instanceof Promise) {
    return result.then(r => (r ? { ...r, filter: false } : null))
  }
  return { ...result, filter: false }
}

export async function createJetEditorView(opts: CreateJetEditorViewOptions): Promise<EditorView> {
  const theme = opts.theme ?? defaultJetTheme
  const largeFile = opts.largeFile ?? false
  const indent = opts.indent ?? detectIndent(opts.initialText)

  const extensions: Extension[] = [
    lineNumbers(),
    history(),
    indentOnInput(),
    bracketMatching(),
    EditorState.tabSize.of(indent.size),
    indentUnit.of(indentUnitFor(indent)),
  ]

  if (largeFile) {
    extensions.push(drawSelection())
  }

  extensions.push(indentMarkerCompartment.of(indentMarkerExtension(theme, largeFile)))

  if (!largeFile) {
    extensions.push(eolOverlayExtension(), braceScopeExtension())
  }

  extensions.push(
    goToDefinitionOnClick,
    ...multiCursorExtensions(),
    search({ top: true }),
  )

  if (!largeFile) {
    extensions.push(highlightSelectionMatches())
  }

  extensions.push(
    keymap.of([
      ...searchKeymap,
      ...completionKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    themeCompartment.of(jetEditorTheme(theme)),
  )

  if (!largeFile) {
    extensions.push(motionCursor())
  }

  const language = await loadLanguage(opts.file.languageId)

  extensions.push(
    languageCompartment.of(language),
    highlightCompartment.of(jetSyntaxHighlightingForTheme(theme)),
    completionCompartment.of(
      autocompletion({
        activateOnTyping: true,
        activateOnTypingDelay: 75,
        defaultKeymap: false,
        selectOnOpen: true,
        closeOnBlur: false,
        override: [jetWordCompletionSource],
        tooltipClass: () => completionContextMenuClass,
      }),
    ),
    completionContextMenuTheme(),
    completionContextMenuPlugin(),
    userKeymapCompartment.of([]),
    lspCompartment.of([]),
    extensionCompartment.of(opts.userExtensions ?? []),
    EditorView.updateListener.of(update => {
      if (update.docChanged) {
        const isReload = update.transactions.some(tr => tr.annotation(jetReloadAnnotation))
        opts.onDocChange?.(update.state.doc, { isReload })
      }
      if (update.selectionSet && opts.onSelectionChange) {
        const pos = update.state.selection.main.head
        const line = update.state.doc.lineAt(pos)
        opts.onSelectionChange(line.number, pos - line.from + 1, update.state.selection.ranges.length)
      }
      opts.onViewUpdate?.(update.view)
    }),
  )

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
    opts.onSelectionChange(line.number, pos - line.from + 1, view.state.selection.ranges.length)
  }
  return view
}

export function applyTheme(view: EditorView, theme: JetTheme): void {
  const largeFile = view.state.doc.length > 4 * 1024 * 1024
  view.dispatch({
    effects: [
      themeCompartment.reconfigure(jetEditorTheme(theme)),
      highlightCompartment.reconfigure(jetSyntaxHighlightingForTheme(theme)),
      indentMarkerCompartment.reconfigure(indentMarkerExtension(theme, largeFile)),
    ],
  })
}

export async function reconfigureLanguage(
  view: EditorView,
  languageId: string,
  theme: JetTheme,
): Promise<void> {
  const language = await loadLanguage(languageId)
  view.dispatch({
    effects: [
      languageCompartment.reconfigure(language),
      highlightCompartment.reconfigure(jetSyntaxHighlightingForTheme(theme)),
    ],
  })
}

async function attachLsp(
  view: EditorView,
  uri: string,
  languageId: string,
  client: LSPClient,
): Promise<void> {
  await client.initializing
  const lspLanguageId = lspLanguageIdFromJet(languageId)
  view.dispatch({
    effects: lspCompartment.reconfigure(client.plugin(uri, lspLanguageId)),
  })
}

export function detachLsp(view: EditorView): void {
  view.dispatch({
    effects: lspCompartment.reconfigure([]),
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
  runBinding: (binding: JetKeyBinding, view: EditorView) => void,
  keymapContext?: KeymapContext,
): void {
  perfMeasure("jet:apply-user-keymaps", () => {
    const active = bindings.filter(b => {
      if (keymapContext && !matchesWhen(b, keymapContext)) return false
      if (!keymapContext || !b.when) return false
      return isEditorKeyBinding(b, keymapContext)
    })
    const cmBindings = active.flatMap(binding => {
      const cmKey = jetKeyToCodeMirrorKey(binding.key)
      if (!cmKey) return []
      return [
        {
          key: cmKey,
          run: (cmView: EditorView) => {
            runBinding(binding, cmView)
            return true
          },
        },
      ]
    })
    view.dispatch({
      effects: userKeymapCompartment.reconfigure(keymap.of(cmBindings)),
    })
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
