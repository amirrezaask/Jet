import type { IDisposable, Terminal } from "@xterm/xterm"
import {
  CaretEndpointAnim,
  CaretGhostBuffer,
  onReducedMotionChange,
  prefersReducedMotion,
  type CaretPoint,
} from "@gharargah/shared"

type CursorStyle = "block" | "bar" | "underline"
type CursorMotion = "trail" | "smooth" | "off"

function readSetting<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim() as T
  return allowed.includes(value) ? value : fallback
}

function readCursorAppearance(): { style: CursorStyle; motion: CursorMotion } {
  return {
    style: readSetting("--gharargah-cursor-style", ["block", "bar", "underline"], "bar"),
    motion: readSetting("--gharargah-cursor-motion", ["trail", "smooth", "off"], "trail"),
  }
}

export class TerminalCursorMotionLayer {
  private readonly layer = document.createElement("div")
  private readonly cursor = document.createElement("div")
  private readonly ghostEls = Array.from({ length: 5 }, () => document.createElement("div"))
  private readonly anim = new CaretEndpointAnim()
  private readonly ghosts = new CaretGhostBuffer()
  private readonly disposables: IDisposable[] = []
  private readonly resizeObserver: ResizeObserver
  private readonly rootObserver: MutationObserver
  private readonly nativeCursorLayer: HTMLElement | null
  private reduced = prefersReducedMotion()
  private unsubscribeReducedMotion: (() => void) | null = null
  private raf: number | null = null
  private lastFrame = 0
  private initialized = false
  private active = true
  private lastGhostX = 0
  private lastGhostY = 0
  private appearance = readCursorAppearance()

