import { EditorView, ViewPlugin } from "@codemirror/view"
import type { Extension } from "@codemirror/state"
import {
  RadScrollController,
  onReducedMotionChange,
  prefersReducedMotion,
} from "@jet/shared"

function wheelPixels(event: WheelEvent, lineHeight: number, pageHeight: number): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * lineHeight
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * pageHeight
  return event.deltaY
}

class SmoothEditorScroll {
  private reduced = prefersReducedMotion()
  private lastWritten = -1
  private readonly controller: RadScrollController
  private readonly unsubscribeReduced: () => void

  constructor(private readonly view: EditorView) {
    const scroller = view.scrollDOM
    scroller.dataset.jetSmoothScroll = ""
    this.controller = new RadScrollController({
      read: () => scroller.scrollTop,
      write: value => {
        this.lastWritten = value
        scroller.scrollTop = value
        scroller.dataset.jetScrollActive = "true"
      },
      max: () => scroller.scrollHeight - scroller.clientHeight,
      reducedMotion: () => this.reduced,
    })
    this.unsubscribeReduced = onReducedMotionChange(reduced => {
      this.reduced = reduced
      if (reduced) this.controller.snap()
    })
    scroller.addEventListener("wheel", this.onWheel, { capture: true, passive: false })
    scroller.addEventListener("scroll", this.onScroll, { passive: true })
    scroller.addEventListener("pointerdown", this.onPointerDown, { capture: true })
  }

  update(): void {
    if (this.controller.target > this.maxScrollTop()) {
      this.controller.setTarget(this.maxScrollTop())
    }
  }

  reveal(pos: number, yMargin: number): boolean {
    const caret = this.view.coordsAtPos(pos)
    if (!caret) return false
    const viewport = this.view.scrollDOM.getBoundingClientRect()
    const topEdge = viewport.top + yMargin
    const bottomEdge = viewport.bottom - yMargin
    let delta = 0
    if (caret.top < topEdge) delta = caret.top - topEdge
    else if (caret.bottom > bottomEdge) delta = caret.bottom - bottomEdge
    if (Math.abs(delta) < 0.5) return true
    this.controller.setTarget(this.view.scrollDOM.scrollTop + delta)
    return true
  }

  private maxScrollTop(): number {
    const scroller = this.view.scrollDOM
    return Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (event.deltaY === 0 || event.shiftKey || event.ctrlKey || event.metaKey) return
    const lineHeight = this.view.defaultLineHeight || 16
    const delta = wheelPixels(event, lineHeight, this.view.scrollDOM.clientHeight)
    if (delta === 0) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.controller.pushDelta(delta)
  }

  private readonly onScroll = (): void => {
    const actual = this.view.scrollDOM.scrollTop
    if (this.controller.active && Math.abs(actual - this.lastWritten) <= 1) return
    this.controller.sync(actual)
    this.view.scrollDOM.dataset.jetScrollActive = "false"
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.target !== this.view.scrollDOM) return
    this.controller.sync()
  }

  destroy(): void {
    const scroller = this.view.scrollDOM
    this.controller.destroy()
    this.unsubscribeReduced()
    scroller.removeEventListener("wheel", this.onWheel, true)
    scroller.removeEventListener("scroll", this.onScroll)
    scroller.removeEventListener("pointerdown", this.onPointerDown, true)
    delete scroller.dataset.jetSmoothScroll
    delete scroller.dataset.jetScrollActive
  }
}

const instances = new WeakMap<EditorView, SmoothEditorScroll>()

export function smoothEditorScroll(): Extension {
  return [
    ViewPlugin.define(view => {
      const instance = new SmoothEditorScroll(view)
      instances.set(view, instance)
      return {
        update() {
          instance.update()
        },
        destroy() {
          instances.delete(view)
          instance.destroy()
        },
      }
    }),
    EditorView.scrollHandler.of((view, range, options) => {
      const instance = instances.get(view)
      return instance?.reveal(range.head, Math.max(options.yMargin, view.defaultLineHeight * 2)) ?? false
    }),
  ]
}
