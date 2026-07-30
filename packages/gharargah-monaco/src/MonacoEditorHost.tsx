import { useEffect, useId, useRef } from "react"
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import type { GharargahTheme } from "@gharargah/shared"
import "./monaco-features.js"
import { ensureMonacoEnvironment } from "./monaco-env.js"
import { isLargeFile } from "./language.js"
import { monacoModels } from "./model-registry.js"
import { applyGharargahMonacoTheme } from "./theme.js"
import {
  applyPendingNavigation,
  consumePendingInitialContent,
} from "./navigation.js"
import {
  getActiveMonacoEditor,
  setActiveMonacoEditor,
  type MonacoEditorHandle,
} from "./editor-api.js"
import { MonacoCursorGhostTrail } from "./cursor-ghost-trail.js"
import {
  interceptPrimaryCommandPaletteShortcut,
  interceptPrimaryQuickOpenShortcut,
} from "./editor-shortcuts.js"

export type MonacoEditorHostProps = {
  uri: string
  content: string
  languageId: string
  theme: GharargahTheme
  readOnly?: boolean
  autoFocus?: boolean
  /** Stable surface identity used to restore cursor, selections, folds, and scroll. */
  viewStateId?: string
  onReady?: (editor: MonacoEditorHandle) => void
  onContentChange?: (model: monaco.editor.ITextModel) => void
  onFocusChange?: (focused: boolean) => void
  onCursorChange?: (line: number, column: number) => void
  onQuickOpen?: () => void
  onCommandPalette?: () => void
  className?: string
}

function largeFileOptions(large: boolean): monaco.editor.IStandaloneEditorConstructionOptions {
  if (!large) return {}
  return {
    minimap: { enabled: false },
    folding: false,
    renderLineHighlight: "none",
    wordBasedSuggestions: "off",
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    parameterHints: { enabled: false },
    occurrencesHighlight: "off",
    selectionHighlight: false,
    codeLens: false,
    links: false,
    colorDecorators: false,
    hover: { enabled: false },
  }
}

