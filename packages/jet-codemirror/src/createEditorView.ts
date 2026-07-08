import { Compartment, EditorState, Prec, Text, type Extension } from "@codemirror/state"
import {
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightTrailingWhitespace,
  scrollPastEnd,
} from "@codemirror/view"
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  addCursorAbove,
  addCursorBelow,
} from "@codemirror/commands"
import {
  autocompletion,
  completeAnyWord,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
  type CompletionSource,
} from "@codemirror/autocomplete"
import { completionTooltipClass, completionTooltipTheme } from "./completion-theme.js"
import {
  bracketMatching,
  indentOnInput,
  indentUnit,
  foldGutter,
  codeFolding,
  foldKeymap,
} from "@codemirror/language"
import { lintGutter } from "@codemirror/lint"
import { indentationMarkers } from "@replit/codemirror-indentation-markers"
import { search, searchKeymap, highlightSelectionMatches, selectSelectionMatches, selectNextOccurrence } from "@codemirror/search"
import { hiddenSearchPanel, jetSearchPanelKeymap } from "./search-bridge.js"
import { LSPClient, jumpToDefinition } from "@codemirror/lsp-client"
import { lspLanguageIdFromJet } from "@jet/shared"
import type { WorkspaceFile } from "@jet/workspace"
import type { WorkspaceService } from "@jet/workspace"
import type { JetKeyBinding } from "@jet/workspace"
import type { KeymapContext } from "@jet/workspace"
import { jetKeyToCodeMirrorKey, matchesWhen, isEditorKeyBinding } from "@jet/workspace"
import { jetEditorTheme, jetSyntaxHighlightingForTheme } from "./theme.js"
import { defaultJetTheme, type JetTheme } from "./theme-types.js"
import { multiCursorExtensions, skipNextOccurrence } from "./multi-cursor.js"
import { loadLanguage } from "./languages.js"
import { eolOverlayExtension } from "./eol-overlays.js"
import { perfMeasure } from "./perf-instrumentation.js"
import { jetReloadAnnotation } from "./reload-annotation.js"
import { detectIndent, indentUnitFor, type DetectedIndent } from "./detect-indent.js"

const wordCompletionSource: CompletionSource = async context => {
  const result = await completeAnyWord(context)
  if (!result) return result
  return {
    ...result,
    options: result.options.map(o => ({ ...o, type: o.type ?? "text" })),
  }
}

const documentWordCompletion = EditorState.languageData.of(() => [
  { autocomplete: wordCompletionSource },
])

/** Highest-priority multi-cursor keys — must beat browser/Electron defaults (e.g. Cmd+D bookmark). */
const multiCursorPrecKeymap = Prec.highest(
  keymap.of([
    {
      key: "Mod-d",
      run: view => selectNextOccurrence({ state: view.state, dispatch: tr => view.dispatch(tr) }),
      preventDefault: true,
    },
    { key: "Mod-k Mod-d", run: skipNextOccurrence, preventDefault: true },
  ]),
)

/** Sublime-style multi-cursor keys at CM layer (Jet keymap also binds these for palette/chords). */
const sublimeMultiCursorKeymap = keymap.of([
  { key: "Ctrl-Shift-ArrowUp", run: addCursorAbove },
  { key: "Ctrl-Shift-ArrowDown", run: addCursorBelow },
  { mac: "Cmd-Alt-ArrowUp", run: addCursorAbove },
  { mac: "Cmd-Alt-ArrowDown", run: addCursorBelow },
  {
    key: "Mod-Ctrl-g",
    run: view => selectSelectionMatches({ state: view.state, dispatch: tr => view.dispatch(tr) }),
  },
])

let globalScopeCompletionSource: CompletionSource | null = null
let globalScopeCompletionSourcePromise: Promise<CompletionSource> | null = null

async function resolveGlobalScopeCompletionSource(): Promise<CompletionSource> {
  if (globalScopeCompletionSource) return globalScopeCompletionSource
  if (!globalScopeCompletionSourcePromise) {
    globalScopeCompletionSourcePromise = import("@codemirror/lang-javascript").then(mod => {
      const source = mod.scopeCompletionSource(globalThis)
      globalScopeCompletionSource = source
      return source
    })
  }
  return globalScopeCompletionSourcePromise
}

