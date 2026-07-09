import { useEffect } from "react"
import type { EditorView } from "@codemirror/view"
import type { PanelId } from "@jet/shared"
import {
  anyOverlayOpen,
  CHORD_TIMEOUT_MS,
  createChordState,
  isChordBinding,
  isEditorKeyBinding,
  keyEventMatchesBinding,
  resolveKeydownBinding,
  type JetKeyBinding,
  type KeymapContext,
  type WorkspaceService,
} from "@jet/workspace"
import { getEditorView } from "@jet/ui"
import { useLatest } from "./useLatest.js"

export type GlobalKeymapRefs = {
  keymapBindings: JetKeyBinding[]
  keymapContext: KeymapContext
  workspace: WorkspaceService
  getFocusedPanel: () => PanelId | null
  getEditorPanel: () => PanelId | null
  executeCommand: (name: string) => Promise<void>
  runKeyBinding: (binding: JetKeyBinding, view?: EditorView) => void
  setPendingChordPrefix: (prefix: string | null) => void
}

export function useGlobalKeymap(refs: GlobalKeymapRefs): void {
  const bindingsRef = useLatest(refs.keymapBindings)
  const contextRef = useLatest(refs.keymapContext)
  const workspaceRef = useLatest(refs.workspace)
  const getFocusedPanelRef = useLatest(refs.getFocusedPanel)
  const getEditorPanelRef = useLatest(refs.getEditorPanel)
  const executeCommandRef = useLatest(refs.executeCommand)
  const runKeyBindingRef = useLatest(refs.runKeyBinding)
  const setPendingChordPrefixRef = useLatest(refs.setPendingChordPrefix)

  useEffect(() => {
    let lastCloseAt = 0
    const chordState = createChordState()
    let chordTimeout: number | null = null

    const clearPendingChord = () => {
      if (chordTimeout != null) window.clearTimeout(chordTimeout)
      chordTimeout = null
      setPendingChordPrefixRef.current(null)
    }

    const closeBuffer = () => {
      const ctx = contextRef.current
      if (!workspaceRef.current.manager.hasFolders() || anyOverlayOpen(ctx)) return
      const now = Date.now()
      if (now - lastCloseAt < 100) return
      lastCloseAt = now
      void executeCommandRef.current("workspace.closeBuffer")
    }

    const dispatchKeyBinding = (e: KeyboardEvent, opts?: { allowEditor?: boolean }): boolean => {
      const allowEditor = opts?.allowEditor ?? false
      const ctx = contextRef.current
      const bindings = bindingsRef.current
      const hadPendingChord = chordState.prefix != null
      const result = resolveKeydownBinding(e, bindings, ctx, chordState)
      if (result === "chord-started") {
        e.preventDefault()
        setPendingChordPrefixRef.current(chordState.prefix)
        if (chordTimeout != null) window.clearTimeout(chordTimeout)
        chordTimeout = window.setTimeout(clearPendingChord, CHORD_TIMEOUT_MS)
        return true
      }
      if (hadPendingChord && chordState.prefix == null) clearPendingChord()
      if (result && isChordBinding(result.key)) {
        e.preventDefault()
        runKeyBindingRef.current(result)
        return true
      }
      if (result && !isEditorKeyBinding(result, ctx)) {
        e.preventDefault()
        e.stopPropagation()
        runKeyBindingRef.current(result)
        return true
      }
      if (allowEditor && result && isEditorKeyBinding(result, ctx)) {
        const panel = getFocusedPanelRef.current() ?? getEditorPanelRef.current()
        const view = panel ? getEditorView(panel) : null
        if (view?.hasFocus || ctx.editorFocus) {
          e.preventDefault()
          e.stopPropagation()
          runKeyBindingRef.current(result, view ?? undefined)
          return true
        }
      }
      if (allowEditor && result) {
        e.preventDefault()
        runKeyBindingRef.current(result)
        return true
      }
      return false
    }

    const onKey = (e: KeyboardEvent) => {
      const ctx = contextRef.current
      if (anyOverlayOpen(ctx)) return
      const target = e.target
      const inXterm = target instanceof HTMLElement && target.closest(".xterm") != null
      if (target instanceof HTMLInputElement || (target instanceof HTMLTextAreaElement && !inXterm)) {
        return
      }

      if (ctx.terminalFocus || inXterm) {
        if (dispatchKeyBinding(e)) return
        if (keyEventMatchesBinding(e, "Cmd-=") || keyEventMatchesBinding(e, "Cmd--")) {
          e.preventDefault()
          e.stopPropagation()
          void executeCommandRef.current(keyEventMatchesBinding(e, "Cmd--") ? "ui.zoomOut" : "ui.zoomIn")
          return
        }
        if (ctx.terminalFocus && !inXterm) {
          const panel = getFocusedPanelRef.current()
          const selector = panel
            ? `[data-jet-panel-leaf="${panel.id}"] [data-jet-tab-slot][data-jet-tab-active] [data-jet-terminal-panel] .xterm-helper-textarea`
            : "[data-jet-tab-slot][data-jet-tab-active] [data-jet-terminal-panel] .xterm-helper-textarea"
          const textarea = document.querySelector<HTMLTextAreaElement>(selector)
          if (textarea && document.activeElement !== textarea) textarea.focus()
        }
        return
      }

      if (keyEventMatchesBinding(e, "Cmd-w")) {
        if (!workspaceRef.current.manager.hasFolders()) return
        e.preventDefault()
        e.stopPropagation()
        closeBuffer()
        return
      }
      dispatchKeyBinding(e, { allowEditor: true })
    }

    window.addEventListener("keydown", onKey, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      if (chordTimeout != null) window.clearTimeout(chordTimeout)
    }
  }, [
    bindingsRef,
    contextRef,
    workspaceRef,
    getFocusedPanelRef,
    getEditorPanelRef,
    executeCommandRef,
    runKeyBindingRef,
    setPendingChordPrefixRef,
  ])
}