export function MonacoEditorHost({
  uri,
  content,
  languageId,
  theme,
  readOnly = false,
  autoFocus = false,
  viewStateId,
  onReady,
  onContentChange,
  onFocusChange,
  onCursorChange,
  onQuickOpen,
  onCommandPalette,
  className,
}: MonacoEditorHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<MonacoEditorHandle | null>(null)
  const generatedEditorId = useId()
  const editorId = viewStateId ?? generatedEditorId
  const uriRef = useRef(uri)
  const onReadyRef = useRef(onReady)
  const onContentChangeRef = useRef(onContentChange)
  const onFocusChangeRef = useRef(onFocusChange)
  const onCursorChangeRef = useRef(onCursorChange)
  const onQuickOpenRef = useRef(onQuickOpen)
  const onCommandPaletteRef = useRef(onCommandPalette)

  onReadyRef.current = onReady
  onContentChangeRef.current = onContentChange
  onFocusChangeRef.current = onFocusChange
  onCursorChangeRef.current = onCursorChange
  onQuickOpenRef.current = onQuickOpen
  onCommandPaletteRef.current = onCommandPalette

  useEffect(() => {
    ensureMonacoEnvironment()
    const container = containerRef.current
    if (!container) return

    const pending = consumePendingInitialContent(uri)
    const initialContent = pending ?? content
    const large = isLargeFile(initialContent)

    let model = monacoModels.get(uri)
    if (!model) {
      model = monacoModels.getOrCreate(uri, initialContent, languageId)
    } else {
      monacoModels.acquire(uri)
    }

    const editor = monaco.editor.create(container, {
      model,
      automaticLayout: false,
      readOnly,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      fontFamily: "var(--font-mono, 'Commit Mono', ui-monospace, monospace)",
      fontSize: 14,
      lineHeight: 22,
      padding: { top: 8, bottom: 8 },
      renderWhitespace: "selection",
      bracketPairColorization: { enabled: true },
      smoothScrolling: true,
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: "on",
      ...largeFileOptions(large),
    })

    editorRef.current = editor
    const cursorGhostTrail = new MonacoCursorGhostTrail(editor)
    applyGharargahMonacoTheme(theme)

    const savedState = monacoModels.restoreViewState(editorId, uri)
    if (savedState) editor.restoreViewState(savedState)

    applyPendingNavigation(editor, uri)

    if (autoFocus) editor.focus()

    const disposables: monaco.IDisposable[] = []

    disposables.push(
      editor.onDidChangeModelContent(() => {
        const currentModel = editor.getModel()
        if (currentModel) onContentChangeRef.current?.(currentModel)
      }),
    )

    disposables.push(
      editor.onDidFocusEditorText(() => {
        setActiveMonacoEditor(editor)
        onFocusChangeRef.current?.(true)
      }),
    )

    disposables.push(
      editor.onDidBlurEditorText(() => {
        onFocusChangeRef.current?.(false)
      }),
    )

    disposables.push(
      editor.onDidChangeCursorPosition(e => {
        onCursorChangeRef.current?.(e.position.lineNumber, e.position.column)
      }),
    )

    disposables.push(
      editor.onKeyDown(event => {
        const browserEvent = event.browserEvent
        const platform = navigator.platform
        if (
          interceptPrimaryQuickOpenShortcut(
            browserEvent,
            platform,
            () => onQuickOpenRef.current?.(),
          )
        ) {
          return
        }
        interceptPrimaryCommandPaletteShortcut(
          browserEvent,
          platform,
          () => onCommandPaletteRef.current?.(),
        )
      }),
    )

    const resizeObserver = new ResizeObserver(() => {
      editor.layout()
    })
    resizeObserver.observe(container)

    onReadyRef.current?.(editor)

    return () => {
      const currentUri = uriRef.current
      const state = editor.saveViewState()
      monacoModels.saveViewState(editorId, currentUri, state)
      resizeObserver.disconnect()
      for (const d of disposables) d.dispose()
      cursorGhostTrail.dispose()
      editor.dispose()
      if (getActiveMonacoEditor() === editor) setActiveMonacoEditor(null)
      editorRef.current = null
      monacoModels.release(currentUri)
      monacoModels.disposeIfUnreferenced(currentUri)
    }
  }, [editorId])

  useEffect(() => {
    uriRef.current = uri
    const editor = editorRef.current
    if (!editor) return

    const previousUri = editor.getModel()?.uri.toString()
    if (previousUri === monacoModels.canonicalKey(uri)) {
      monacoModels.setLanguage(uri, languageId)
      return
    }

    const state = editor.saveViewState()
    if (previousUri) monacoModels.saveViewState(editorId, previousUri, state)

    const pending = consumePendingInitialContent(uri)
    let model = monacoModels.get(uri)
    if (!model) {
      model = monacoModels.getOrCreate(uri, pending ?? content, languageId)
    } else {
      monacoModels.acquire(uri)
    }

    editor.setModel(model)
    monacoModels.setLanguage(uri, languageId)

    const restored = monacoModels.restoreViewState(editorId, uri)
    if (restored) editor.restoreViewState(restored)
    else editor.setPosition({ lineNumber: 1, column: 1 })

    applyPendingNavigation(editor, uri)

    if (previousUri && previousUri !== monacoModels.canonicalKey(uri)) {
      monacoModels.release(previousUri)
      monacoModels.disposeIfUnreferenced(previousUri)
    }
  }, [uri, content, languageId, editorId])

  useEffect(() => {
    applyGharargahMonacoTheme(theme)
  }, [theme])

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly })
  }, [readOnly])

  useEffect(() => {
    if (autoFocus) editorRef.current?.focus()
  }, [autoFocus])

  return (
    <div
      ref={containerRef}
      className={className}
      data-gharargah-monaco-editor
      aria-label="Code editor"
      style={{ width: "100%", height: "100%", minHeight: 0, minWidth: 0 }}
    />
  )
}