const jsScopeCompletion = EditorState.languageData.of(() => [
  {
    autocomplete: (async context => {
      const source = await resolveGlobalScopeCompletionSource()
      const result = await source(context)
      if (!result) return result
      return {
        ...result,
        options: result.options.map(o => ({ ...o, type: o.type ?? "variable" })),
      }
    }) satisfies CompletionSource,
  },
])

function isJavaScriptLike(languageId: string): boolean {
  return (
    languageId === "javascript" ||
    languageId === "typescript" ||
    languageId === "jsx" ||
    languageId === "tsx" ||
    languageId === "mjs" ||
    languageId === "cjs" ||
    languageId === "mts" ||
    languageId === "cts"
  )
}

export const userKeymapCompartment = new Compartment()
export const languageCompartment = new Compartment()
export const completionCompartment = new Compartment()
export const lspCompartment = new Compartment()
export const extensionCompartment = new Compartment()
export const themeCompartment = new Compartment()
export const highlightCompartment = new Compartment()
export const indentMarkerCompartment = new Compartment()
export const readOnlyCompartment = new Compartment()
export const lineWrappingCompartment = new Compartment()

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
  readOnly?: boolean
  lineWrapping?: boolean
}

const goToDefinitionOnClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false
    jumpToDefinition(view)
    event.preventDefault()
    return true
  },
})

export async function createJetEditorView(opts: CreateJetEditorViewOptions): Promise<EditorView> {
  const theme = opts.theme ?? defaultJetTheme
  const largeFile = opts.largeFile ?? false
  const indent = opts.indent ?? detectIndent(opts.initialText)

  const extensions: Extension[] = [
    EditorState.allowMultipleSelections.of(true),
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    codeFolding(),
    foldGutter(),
    dropCursor(),
    scrollPastEnd(),
    EditorState.tabSize.of(indent.size),
    indentUnit.of(indentUnitFor(indent)),
    readOnlyCompartment.of(EditorState.readOnly.of(opts.readOnly ?? false)),
    lineWrappingCompartment.of(opts.lineWrapping ? EditorView.lineWrapping : []),
  ]

  extensions.push(drawSelection({ cursorBlinkRate: 0 }))

  extensions.push(indentMarkerCompartment.of(indentMarkerExtension(theme, largeFile)))

  if (!largeFile) {
    extensions.push(eolOverlayExtension(), highlightTrailingWhitespace(), lintGutter())
  }

  extensions.push(
    goToDefinitionOnClick,
    ...multiCursorExtensions(),
    multiCursorPrecKeymap,
    search({ top: true, createPanel: hiddenSearchPanel }),
  )

  if (!largeFile) {
    extensions.push(highlightSelectionMatches())
  }

  extensions.push(
    jetSearchPanelKeymap(),
    sublimeMultiCursorKeymap,
    keymap.of([
      ...searchKeymap.map(binding =>
        binding.key === "Mod-Shift-l"
          ? {
              key: "Mod-Shift-l",
              run: (view: EditorView) =>
                selectSelectionMatches({ state: view.state, dispatch: tr => view.dispatch(tr) }),
            }
          : binding.key === "Mod-d"
            ? {
                key: "Mod-d",
                run: (view: EditorView) =>
                  selectNextOccurrence({ state: view.state, dispatch: tr => view.dispatch(tr) }),
                preventDefault: true,
              }
            : binding,
      ),
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...foldKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    themeCompartment.of([jetEditorTheme(theme), completionTooltipTheme(theme)]),
  )

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
        tooltipClass: () => completionTooltipClass,
      }),
    ),
    documentWordCompletion,
    ...(isJavaScriptLike(opts.file.languageId) ? [jsScopeCompletion] : []),
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
      themeCompartment.reconfigure([jetEditorTheme(theme), completionTooltipTheme(theme)]),
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

export function setReadOnly(view: EditorView, readOnly: boolean): void {
  view.dispatch({
    effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
  })
}

export function setLineWrapping(view: EditorView, wrap: boolean): void {
  view.dispatch({
    effects: lineWrappingCompartment.reconfigure(wrap ? EditorView.lineWrapping : []),
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
      if (!keymapContext || !b.when) return false
      if (!matchesWhen(b, keymapContext)) return false
      if (!isEditorKeyBinding(b, keymapContext)) return false
      return keymapContext.editorFocus
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
      effects: userKeymapCompartment.reconfigure(Prec.high(keymap.of(cmBindings))),
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
