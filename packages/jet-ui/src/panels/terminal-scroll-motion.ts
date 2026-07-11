import type { Terminal } from "@xterm/xterm"
import {
  RadScrollController,
  onReducedMotionChange,
  prefersReducedMotion,
  wheelDeltaPixels,
} from "@jet/shared"

/** xterm adapter for Jet's shared RAD scroll curve. */
export class TerminalScrollMotion {
  private readonly viewport: HTMLElement | null
  private readonly controller: RadScrollController | null
  private reduced = prefersReducedMotion()
  private lastWritten = -1
  private readonly unsubscribeReduced: () => void

  constructor(
    private readonly term: Terminal,
    container: HTMLElement,
  ) {
    this.viewport = container.querySelector<HTMLElement>(".xterm-viewport")
    this.controller = this.viewport
      ? new RadScrollController({
          read: () => this.viewport!.scrollTop,
          write: value => {
            this.lastWritten = value
            this.viewport!.scrollTop = value
            this.viewport!.dataset.jetScrollActive = "true"
          },
          max: () => this.viewport!.scrollHeight - this.viewport!.clientHeight,
          reducedMotion: () => this.reduced,
        })
      : null
    this.unsubscribeReduced = onReducedMotionChange(reduced => {
      this.reduced = reduced
      if (reduced) this.controller?.snap()
    })
    if (!this.viewport || !this.controller) return
    this.viewport.dataset.jetSmoothScroll = ""
    this.viewport.addEventListener("wheel", this.onWheel, { capture: true, passive: false })
    this.viewport.addEventListener("scroll", this.onScroll, { passive: true })
    this.viewport.addEventListener("pointerdown", this.onPointerDown, { capture: true })
    term.attachCustomKeyEventHandler(this.onKey)
  }

  sync(): void {
    this.controller?.sync()
  }

  private rowHeight(): number {
    return this.viewport ? this.viewport.clientHeight / Math.max(1, this.term.rows) : 16
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.controller || event.deltaY === 0 || event.shiftKey || event.ctrlKey || event.metaKey) return
    const delta = wheelDeltaPixels(event, this.rowHeight(), this.viewport!.clientHeight)
    if (delta === 0) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.controller.pushDelta(delta)
  }

  private readonly onKey = (event: KeyboardEvent): boolean => {
    if (!this.controller || (event.key !== "PageUp" && event.key !== "PageDown")) return true
    event.preventDefault()
    const direction = event.key === "PageUp" ? -1 : 1
    this.controller.pushDelta(direction * this.rowHeight() * Math.max(1, this.term.rows - 1))
    return false
  }

  private readonly onScroll = (): void => {
    if (!this.viewport || !this.controller) return
    const actual = this.viewport.scrollTop
    if (this.controller.active && Math.abs(actual - this.lastWritten) <= 1) return
    this.controller.sync(actual)
    this.viewport.dataset.jetScrollActive = "false"
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.target === this.viewport) this.controller?.sync()
  }

  dispose(): void {
    this.controller?.destroy()
    this.unsubscribeReduced()
    if (!this.viewport) return
    this.viewport.removeEventListener("wheel", this.onWheel, true)
    this.viewport.removeEventListener("scroll", this.onScroll)
    this.viewport.removeEventListener("pointerdown", this.onPointerDown, true)
    delete this.viewport.dataset.jetSmoothScroll
    delete this.viewport.dataset.jetScrollActive
  }
}
