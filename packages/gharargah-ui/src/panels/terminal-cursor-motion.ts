import type { IDisposable, Terminal } from "@xterm/xterm"
import {
  CaretGhostCompositor,
  GHOST_MAX,
  onReducedMotionChange,
  prefersReducedMotion,
  type CaretGhostVisual,
  type CaretPoint,
} from "@gharargah/shared"

type CursorStyle = "block" | "bar" | "underline"
type CursorMotion = "trail" | "smooth" | "off"

type TerminalCellMetrics = {
  width: number
  height: number
}

type TerminalGhostPolicy = {
  active: boolean
  documentVisible: boolean
  focused: boolean
  motion: CursorMotion
  reduced: boolean
  previous: CaretPoint | null
  next: CaretPoint | null
}

function readSetting<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim() as T
  return allowed.includes(value) ? value : fallback
}

function readCursorAppearance(): { style: CursorStyle; motion: CursorMotion } {
  return {
    // Prefer terminal-specific tokens; fall back to shared editor/UI cursor tokens.
    style: readSetting(
      "--gharargah-terminal-cursor-style",
      ["block", "bar", "underline"],
      readSetting("--gharargah-cursor-style", ["block", "bar", "underline"], "bar"),
    ),
    motion: readSetting(
      "--gharargah-terminal-cursor-motion",
      ["trail", "smooth", "off"],
      readSetting("--gharargah-cursor-motion", ["trail", "smooth", "off"], "trail"),
    ),
  }
}

function moved(previous: CaretPoint | null, next: CaretPoint | null): boolean {
  if (!previous || !next) return false
  return Math.abs(previous.x - next.x) > 0.25 || Math.abs(previous.y - next.y) > 0.25
}

/**
 * The trail is decorative and must never become a second live caret.
 * xterm remains authoritative for focus, blink, IME, and renderer semantics.
 */
export function shouldEmitTerminalGhost(policy: TerminalGhostPolicy): boolean {
  return (
    policy.active &&
    policy.documentVisible &&
    policy.focused &&
    !policy.reduced &&
    policy.motion === "trail" &&
    moved(policy.previous, policy.next)
  )
}

/** Read xterm's measured cell size (same source FitAddon / cellMetricsValid use). */
export function readTerminalCellMetrics(term: Terminal): TerminalCellMetrics | null {
  const dims = (
    term as Terminal & {
      _core?: { _renderService?: { dimensions?: { css?: { cell?: { width?: number; height?: number } } } } }
    }
  )._core?._renderService?.dimensions?.css?.cell
  const width = dims?.width ?? 0
  const height = dims?.height ?? 0
  if (width < 4 || height < 4) return null
  return { width, height }
}

/** True when the app hid the hardware caret (CSI ? 25 l) — skip ghost trail. */
export function isXtermCursorHidden(term: Terminal): boolean {
  const core = (
    term as Terminal & {
      _core?: { _coreService?: { isCursorHidden?: boolean }; coreService?: { isCursorHidden?: boolean } }
    }
  )._core
  return (
    core?._coreService?.isCursorHidden === true ||
    core?.coreService?.isCursorHidden === true
  )
}

/** Pure caret placement from buffer cursor + measured cell metrics. */
export function terminalCaretPoint(input: {
  cols: number
  rows: number
  cursorX: number
  cursorY: number
  cellWidth: number
  cellHeight: number
}): CaretPoint | null {
  const { cols, rows, cursorX, cursorY, cellWidth, cellHeight } = input
  if (cols <= 0 || rows <= 0 || cellWidth < 4 || cellHeight < 4) return null
  return {
    x: Math.max(0, Math.min(cols - 1, cursorX)) * cellWidth,
    y: Math.max(0, Math.min(rows - 1, cursorY)) * cellHeight,
    h: cellHeight,
    charWidth: cellWidth,
  }
}

/**
 * Ghost-only terminal trail. It never changes or obscures xterm's native caret,
 * so DOM, canvas, and WebGL renderers retain their own cursor semantics.
 */
export class TerminalCursorMotionLayer {
  private readonly layer = document.createElement("div")
  private readonly ghostElements = Array.from({ length: GHOST_MAX }, () =>
    document.createElement("div"),
  )
  private readonly trail = new CaretGhostCompositor(this.ghostElements)
  private readonly disposables: IDisposable[] = []
  private readonly resizeObserver: ResizeObserver
  private readonly rootObserver: MutationObserver
  private reduced = prefersReducedMotion()
  private unsubscribeReducedMotion: (() => void) | null = null
  private previous: CaretPoint | null = null
  private active = true
  private appearance = readCursorAppearance()