  constructor(
    private readonly term: Terminal,
    private readonly screen: HTMLElement,
  ) {
    this.layer.dataset.gharargahTerminalCursorLayer = ""
    Object.assign(this.layer.style, {
      position: "absolute",
      inset: "0",
      zIndex: "32",
      pointerEvents: "none",
      overflow: "hidden",
    })
    this.cursor.dataset.gharargahTerminalCursor = ""
    this.cursor.style.position = "absolute"
    this.cursor.style.willChange = "transform,width,height,opacity"
    this.layer.appendChild(this.cursor)
    for (const ghost of this.ghostEls) {
      ghost.dataset.gharargahTerminalCursorGhost = ""
      ghost.style.position = "absolute"
      ghost.style.willChange = "transform,width,height,opacity"
      this.layer.appendChild(ghost)
    }
    this.screen.appendChild(this.layer)
    this.nativeCursorLayer = this.screen.querySelector<HTMLElement>(".xterm-cursor-layer")

    this.disposables.push(
      term.onCursorMove(() => this.retarget(false)),
      term.onScroll(() => this.retarget(true)),
      term.onRender(() => {
        if (!this.initialized) this.retarget(true)
      }),
    )
    this.resizeObserver = new ResizeObserver(() => this.retarget(true))
    this.resizeObserver.observe(screen)
    this.rootObserver = new MutationObserver(() => {
      this.appearance = readCursorAppearance()
      this.retarget(true)
    })
    this.rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-gharargah-reduced-motion"],
    })
    this.unsubscribeReducedMotion = onReducedMotionChange(reduced => {
      this.reduced = reduced
      this.retarget(true)
    })
    this.retarget(true)
  }

  setActive(active: boolean): void {
    if (this.active === active) return
    this.active = active
    this.layer.style.visibility = active ? "visible" : "hidden"
    if (active) this.retarget(true)
    else this.stop()
  }

  refresh(snap = true): void {
    this.retarget(snap)
  }

  private point(): CaretPoint | null {
    if (this.term.cols <= 0 || this.term.rows <= 0) return null
    const width = this.screen.clientWidth
    const height = this.screen.clientHeight
    if (width <= 0 || height <= 0) return null
    const charWidth = width / this.term.cols
    const cellHeight = height / this.term.rows
    const buffer = this.term.buffer.active
    return {
      x: Math.max(0, Math.min(this.term.cols - 1, buffer.cursorX)) * charWidth,
      y: Math.max(0, Math.min(this.term.rows - 1, buffer.cursorY)) * cellHeight,
      h: cellHeight,
      charWidth,
    }
  }

  private isTypingHop(point: CaretPoint): boolean {
    const dx = point.x - this.anim.targetX
    const dy = point.y - this.anim.targetY
    return (
      Math.abs(dx) <= point.charWidth * 1.5 &&
      Math.abs(dy) < point.h * 0.15 &&
      Math.abs(dx) > 0.01
    )
  }

  private retarget(forceSnap: boolean): void {
    const motion = this.appearance.motion
    const enabled = motion !== "off"
    this.layer.style.display = enabled ? "block" : "none"
    if (this.nativeCursorLayer) this.nativeCursorLayer.style.opacity = enabled ? "0" : "1"
    if (!enabled || !this.active) {
      this.stop()
      return
    }
    const point = this.point()
    if (!point) return
    const typingHop = !forceSnap && this.isTypingHop(point)
    if (!this.initialized || forceSnap || this.reduced || !typingHop) {
      if (typingHop && motion === "trail" && !this.reduced) {
        this.ghosts.push(this.anim.x, this.anim.y, this.anim.h, performance.now())
      } else if (!typingHop) {
        this.ghosts.clear()
      }
      this.anim.snap(point)
      this.initialized = true
      this.lastGhostX = point.x
      this.lastGhostY = point.y
      if (this.render(performance.now())) this.start()
      else this.stop()
      return
    }
    if (motion === "trail" && !this.reduced) {
      this.ghosts.push(this.anim.x, this.anim.y, this.anim.h, performance.now())
    }
    this.anim.snap(point)
    this.lastGhostX = point.x
    this.lastGhostY = point.y
    if (this.render(performance.now())) this.start()
    else this.stop()
  }

  private start(): void {
    if (this.raf != null || !this.active) return
    this.lastFrame = performance.now()
    this.raf = requestAnimationFrame(time => this.tick(time))
  }

  private stop(): void {
    if (this.raf != null) cancelAnimationFrame(this.raf)
    this.raf = null
  }

  private tick(time: number): void {
    this.raf = null
    this.lastFrame = time
    if (this.render(time) && this.active) this.start()
  }

  private styleCursor(el: HTMLElement, x: number, y: number, h: number, opacity: number): void {
    const style = this.appearance.style
    const charWidth = Math.max(1, this.anim.charWidth)
    const width = style === "bar" ? 2 : charWidth
    const height = style === "underline" ? 2 : Math.max(1, h)
    const offsetY = style === "underline" ? Math.max(0, h - height) : 0
    el.style.transform = `translate3d(${x}px, ${y + offsetY}px, 0)`
    el.style.width = `${width}px`
    el.style.height = `${height}px`
    el.style.opacity = String(opacity)
    el.style.borderRadius = style === "block" ? "2px" : "1px"
    el.style.background = "var(--gharargah-accent)"
    el.style.boxShadow = style === "block" ? "inset 0 0 0 1px color-mix(in srgb, var(--gharargah-bg) 22%, transparent)" : "none"
  }

  private render(time = performance.now()): boolean {
    this.styleCursor(this.cursor, this.anim.x, this.anim.y, this.anim.h, 0.78)
    const ghosts = this.ghosts.tick(time)
    for (let i = 0; i < this.ghostEls.length; i++) {
      const ghost = ghosts[i]
      const el = this.ghostEls[i]!
      if (!ghost) {
        el.style.opacity = "0"
        continue
      }
      this.styleCursor(el, ghost.x, ghost.y, ghost.h, ghost.opacity)
    }
    return ghosts.length > 0
  }

  dispose(): void {
    this.stop()
    this.resizeObserver.disconnect()
    this.rootObserver.disconnect()
    this.unsubscribeReducedMotion?.()
    for (const disposable of this.disposables) disposable.dispose()
    if (this.nativeCursorLayer) this.nativeCursorLayer.style.opacity = "1"
    this.layer.remove()
  }
}
