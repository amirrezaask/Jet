import { useEffect } from "react"
import { handleTerminalFileDropAt } from "@gharargah/ui/terminal-file-drop"

/**
 * OS file drops (Tauri native drag-drop) → shell-quoted absolute paths into the
 * terminal panel under the cursor. Drops outside a live terminal are ignored.
 */
export function useTerminalFileDrop(): void {
  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | null = null

    void (async () => {
      try {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow")
        if (cancelled) return
        unlisten = await getCurrentWebviewWindow().onDragDropEvent(event => {
          if (event.payload.type !== "drop") return
          const { paths, position } = event.payload
          if (!paths.length) return
          const scale = window.devicePixelRatio || 1
          const logical =
            typeof position.toLogical === "function"
              ? position.toLogical(scale)
              : { x: position.x / scale, y: position.y / scale }
          void handleTerminalFileDropAt(paths, logical.x, logical.y)
        })
        if (cancelled) {
          unlisten()
          unlisten = null
        }
      } catch {
        // Browser / non-Tauri — no native file-drop paths.
      }
    })()

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])
}
