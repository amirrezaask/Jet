import { useEffect, useRef } from "react"
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import type { GharargahTheme } from "@gharargah/shared"
import "./monaco-features.js"
import { ensureMonacoEnvironment } from "./monaco-env.js"
import { isLargeFile } from "./language.js"
import { monacoModels } from "./model-registry.js"
import { applyGharargahMonacoTheme } from "./theme.js"
import { MonacoCursorGhostTrail } from "./cursor-ghost-trail.js"

export type MonacoDiffEditorHostProps = {
  originalUri: string
  modifiedUri: string
  originalContent: string
  modifiedContent: string
  languageId: string
  theme: GharargahTheme
  readOnly?: boolean
  renderSideBySide?: boolean
  onReady?: (editor: monaco.editor.IStandaloneDiffEditor) => void
  className?: string
}

function largeFileOptions(large: boolean): monaco.editor.IDiffEditorConstructionOptions {
  if (!large) return {}
  return {
    renderSideBySide: true,
    ignoreTrimWhitespace: false,
    renderOverviewRuler: false,
  }
}

export function MonacoDiffEditorHost({
  originalUri,
  modifiedUri,
  originalContent,
  modifiedContent,
  languageId,
  theme,
  readOnly = true,
  renderSideBySide = true,
  onReady,
  className,
}: MonacoDiffEditorHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    ensureMonacoEnvironment()
    const container = containerRef.current
    if (!container) return

    const large = isLargeFile(originalContent) || isLargeFile(modifiedContent)

    const originalModel = monacoModels.getOrCreate(originalUri, originalContent, languageId)
    const modifiedModel = monacoModels.getOrCreate(modifiedUri, modifiedContent, languageId)

    const editor = monaco.editor.createDiffEditor(container, {
      automaticLayout: false,
      readOnly,
      renderSideBySide,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      fontFamily: "var(--font-mono, 'Geist Mono', 'IBM Plex Mono', monospace)",
      fontSize: 14,
      lineHeight: 22,
      ...largeFileOptions(large),
    })

    editor.setModel({
      original: originalModel,
      modified: modifiedModel,
    })

    editorRef.current = editor
    const originalCursorGhostTrail = new MonacoCursorGhostTrail(editor.getOriginalEditor())
    const modifiedCursorGhostTrail = new MonacoCursorGhostTrail(editor.getModifiedEditor())
    applyGharargahMonacoTheme(theme)

    const resizeObserver = new ResizeObserver(() => {
      editor.layout()
    })
    resizeObserver.observe(container)

    onReadyRef.current?.(editor)

    return () => {
      resizeObserver.disconnect()
      originalCursorGhostTrail.dispose()
      modifiedCursorGhostTrail.dispose()
      editor.dispose()
      editorRef.current = null
      monacoModels.release(originalUri)
      monacoModels.release(modifiedUri)
      monacoModels.disposeIfUnreferenced(originalUri)
      monacoModels.disposeIfUnreferenced(modifiedUri)
    }
  // Content and presentation changes are updated in place below. Recreating the
  // diff editor for every Git refresh discards scroll state and repeats layout.
  }, [originalUri, modifiedUri, languageId])

  useEffect(() => {
    applyGharargahMonacoTheme(theme)
  }, [theme])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    monacoModels.updateContent(originalUri, originalContent, { preserveCursor: true })
    monacoModels.updateContent(modifiedUri, modifiedContent, { preserveCursor: true })
    monacoModels.setLanguage(originalUri, languageId)
    monacoModels.setLanguage(modifiedUri, languageId)
    editor.updateOptions({ readOnly, renderSideBySide })
  }, [originalUri, modifiedUri, originalContent, modifiedContent, languageId, readOnly, renderSideBySide])

  return (
    <div
      ref={containerRef}
      className={className}
      data-gharargah-monaco-diff-editor
      aria-label="Diff editor"
      style={{ width: "100%", height: "100%", minHeight: 0, minWidth: 0 }}
    />
  )
}
