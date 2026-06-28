import { animate } from "motion"
import { EditorView, ViewPlugin, drawSelection, type ViewUpdate } from "@codemirror/view"
import type { Extension } from "@codemirror/state"

class MotionCursorPlugin {
  private layer: HTMLDivElement
  private cursor: HTMLDivElement
  private stopAnimation: (() => void) | null = null
  private reducedMotion: boolean

  constructor(private view: EditorView) {
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    this.layer = document.createElement("div")
    this.layer.className = "jet-cursor-layer"
    this.cursor = document.createElement("div")
    this.cursor.className = "jet-cursor"
    this.layer.appendChild(this.cursor)
    view.scrollDOM.appendChild(this.layer)
    this.measureAndAnimate({ instant: true })
  }

  update(update: ViewUpdate) {
    if (
      update.selectionSet ||
      update.docChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      update.focusChanged
    ) {
      const composing = (update.view.dom as HTMLElement).classList.contains("cm-composing")
      if (composing) {
        this.cursor.style.opacity = "0"
        return
      }
      this.measureAndAnimate({
        instant: this.reducedMotion || update.docChanged || update.viewportChanged,
      })
    }
  }

  private measureAndAnimate(opts: { instant: boolean }) {
    this.view.requestMeasure({
      read: view => {
        const head = view.state.selection.main.head
        const rect = view.coordsAtPos(head)
        if (!rect) return null
        const scrollRect = view.scrollDOM.getBoundingClientRect()
        return {
          x: rect.left - scrollRect.left + view.scrollDOM.scrollLeft,
          y: rect.top - scrollRect.top + view.scrollDOM.scrollTop,
          h: rect.bottom - rect.top,
        }
      },
      write: target => {
        if (!target) {
          this.cursor.style.opacity = "0"
          return
        }
        this.cursor.style.opacity = viewHasFocus(this.view) ? "1" : "0.4"
        this.stopAnimation?.()
        if (opts.instant) {
          this.cursor.style.transform = `translate3d(${target.x}px, ${target.y}px, 0)`
          this.cursor.style.height = `${target.h}px`
          return
        }
        const controls = animate(
          this.cursor,
          {
            transform: `translate3d(${target.x}px, ${target.y}px, 0)`,
            height: `${target.h}px`,
          },
          { type: "spring", stiffness: 950, damping: 32, mass: 0.7 },
        )
        this.stopAnimation = () => controls.stop()
      },
    })
  }

  destroy() {
    this.stopAnimation?.()
    this.layer.remove()
  }
}

function viewHasFocus(view: EditorView): boolean {
  return view.hasFocus
}

export function motionCursor(): Extension {
  return [
    drawSelection({ cursorBlinkRate: 0 }),
    EditorView.theme({
      ".jet-cursor-layer": {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
        zIndex: "30",
      },
      ".jet-cursor": {
        position: "absolute",
        width: "2px",
        borderRadius: "999px",
        background: "var(--jet-cursor-color, #c4923a)",
        willChange: "transform, height, opacity",
      },
    }),
    ViewPlugin.fromClass(MotionCursorPlugin),
  ]
}
