import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { YaadeTheme } from "@yaade/shared"
import {
  MonacoEditorHost,
  monacoLanguageId,
  revealPosition,
  type MonacoEditorHandle,
} from "@yaade/monaco"
import { setPendingEditorNavigation } from "@yaade/monaco/pending"
import { ensureMonacoWorkersConfigured } from "../editor/monaco-workers.js"

/** Broadcast to save the focused editor pane (dispatched by `editor.save`). */
export const MUX_EDITOR_SAVE_EVENT = "yaade:mux-editor-save"

export type MuxEditorPaneProps = {
  uri: string
  line?: number
  theme: YaadeTheme
  focused: boolean
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
 * FS, tracks dirty state against the on-disk baseline, and saves the focused
 * pane on the {@link MUX_EDITOR_SAVE_EVENT} window event.
 */
export default function MuxEditorPane(props: MuxEditorPaneProps) {
  const {
    uri,
    line,
    theme,
    focused,
    onDirtyChange,
    onReady,
    onQuickOpen,
    onCommandPalette,
    onEnsureLsp,
  } = props

  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const languageId = useMemo(() => languageIdForUri(uri), [uri])

  const editorRef = useRef<MonacoEditorHandle | null>(null)
  const savedContentRef = useRef("")
  const dirtyRef = useRef(false)
  const focusedRef = useRef(focused)
  focusedRef.current = focused
  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange

  const setDirty = useCallback((next: boolean) => {
    if (dirtyRef.current === next) return
    dirtyRef.current = next
    onDirtyChangeRef.current?.(next)
  }, [])

  // Queue navigation before the host mounts / swaps models; also jump directly
  // when the editor already exists and only the target line changed.
  useEffect(() => {
    if (line == null || line <= 0) return
    setPendingEditorNavigation(uri, { line, column: 1 })
    const editor = editorRef.current
    if (editor) revealPosition(editor, line, 1)
  }, [uri, line])

  useEffect(() => {
    let cancelled = false
    void ensureMonacoWorkersConfigured()
    const fs = typeof window !== "undefined" ? window.yaade?.fs : undefined
    if (!fs) {
      setError("File system unavailable")
      return
    }
    setContent(null)
    setError(null)
    void (async () => {
      try {
        const text = await fs.readFile(uri)
        if (cancelled) return
        savedContentRef.current = text
        setDirty(false)
        setContent(text)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [uri, setDirty])

  useEffect(() => {
    if (content == null || error != null) return
    onEnsureLsp?.(uri)
  }, [uri, content, error, onEnsureLsp])

  const doSave = useCallback(async () => {
    const editor = editorRef.current
    const fs = typeof window !== "undefined" ? window.yaade?.fs : undefined
    const model = editor?.getModel()
    if (!editor || !fs || !model) return
    const value = model.getValue()
    try {
      await fs.writeFile(uri, value)
      savedContentRef.current = value
      setDirty(false)
    } catch {
      /* keep dirty flag on write failure */
    }
  }, [uri, setDirty])

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

  if (content == null) {
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
      className="h-full min-h-0 w-full min-w-0 overflow-hidden"
    >
      <MonacoEditorHost
        uri={uri}
        content={content}
        languageId={languageId}
        theme={theme}
        viewStateId={uri}
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
