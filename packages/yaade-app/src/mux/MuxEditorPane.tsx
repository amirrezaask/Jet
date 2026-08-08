import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import { languageIdFromPath, type YaadeTheme } from "@yaade/shared"
import type { WorkspaceService } from "@yaade/workspace"
import { showYaadeToast } from "@yaade/ui/toast"
import {
  MonacoDiffEditorHost,
  MonacoEditorHost,
  revealPosition,
  consumePendingInitialContent,
  getMonacoEditorDiagnostics,
  type MonacoEditorHandle,
} from "@yaade/monaco"
import { setPendingEditorNavigation } from "@yaade/monaco/pending"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@yaade/ui/primitives"
import { ensureMonacoWorkersConfigured } from "../editor/monaco-workers.js"
import { setMonacoDiagnosticsProvider } from "../editor/editor-diagnostics.js"
import { editorBufferServiceFor } from "../editor/editor-buffer-service.js"
import type {
  EditorBufferComparison,
  EditorBufferSnapshot,
} from "../editor/editor-buffer-service.js"
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
  onSaveAsRequired?: (uri: string) => void
}

/** Best-effort language id from a file uri extension. */
function languageIdForUri(uri: string): string {
  return languageIdFromPath(uri.split(/[?#]/)[0] ?? uri)
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
    onSaveAsRequired,
  } = props

  const [displayUri, setDisplayUri] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bufferSnapshot, setBufferSnapshot] =
    useState<EditorBufferSnapshot | null>(null)
  const [comparison, setComparison] =
    useState<EditorBufferComparison | null>(null)
  const buffers = useMemo(
    () => editorBufferServiceFor(workspace, sessionId),
    [sessionId, workspace],
  )

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
          ownerId: resolvedViewStateId,
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
  }, [buffers, resolvedViewStateId, uri])

  useEffect(() => {
    setBufferSnapshot(buffers.snapshot(uri))
    const subscription = buffers.onDidChange(snapshot => {
      if (snapshot.uri === uri) setBufferSnapshot(snapshot)
    })
    return () => subscription.dispose()
  }, [buffers, uri])

  const doSave = useCallback(async () => {
    const saveUri = displayUriRef.current
    if (!editorRef.current) return
    try {
      await buffers.save(saveUri)
      showYaadeToast("File saved", { variant: "success" })
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "SAVE_AS_REQUIRED"
      ) {
        onSaveAsRequired?.(saveUri)
        return
      }
      showYaadeToast(
        error instanceof Error ? error.message : "Could not save file",
        { variant: "destructive" },
      )
    }
  }, [buffers, onSaveAsRequired])

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

  const runConflictAction = async (
    action: "compare" | "keep" | "reload",
  ) => {
    try {
      if (action === "compare") {
        setComparison(await buffers.compareWithDisk(displayUri))
        return
      }
      if (action === "keep") {
        await buffers.keepMine(displayUri)
        showYaadeToast("Saved your recovered changes", { variant: "success" })
        return
      }
      const viewState = editorRef.current?.saveViewState() ?? null
      await buffers.reloadFromDisk(displayUri)
      if (viewState) editorRef.current?.restoreViewState(viewState)
      showYaadeToast("Reloaded the file from disk")
    } catch (actionError) {
      showYaadeToast(
        actionError instanceof Error
          ? actionError.message
          : "Could not resolve the file conflict",
        { variant: "destructive" },
      )
    }
  }

  return (
    <div
      data-yaade-mux-editor-pane=""
      data-yaade-mux-editor-uri={displayUri}
      data-yaade-editor-conflict={bufferSnapshot?.externalConflict ? "true" : undefined}
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden"
    >
      {bufferSnapshot?.externalConflict ? (
        <div
          className="flex shrink-0 items-center gap-2 border-b border-warning/35 bg-warning/10 px-2 py-1 text-xs"
          role="alert"
        >
          <span className="min-w-0 flex-1 truncate">
            This file changed on disk while your edits were unsaved.
          </span>
          <Button size="xs" variant="ghost" onClick={() => void runConflictAction("compare")}>
            Compare
          </Button>
          <Button size="xs" variant="ghost" onClick={() => void runConflictAction("keep")}>
            Keep Mine
          </Button>
          <Button size="xs" variant="ghost" onClick={() => void runConflictAction("reload")}>
            Reload
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
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
      <Dialog
        open={comparison != null}
        onOpenChange={open => {
          if (!open) setComparison(null)
        }}
      >
        <DialogContent
          size="wide"
          className="flex h-[min(46rem,85vh)] max-w-[min(92rem,94vw)] flex-col gap-0 overflow-hidden p-0"
        >
          <DialogHeader className="shrink-0 border-b border-border px-4 py-3">
            <DialogTitle>Recovered changes</DialogTitle>
            <DialogDescription>
              Disk version on the left; your buffer on the right.
            </DialogDescription>
          </DialogHeader>
          {comparison ? (
            <div className="min-h-0 flex-1">
              <MonacoDiffEditorHost
                originalUri={`yaade-diff-original:${comparison.uri}`}
                modifiedUri={`yaade-diff-modified:${comparison.uri}`}
                originalContent={comparison.diskContent}
                modifiedContent={comparison.bufferContent}
                languageId={comparison.languageId}
                theme={theme}
                readOnly
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
