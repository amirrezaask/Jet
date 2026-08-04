import { useEffect } from "react"
import type { PanelId } from "@yaade/shared"
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
} from "@yaade/workspace"
import { useLatest } from "./useLatest.js"

export type GlobalKeymapRefs = {
  /** Prefer a live getter so registerUser races can't leave an empty snapshot. */
  getKeyBindings?: () => JetKeyBinding[]
  keymapBindings: JetKeyBinding[]
  keymapContext: KeymapContext
  workspace: WorkspaceService
  getFocusedPanel: () => PanelId | null
  getEditorPanel: () => PanelId | null
  executeCommand: (name: string) => Promise<void>
  runKeyBinding: (binding: JetKeyBinding) => void
  setPendingChordPrefix: (prefix: string | null) => void
}

export function useGlobalKeymap(refs: GlobalKeymapRefs): void {
  const bindingsRef = useLatest(refs.keymapBindings)
  const getBindingsRef = useLatest(refs.getKeyBindings)
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

    const closeActiveTab = () => {
      const ctx = contextRef.current
      if (!workspaceRef.current.manager.hasFolders() || anyOverlayOpen(ctx)) return
      const now = Date.now()
      if (now - lastCloseAt < 100) return
      lastCloseAt = now
      void executeCommandRef.current("layout.closeTab")
    }

    const dispatchKeyBinding = (e: KeyboardEvent, opts?: { allowEditor?: boolean }): boolean => {
      const allowEditor = opts?.allowEditor ?? false
      const ctx = contextRef.current
      const bindings = getBindingsRef.current?.() ?? bindingsRef.current
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
        return false
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
      // Radix portal content owns Escape and menu navigation. Let it receive
      // those keys before the shell-level Escape → Home binding.
      if (target instanceof Element && target.closest('[data-slot="context-menu-content"]')) return
      const inXterm = target instanceof HTMLElement && target.closest(".xterm") != null
      // Monaco find/replace inputs stay focused after the widget hides; still
      // allow shell chords (Mod-Shift-f → editor find, etc.) to run.
      const inMonacoChrome =
        target instanceof HTMLElement &&
        target.closest(".monaco-editor, .find-widget, .replace-widget") != null
      if (
        !inMonacoChrome &&
        (target instanceof HTMLInputElement ||
          (target instanceof HTMLTextAreaElement && !inXterm))
      ) {
        return
      }

      if (ctx.terminalFocus || inXterm) {
        if (keyEventMatchesBinding(e, "Mod-w") || keyEventMatchesBinding(e, "Cmd-w")) {
          if (!workspaceRef.current.manager.hasFolders() || anyOverlayOpen(ctx)) return
          e.preventDefault()
          e.stopPropagation()
          closeActiveTab()
          return
        }
        if (dispatchKeyBinding(e)) return
        if (
          keyEventMatchesBinding(e, "Mod-=") ||
          keyEventMatchesBinding(e, "Mod--") ||
          keyEventMatchesBinding(e, "Cmd-=") ||
          keyEventMatchesBinding(e, "Cmd--")
        ) {
          e.preventDefault()
          e.stopPropagation()
          void executeCommandRef.current(
            keyEventMatchesBinding(e, "Mod--") || keyEventMatchesBinding(e, "Cmd--")
              ? "ui.zoomOut"
              : "ui.zoomIn",
          )
          return
        }
        if (ctx.terminalFocus && !inXterm) {
          const panel = getFocusedPanelRef.current()
          const selector = panel
            ? `[data-yaade-panel-leaf="${panel.id}"] [data-yaade-tab-slot][data-yaade-tab-active] [data-yaade-terminal-panel] .xterm-helper-textarea, [data-yaade-mux-terminal-host][data-focused] [data-yaade-terminal-panel] .xterm-helper-textarea`
            : "[data-yaade-tab-slot][data-yaade-tab-active] [data-yaade-terminal-panel] .xterm-helper-textarea, [data-yaade-mux-terminal-host][data-focused] [data-yaade-terminal-panel] .xterm-helper-textarea"
          const textarea = document.querySelector<HTMLTextAreaElement>(selector)
          if (textarea && document.activeElement !== textarea) textarea.focus()
        }
        return
      }

      if (keyEventMatchesBinding(e, "Mod-w") || keyEventMatchesBinding(e, "Cmd-w")) {
        if (!workspaceRef.current.manager.hasFolders()) return
        e.preventDefault()
        e.stopPropagation()
        closeActiveTab()
        return
      }
      dispatchKeyBinding(e, { allowEditor: true })
    }

    const onNativeCloseTab = () => closeActiveTab()

    window.addEventListener("keydown", onKey, true)
    window.addEventListener("jet-close-tab", onNativeCloseTab)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("jet-close-tab", onNativeCloseTab)
      if (chordTimeout != null) window.clearTimeout(chordTimeout)
    }
  }, [
    bindingsRef,
    getBindingsRef,
    contextRef,
    workspaceRef,
    getFocusedPanelRef,
    getEditorPanelRef,
    executeCommandRef,
    runKeyBindingRef,
    setPendingChordPrefixRef,
  ])
}
