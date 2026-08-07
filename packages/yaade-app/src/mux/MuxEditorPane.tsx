import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import type { YaadeTheme } from "@yaade/shared"
import type { WorkspaceService } from "@yaade/workspace"
import {
  MonacoEditorHost,
  monacoLanguageId,
  revealPosition,
  consumePendingInitialContent,
  getMonacoEditorDiagnostics,
  type MonacoEditorHandle,
} from "@yaade/monaco"
import { setPendingEditorNavigation } from "@yaade/monaco/pending"
import { ensureMonacoWorkersConfigured } from "../editor/monaco-workers.js"
import { setMonacoDiagnosticsProvider } from "../editor/editor-diagnostics.js"
import { editorBufferServiceFor } from "../editor/editor-buffer-service.js"
import {
  getEditorViewState,
  setEditorViewState,
} from "../editor/editor-view-state-store.js"

setMonacoDiagnosticsProvider(getMonacoEditorDiagnostics)

/** Broadcast to save the focused editor pane (dispatched by `editor.save`). */
export const MUX_EDITOR_SAVE_EVENT = "yaade:mux-editor-save"

export type MuxEditorPaneProps = {
  uri: string
  line?: number
  column?: number
  theme: YaadeTheme
  workspace: WorkspaceService
  sessionId: string
  focused: boolean
  /** Stable per-pane id so Monaco restores view state across buffer swaps. */
  viewStateId?: string
  onReady?: () => void
  onQuickOpen?: () => void
  onCommandPalette?: () => void
  onViewStatePersist?: () => void
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
 * FS through EditorBufferService, attaches a view to the durable model, and
 * saves the focused pane on the {@link MUX_EDITOR_SAVE_EVENT} window event.
 */
export default function MuxEditorPane(props: MuxEditorPaneProps) {
  const {
    uri,
    line,
    column,
    theme,
    workspace,
    sessionId,
    focused,
    viewStateId,
    onReady,
    onQuickOpen,
    onCommandPalette,
    onViewStatePersist,
  } = props

  const [displayUri, setDisplayUri] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const buffers = useMemo(() => editorBufferServiceFor(workspace), [workspace])

  const languageId = useMemo(() => languageIdForUri(displayUri ?? uri), [displayUri, uri])

  const editorRef = useRef<MonacoEditorHandle | null>(null)
  const focusedRef = useRef(focused)
  focusedRef.current = focused
  const displayUriRef = useRef(uri)
  displayUriRef.current = displayUri ?? uri
  const resolvedViewStateId = viewStateId ?? displayUri ?? uri
  const initialViewState = getEditorViewState(
    sessionId,
    resolvedViewStateId,
    displayUri ?? uri,
  ) as monaco.editor.ICodeEditorViewState | null
  const handleViewStateChange = useCallback(
    (targetUri: string, state: monaco.editor.ICodeEditorViewState | null) => {
      setEditorViewState(sessionId, resolvedViewStateId, targetUri, state)
      onViewStatePersist?.()
    },
    [onViewStatePersist, resolvedViewStateId, sessionId],
  )

  useEffect(() => {
    if (line == null || line <= 0) return
    const col = column != null && column > 0 ? column : 1
    setPendingEditorNavigation(uri, { line, column: col })
    const editor = editorRef.current
    if (editor && displayUri === uri) revealPosition(editor, line, col)
  }, [uri, line, column, displayUri])

  useEffect(() => {
    let cancelled = false
    void ensureMonacoWorkersConfigured()
    // Drop stale buffer immediately so a failed/slow load never paints the
    // previous file under the new tab label (stdlib / external goto-def).
    setDisplayUri(previous => (previous === uri ? previous : null))
    setError(null)
    void (async () => {
      try {
        const pending = consumePendingInitialContent(uri)
        await buffers.open({
          uri,
          languageId: languageIdForUri(uri),
          ...(pending == null ? {} : { initialContent: pending }),
          initialDirty: uri.startsWith("untitled:") && Boolean(pending),
        })
        if (cancelled) return
        setError(null)
        setDisplayUri(uri)
      } catch (e) {
        if (cancelled) return
        setDisplayUri(null)
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [buffers, uri])

  const doSave = useCallback(async () => {
    const editor = editorRef.current
    const fs = typeof window !== "undefined" ? window.yaade?.fs : undefined
    const model = editor?.getModel()
    const saveUri = displayUriRef.current
    if (!editor || !fs || !model) return
    const value = model.getValue()
    try {
      await fs.writeFile(saveUri, value)
      buffers.markSaved(saveUri)
    } catch {
      /* keep dirty flag on write failure */
    }
  }, [buffers])

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

  if (displayUri == null || displayUri !== uri) {
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
      data-yaade-mux-editor-uri={displayUri}
      className="h-full min-h-0 w-full min-w-0 overflow-hidden"
    >
      <MonacoEditorHost
        uri={displayUri}
        content=""
        languageId={languageId}
        theme={theme}
        viewStateId={viewStateId ?? displayUri}
        initialViewState={initialViewState}
        onViewStateChange={handleViewStateChange}
        autoFocus={focused}
        onReady={handle => {
          editorRef.current = handle
          onReady?.()
        }}
        onQuickOpen={onQuickOpen}
        onCommandPalette={onCommandPalette}
      />
    </div>
  )
}
