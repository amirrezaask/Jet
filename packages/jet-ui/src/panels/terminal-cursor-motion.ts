import type { IDisposable, Terminal } from "@xterm/xterm"
import {
  CaretEndpointAnim,
  CaretGhostBuffer,
  onReducedMotionChange,
  prefersReducedMotion,
  type CaretPoint,
} from "@jet/shared"

type CursorStyle = "block" | "bar" | "underline"
type CursorMotion = "trail" | "smooth" | "off"

function readSetting<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim() as T
  return allowed.includes(value) ? value : fallback
}

function cursorStyle(): CursorStyle {
  return readSetting("--jet-terminal-cursor-style", ["block", "bar", "underline"], "block")
}

function cursorMotion(): CursorMotion {
  return readSetting("--jet-terminal-cursor-motion", ["trail", "smooth", "off"], "trail")
}

export class TerminalCursorMotionLayer {
  private readonly layer = document.createElement("div")
  private readonly cursor = document.createElement("div")
  private readonly ghostEls = Array.from({ length: 5 }, () => document.createElement("div"))
  private readonly anim = new CaretEndpointAnim()
  private readonly ghosts = new CaretGhostBuffer()
  private readonly disposables: IDisposable[] = []
  private readonly resizeObserver: ResizeObserver
  private readonly nativeCursorLayer: HTMLElement | null
  private reduced = prefersReducedMotion()
  private unsubscribeReducedMotion: (() => void) | null = null
  private raf: number | null = null
  private lastFrame = 0
  private initialized = false
  private active = true
  private lastGhostX = 0
  private lastGhostY = 0

  constructor(
    private readonly term: Terminal,
    private readonly screen: HTMLElement,
  ) {
    this.layer.dataset.jetTerminalCursorLayer = ""
    Object.assign(this.layer.style, {
      position: "absolute",
      inset: "0",
      zIndex: "32",
      pointerEvents: "none",
      overflow: "hidden",
    })
    this.cursor.dataset.jetTerminalCursor = ""
    this.cursor.style.position = "absolute"
    this.cursor.style.willChange = "transform,width,height,opacity"
    this.layer.appendChild(this.cursor)
    for (const ghost of this.ghostEls) {
      ghost.dataset.jetTerminalCursorGhost = ""
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

  private retarget(forceSnap: boolean): void {
    const motion = cursorMotion()
    const enabled = motion !== "off"
    this.layer.style.display = enabled ? "block" : "none"
    if (this.nativeCursorLayer) this.nativeCursorLayer.style.opacity = enabled ? "0" : "1"
    if (!enabled || !this.active) {
      this.stop()
      return
    }
    const point = this.point()
    if (!point) return
    const dx = point.x - this.anim.targetX
    const dy = point.y - this.anim.targetY
    const largeJump = Math.abs(dx) > point.charWidth * 8 || Math.abs(dy) > point.h * 3
    if (!this.initialized || forceSnap || largeJump || this.reduced) {
      this.anim.snap(point)
      this.ghosts.clear()
      this.initialized = true
      this.lastGhostX = point.x
      this.lastGhostY = point.y
      this.render()
      this.stop()
      return
    }
    this.anim.followTarget(point)
    this.start()
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
    const dt = Math.min(0.05, (time - this.lastFrame) / 1000)
    this.lastFrame = time
    const previousX = this.anim.x
    const previousY = this.anim.y
    const moving = this.anim.step(dt)
    const motion = cursorMotion()

    if (motion === "trail" && !this.reduced) {
      const ghostDistance = Math.hypot(this.anim.x - this.lastGhostX, this.anim.y - this.lastGhostY)
      if (ghostDistance >= Math.max(1.5, this.anim.charWidth * 0.35)) {
        this.ghosts.push(previousX, previousY, this.anim.h, time)
        this.lastGhostX = this.anim.x
        this.lastGhostY = this.anim.y
      }
    } else {
      this.ghosts.clear()
    }

    const ghostsAlive = this.ghosts.tick(time).length > 0
    this.render()
    if ((moving || ghostsAlive) && this.active) this.start()
  }

  private styleCursor(el: HTMLElement, x: number, y: number, h: number, opacity: number): void {
    const style = cursorStyle()
    const charWidth = Math.max(1, this.anim.charWidth)
    const width = style === "bar" ? 2 : charWidth
    const height = style === "underline" ? 2 : Math.max(1, h)
    const offsetY = style === "underline" ? Math.max(0, h - height) : 0
    el.style.transform = `translate3d(${x}px, ${y + offsetY}px, 0)`
    el.style.width = `${width}px`
    el.style.height = `${height}px`
    el.style.opacity = String(opacity)
    el.style.borderRadius = style === "block" ? "2px" : "1px"
    el.style.background = "var(--jet-accent)"
    el.style.boxShadow = style === "block" ? "inset 0 0 0 1px color-mix(in srgb, var(--jet-bg) 22%, transparent)" : "none"
  }

  private render(): void {
    this.styleCursor(this.cursor, this.anim.x, this.anim.y, this.anim.h, 0.78)
    const ghosts = this.ghosts.tick()
    for (let i = 0; i < this.ghostEls.length; i++) {
      const ghost = ghosts[i]
      const el = this.ghostEls[i]!
      if (!ghost) {
        el.style.opacity = "0"
        continue
      }
      this.styleCursor(el, ghost.x, ghost.y, ghost.h, ghost.opacity)
    }
  }

  dispose(): void {
    this.stop()
    this.resizeObserver.disconnect()
    this.unsubscribeReducedMotion?.()
    for (const disposable of this.disposables) disposable.dispose()
    if (this.nativeCursorLayer) this.nativeCursorLayer.style.opacity = "1"
    this.layer.remove()
  }
}
