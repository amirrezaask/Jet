import type { IDisposable, Terminal } from "@xterm/xterm"
import { CanvasAddon } from "@xterm/addon-canvas"
import { WebglAddon } from "@xterm/addon-webgl"

export type TerminalGpuRendererKind = "webgl" | "canvas" | "dom"

export type TerminalGpuRendererHandle = {
  kind: TerminalGpuRendererKind
  dispose: () => void
}

/**
 * Prefer WebGL for agent/TUI paint storms; fall back to Canvas, then DomRenderer.
 * DomRenderer stays the last resort when GPU contexts fail (headless CI, context loss).
 */
export function attachTerminalGpuRenderer(term: Terminal): TerminalGpuRendererHandle {
  let active: IDisposable | null = null
  let kind: TerminalGpuRendererKind = "dom"
  let disposed = false

  const clearActive = () => {
    try {
      active?.dispose()
    } catch {
      /* addon may already be torn down with the terminal */
    }
    active = null
  }

  const tryCanvas = (): boolean => {
    clearActive()
    try {
      const canvas = new CanvasAddon()
      term.loadAddon(canvas)
      active = canvas
      kind = "canvas"
      return true
    } catch {
      clearActive()
      kind = "dom"
      return false
    }
  }

  const tryWebgl = (): boolean => {
    clearActive()
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        if (disposed) return
        try {
          webgl.dispose()
        } catch {
          /* ignore */
        }
        active = null
        if (!tryCanvas()) kind = "dom"
        const panel = term.element?.closest?.("[data-yaade-terminal-panel]") as
          | HTMLElement
          | null
          | undefined
        if (panel) panel.dataset.yaadeTerminalRenderer = kind
      })
      term.loadAddon(webgl)
      active = webgl
      kind = "webgl"
      return true
    } catch {
      clearActive()
      return tryCanvas()
    }
  }

  tryWebgl()

  return {
    get kind() {
      return kind
    },
    dispose() {
      disposed = true
      clearActive()
      kind = "dom"
    },
  }
}