  constructor(
    private readonly term: Terminal,
    private readonly screen: HTMLElement,
  ) {
    this.layer.dataset.gharargahTerminalCursorTrail = ""
    this.layer.dataset.gharargahTerminalLiveCaret = "xterm"
    Object.assign(this.layer.style, {
      position: "absolute",
      inset: "0",
      zIndex: "32",
      pointerEvents: "none",
      overflow: "hidden",
    })
    for (const ghost of this.ghostElements) {
      ghost.dataset.gharargahTerminalCursorGhost = ""
      Object.assign(ghost.style, {
        position: "absolute",
        top: "0",
        left: "0",
        pointerEvents: "none",
        background: "var(--gharargah-cursor-color, var(--gharargah-accent))",
      })
      this.layer.appendChild(ghost)
    }
    this.screen.appendChild(this.layer)
    this.applyNativeAppearance()

    this.disposables.push(
      term.onCursorMove(() => this.sync(false)),
      term.onScroll(() => this.sync(true)),
      term.onResize(() => this.sync(true)),
    )
    this.screen.addEventListener("focusin", this.handleFocusChange)
    this.screen.addEventListener("focusout", this.handleFocusChange)
    document.addEventListener("visibilitychange", this.handleVisibilityChange)

    this.resizeObserver = new ResizeObserver(() => this.sync(true))
    this.resizeObserver.observe(screen)
    this.rootObserver = new MutationObserver(() => {
      this.appearance = readCursorAppearance()
      this.applyNativeAppearance()
      this.sync(true)
    })
    this.rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-gharargah-reduced-motion"],
    })
    this.unsubscribeReducedMotion = onReducedMotionChange(reduced => {
      this.reduced = reduced
      this.sync(true)
    })
    this.sync(true)
  }

  setActive(active: boolean): void {
    if (this.active === active) return
    this.active = active
    this.sync(true)
  }

  refresh(reset = true): void {
    this.sync(reset)
  }

  private readonly handleFocusChange = (): void => {
    this.sync(true)
  }

  private readonly handleVisibilityChange = (): void => {
    this.sync(true)
  }

  private hasInputFocus(): boolean {
    const input = this.screen.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")
    return input != null && document.activeElement === input
  }

  private applyNativeAppearance(): void {
    if (this.term.options.cursorStyle !== this.appearance.style) {
      this.term.options.cursorStyle = this.appearance.style
    }
  }

  private point(): CaretPoint | null {
    if (isXtermCursorHidden(this.term)) return null
    const cell = readTerminalCellMetrics(this.term)
    if (!cell) return null
    const buffer = this.term.buffer.active
    return terminalCaretPoint({
      cols: this.term.cols,
      rows: this.term.rows,
      cursorX: buffer.cursorX,
      cursorY: buffer.cursorY,
      cellWidth: cell.width,
      cellHeight: cell.height,
    })
  }

  private visual(point: CaretPoint): CaretGhostVisual {
    const style = this.appearance.style
    const width = style === "bar" ? 2 : point.charWidth
    const height = style === "underline" ? 2 : point.h
    return {
      x: point.x,
      y: point.y + (style === "underline" ? Math.max(0, point.h - height) : 0),
      width,
      height,
      opacity: 0.26,
      borderRadius: style === "block" ? "2px" : "1px",
    }
  }

  private sync(reset: boolean): void {
    const next =
      this.active && document.visibilityState === "visible" && this.hasInputFocus()
        ? this.point()
        : null
    if (
      !reset &&
      shouldEmitTerminalGhost({
        active: this.active,
        documentVisible: document.visibilityState === "visible",
        focused: this.hasInputFocus(),
        motion: this.appearance.motion,
        reduced: this.reduced,
        previous: this.previous,
        next,
      })
    ) {
      this.trail.push(this.visual(this.previous!))
    } else if (reset || this.reduced || this.appearance.motion !== "trail") {
      this.trail.clear()
    }
    this.previous = next
  }

  dispose(): void {
    this.screen.removeEventListener("focusin", this.handleFocusChange)
    this.screen.removeEventListener("focusout", this.handleFocusChange)
    document.removeEventListener("visibilitychange", this.handleVisibilityChange)
    this.resizeObserver.disconnect()
    this.rootObserver.disconnect()
    this.unsubscribeReducedMotion?.()
    for (const disposable of this.disposables) disposable.dispose()
    this.trail.dispose()
    this.layer.remove()
  }
}
