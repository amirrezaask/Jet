import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { YaadeTheme } from "@yaade/shared"
import {
  MonacoEditorHost,
  monacoLanguageId,
  monacoModels,
  revealPosition,
  consumePendingInitialContent,
  getMonacoEditorDiagnostics,
  type MonacoEditorHandle,
} from "@yaade/monaco"
import { setPendingEditorNavigation } from "@yaade/monaco/pending"
import { ensureMonacoWorkersConfigured } from "../editor/monaco-workers.js"
import { setMonacoDiagnosticsProvider } from "../editor/editor-diagnostics.js"

setMonacoDiagnosticsProvider(getMonacoEditorDiagnostics)

/** Broadcast to save the focused editor pane (dispatched by `editor.save`). */
export const MUX_EDITOR_SAVE_EVENT = "yaade:mux-editor-save"

/** Disk baselines for dirty tracking across tab switches (uri → saved text). */
const muxEditorBaselines = new Map<string, string>()

export type MuxEditorPaneProps = {
  uri: string
  line?: number
  column?: number
  theme: YaadeTheme
  focused: boolean
  /** Stable per-pane id so Monaco restores view state across buffer swaps. */
  viewStateId?: string
  onDirtyChange?: (dirty: boolean) => void
  onReady?: () => void
  onQuickOpen?: () => void
  onCommandPalette?: () => void
  /** Kick LSP attach for this file (noop when LSP unavailable). */
  onEnsureLsp?: (uri: string) => void
}

/** Best-effort language id from a file uri extension. */
function languageIdForUri(uri: string): string {
  const withoutQuery = uri.split(/[?#]/)[0] ?? uri
  const base = withoutQuery.split("/").pop() ?? withoutQuery
  const dot = base.lastIndexOf(".")
  const ext = dot > 0 ? base.slice(dot + 1) : ""
  return monacoLanguageId(ext || "plaintext")
}

/**
 * Compact Monaco editor pane for the mux shell. Loads its file over the host
 * FS (or reuses an existing Monaco model so tab switches keep dirty buffers),
 * tracks dirty state against the on-disk baseline, and saves the focused
 * pane on the {@link MUX_EDITOR_SAVE_EVENT} window event.
 */
export default function MuxEditorPane(props: MuxEditorPaneProps) {
  const {
    uri,
    line,
    column,
    theme,
    focused,
    viewStateId,
    onDirtyChange,
    onReady,
    onQuickOpen,
    onCommandPalette,
    onEnsureLsp,
  } = props

  /** Currently displayed buffer — kept until the next uri finishes loading. */
  const [display, setDisplay] = useState<{
    uri: string
    content: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const languageId = useMemo(
    () => languageIdForUri(display?.uri ?? uri),
    [display?.uri, uri],
  )

  const editorRef = useRef<MonacoEditorHandle | null>(null)
  const savedContentRef = useRef("")
  const dirtyRef = useRef(false)
  const focusedRef = useRef(focused)
  focusedRef.current = focused
  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange
  const displayUriRef = useRef(uri)
  displayUriRef.current = display?.uri ?? uri

  const setDirty = useCallback((next: boolean) => {
    if (dirtyRef.current === next) return
    dirtyRef.current = next
    onDirtyChangeRef.current?.(next)
  }, [])

  useEffect(() => {
    if (line == null || line <= 0) return
    const col = column != null && column > 0 ? column : 1
    setPendingEditorNavigation(uri, { line, column: col })
    const editor = editorRef.current
    if (editor && display?.uri === uri) revealPosition(editor, line, col)
  }, [uri, line, column, display?.uri])

  useEffect(() => {
    let cancelled = false
    void ensureMonacoWorkersConfigured()

    const applyLoaded = (targetUri: string, text: string, baseline: string) => {
      if (cancelled) return
      muxEditorBaselines.set(targetUri, baseline)
      savedContentRef.current = baseline
      setError(null)
      setDisplay({ uri: targetUri, content: text })
      setDirty(text !== baseline)
    }

    const existing = monacoModels.get(uri)
    if (existing) {
      const baseline = muxEditorBaselines.get(uri) ?? existing.getValue()
      applyLoaded(uri, existing.getValue(), baseline)
      return () => {
        cancelled = true
      }
    }

    // Untitled / pathless drops seed content via setPendingInitialContent — no FS.
    if (uri.startsWith("untitled:")) {
      const pending = consumePendingInitialContent(uri)
      applyLoaded(uri, pending ?? "", "")
      return () => {
        cancelled = true
      }
    }

    const fs = typeof window !== "undefined" ? window.yaade?.fs : undefined
    if (!fs) {
      setDisplay(null)
      setError("File system unavailable")
      return
    }
    // Drop stale buffer immediately so a failed/slow load never paints the
    // previous file under the new tab label (stdlib / external goto-def).
    setDisplay(prev => (prev?.uri === uri ? prev : null))
    setError(null)
    void (async () => {
      try {
        const text = await fs.readFile(uri)
        if (cancelled) return
        const raced = monacoModels.get(uri)
        if (raced) {
          const baseline = muxEditorBaselines.get(uri) ?? raced.getValue()
          applyLoaded(uri, raced.getValue(), baseline)
          return
        }
        applyLoaded(uri, text, text)
      } catch (e) {
        if (cancelled) return
        setDisplay(null)
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [uri, setDirty])

  useEffect(() => {
    if (!display || display.uri !== uri || error != null) return
    onEnsureLsp?.(uri)
  }, [uri, display, error, onEnsureLsp])

  const doSave = useCallback(async () => {
    const editor = editorRef.current
    const fs = typeof window !== "undefined" ? window.yaade?.fs : undefined
    const model = editor?.getModel()
    const saveUri = displayUriRef.current
    if (!editor || !fs || !model) return
    const value = model.getValue()
    try {
      await fs.writeFile(saveUri, value)
      muxEditorBaselines.set(saveUri, value)
      savedContentRef.current = value
      setDirty(false)
    } catch {
      /* keep dirty flag on write failure */
    }
  }, [setDirty])

  useEffect(() => {
    const onSaveRequest = () => {
      if (!focusedRef.current) return
      void doSave()
    }
    window.addEventListener(MUX_EDITOR_SAVE_EVENT, onSaveRequest)
    return () => window.removeEventListener(MUX_EDITOR_SAVE_EVENT, onSaveRequest)
  }, [doSave])

  if (error != null) {
    return (
      <div
        data-yaade-mux-editor-pane=""
        data-yaade-mux-editor-error=""
        className="flex h-full min-h-0 w-full items-center justify-center p-2 text-2xs text-muted-foreground"
      >
        {error}
      </div>
    )
  }

  if (display == null || display.uri !== uri) {
    return (
      <div
        data-yaade-mux-editor-pane=""
        aria-busy="true"
        className="flex h-full min-h-0 w-full items-center justify-center p-2 text-2xs text-muted-foreground"
      >
        Loading…
      </div>
    )
  }

  return (
    <div
      data-yaade-mux-editor-pane=""
      data-yaade-mux-editor-uri={display.uri}
      className="h-full min-h-0 w-full min-w-0 overflow-hidden"
    >
      <MonacoEditorHost
        uri={display.uri}
        content={display.content}
        languageId={languageId}
        theme={theme}
        viewStateId={viewStateId ?? display.uri}
        autoFocus={focused}
        onReady={handle => {
          editorRef.current = handle
          onReady?.()
        }}
        onContentChange={model => {
          setDirty(model.getValue() !== savedContentRef.current)
        }}
        onQuickOpen={onQuickOpen}
        onCommandPalette={onCommandPalette}
      />
    </div>
  )
}
