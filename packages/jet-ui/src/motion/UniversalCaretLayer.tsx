import { useEffect } from "react"
import {
  CaretEndpointAnim,
  CaretGhostBuffer,
  onReducedMotionChange,
  prefersReducedMotion,
  type CaretPoint,
  type CaretGhost,
} from "@jet/shared"
import { jetMotion } from "./tokens.js"

type CaretTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement
type CursorStyle = "bar" | "block" | "underline"
type CursorMotion = "trail" | "smooth" | "off"

const TEXT_INPUT_TYPES = new Set(["", "text", "search", "email", "url", "tel", "password", "number"])

function isCaretTarget(value: EventTarget | null): value is CaretTarget {
  if (value instanceof HTMLElement && value.closest(".cm-editor, .xterm")) return false
  if (value instanceof HTMLTextAreaElement) return !value.disabled && !value.readOnly
  if (value instanceof HTMLInputElement) {
    return !value.disabled && !value.readOnly && TEXT_INPUT_TYPES.has(value.type.toLowerCase())
  }
  return value instanceof HTMLElement && (
    value.isContentEditable ||
    ["true", "plaintext-only"].includes(value.getAttribute("contenteditable") ?? "")
  )
}

function setting<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim() as T
  return allowed.includes(value) ? value : fallback
}

function readCursorAppearance(): { style: CursorStyle; motion: CursorMotion } {
  return {
    style: setting("--jet-cursor-style", ["bar", "block", "underline"], "bar"),
    motion: setting("--jet-cursor-motion", ["trail", "smooth", "off"], "trail"),
  }
}

function copyTextStyle(mirror: HTMLElement, style: CSSStyleDeclaration): void {
  mirror.style.font = style.font
  mirror.style.fontKerning = style.fontKerning
  mirror.style.fontVariantLigatures = style.fontVariantLigatures
  mirror.style.letterSpacing = style.letterSpacing
  mirror.style.lineHeight = style.lineHeight
  mirror.style.textAlign = style.textAlign
  mirror.style.textIndent = style.textIndent
  mirror.style.textTransform = style.textTransform
  mirror.style.tabSize = style.tabSize
}

class TextCaretMeasurer {
  readonly mirror = document.createElement("div")
  readonly marker = document.createElement("span")
  readonly context = document.createElement("canvas").getContext("2d")

  constructor() {
    this.mirror.dataset.jetCaretMeasureMirror = ""
    this.marker.textContent = "\u200b"
    document.body.appendChild(this.mirror)
  }

  dispose(): void {
    this.mirror.remove()
  }
}

function measureTextControl(
  target: HTMLInputElement | HTMLTextAreaElement,
  measurer: TextCaretMeasurer,
): CaretPoint | null {
  const numberFallback = target instanceof HTMLInputElement && target.type === "number"
    ? target.value.length
    : null
  const start = target.selectionStart ?? numberFallback
  const end = target.selectionEnd ?? numberFallback
  if (start == null || end == null || start !== end) return null
  const style = getComputedStyle(target)
  const rect = target.getBoundingClientRect()
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.top) ||
    style.visibility === "hidden" ||
    style.display === "none"
  ) return null
  const fontSize = parseFloat(style.fontSize) || 13
  const lineHeightValue = parseFloat(style.lineHeight)
  const lineHeight = Number.isFinite(lineHeightValue) ? lineHeightValue : fontSize * 1.35
  const paddingLeft = parseFloat(style.paddingLeft) || 0
  const paddingTop = parseFloat(style.paddingTop) || 0
  const paddingRight = parseFloat(style.paddingRight) || 0
  const paddingBottom = parseFloat(style.paddingBottom) || 0
  const borderTop = parseFloat(style.borderTopWidth) || 0
  const borderBottom = parseFloat(style.borderBottomWidth) || 0

  const mirror = measurer.mirror
  mirror.replaceChildren()
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    pointerEvents: "none",
    left: `${rect.left + paddingLeft}px`,
    top: `${rect.top + paddingTop}px`,
    margin: "0",
    padding: "0",
    border: "0",
    whiteSpace: target instanceof HTMLTextAreaElement ? "pre-wrap" : "pre",
    overflowWrap: target instanceof HTMLTextAreaElement ? "break-word" : "normal",
    width: `${Math.max(1, rect.width - paddingLeft - paddingRight)}px`,
  })
  copyTextStyle(mirror, style)
  mirror.textContent = target instanceof HTMLInputElement && target.type === "password"
    ? "•".repeat(start)
    : target.value.slice(0, start)
  const marker = measurer.marker
  mirror.appendChild(marker)
  const markerRect = marker.getBoundingClientRect()

  const nextChar = target.value.slice(start, start + 1) || target.value.slice(Math.max(0, start - 1), start)
  let charWidth = fontSize * 0.55
  if (nextChar) {
    const context = measurer.context
    if (context) {
      context.font = style.font
      charWidth = Math.max(1, context.measureText(nextChar).width)
    }
  }

  // Single-line inputs vertically center glyphs in the content box; mirror text sits at paddingTop.
  let y = markerRect.top - target.scrollTop
  let h = Math.max(1, lineHeight)
  if (target instanceof HTMLInputElement) {
    const contentHeight = Math.max(
      0,
      rect.height - paddingTop - paddingBottom - borderTop - borderBottom,
    )
    h = Math.max(1, Math.min(lineHeight, contentHeight || lineHeight))
    y = rect.top + borderTop + paddingTop + Math.max(0, (contentHeight - h) / 2) - target.scrollTop
  }

  return {
    x: markerRect.left - target.scrollLeft,
    y,
    h,
    charWidth,
  }
}

function measureContentEditable(target: HTMLElement): CaretPoint | null {
  const selection = window.getSelection()
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0).cloneRange()
  if (!target.contains(range.startContainer)) return null
  range.collapse(true)
  let rect = range.getBoundingClientRect()
  const style = getComputedStyle(target)
  const fontSize = parseFloat(style.fontSize) || 13
  const lineHeightValue = parseFloat(style.lineHeight)
  const h = rect.height || (Number.isFinite(lineHeightValue) ? lineHeightValue : fontSize * 1.35)
  if (rect.left || rect.top || rect.height) {
    return { x: rect.left, y: rect.top, h, charWidth: fontSize * 0.55 }
  }
  if (range.startContainer instanceof Text) {
    const text = range.startContainer
    const offset = range.startOffset
    const probe = document.createRange()
    if (offset > 0) {
      probe.setStart(text, offset - 1)
      probe.setEnd(text, offset)
      rect = probe.getBoundingClientRect()
      if (rect.height) return { x: rect.right, y: rect.top, h: rect.height, charWidth: fontSize * 0.55 }
    } else if (text.length > 0) {
      probe.setStart(text, 0)
      probe.setEnd(text, 1)
      rect = probe.getBoundingClientRect()
      if (rect.height) return { x: rect.left, y: rect.top, h: rect.height, charWidth: fontSize * 0.55 }
    }
  }
  const targetRect = target.getBoundingClientRect()
  return {
    x: targetRect.left + (parseFloat(style.paddingLeft) || 0),
    y: targetRect.top + (parseFloat(style.paddingTop) || 0),
    h,
    charWidth: fontSize * 0.55,
  }
}

function measureCaret(target: CaretTarget, measurer: TextCaretMeasurer): CaretPoint | null {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return measureTextControl(target, measurer)
  }
  return measureContentEditable(target)
}

function createVisual(kind: "cursor" | "ghost"): HTMLDivElement {
  const element = document.createElement("div")
  element.dataset[kind === "cursor" ? "jetUniversalCursor" : "jetUniversalCursorGhost"] = ""
  Object.assign(element.style, {
    position: "fixed",
    top: "0",
    left: "0",
    pointerEvents: "none",
    willChange: "transform, width, height, opacity",
    background: "var(--jet-cursor-color, var(--jet-accent))",
  })
  return element
}

class UniversalCaretController {
  private readonly layer = document.createElement("div")
  private readonly cursor = createVisual("cursor")
  private readonly ghostEls = Array.from({ length: 5 }, () => createVisual("ghost"))
  private readonly anim = new CaretEndpointAnim()
  private readonly ghosts = new CaretGhostBuffer()
  private readonly events = new AbortController()
  private readonly measurer = new TextCaretMeasurer()
  private readonly rootObserver: MutationObserver
  private readonly targetRemovalObserver: MutationObserver
  private targetObserver: ResizeObserver | null = null
  private target: CaretTarget | null = null
  private originalCaretColor = ""
  private reduced = prefersReducedMotion()
  private composing = false
  private selecting = false
  private initialized = false
  private lastGhostX = 0
  private lastGhostY = 0
  private raf: number | null = null
  private eventRaf: number | null = null
  private eventTimer: number | null = null
  private settleRaf: number | null = null
  private settleTimer: number | null = null
  private tickTimer: number | null = null
  private lastFrame = 0
  private appearance = readCursorAppearance()
  private readonly unsubscribeReduced: () => void

  constructor() {
    this.layer.dataset.jetUniversalCaretLayer = ""
    Object.assign(this.layer.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483646",
      pointerEvents: "none",
      overflow: "hidden",
    })
    this.layer.append(this.cursor, ...this.ghostEls)
    document.body.appendChild(this.layer)
    this.hide()

    const signal = this.events.signal
    document.addEventListener("focusin", this.onFocusIn, { signal, capture: true })
    document.addEventListener("focusout", this.onFocusOut, { signal, capture: true })
    document.addEventListener("input", this.onInput, { signal, capture: true })
    document.addEventListener("keydown", this.onKeyDown, { signal, capture: true })
    document.addEventListener("click", this.onClick, { signal, capture: true })
    document.addEventListener("pointerdown", this.onPointerDown, { signal, capture: true })
    document.addEventListener("pointerup", this.onPointerUp, { signal, capture: true })
    document.addEventListener("pointercancel", this.onPointerUp, { signal, capture: true })
    document.addEventListener("selectionchange", this.onSelectionChange, { signal })
    document.addEventListener("compositionstart", this.onCompositionStart, { signal, capture: true })
    document.addEventListener("compositionend", this.onCompositionEnd, { signal, capture: true })
    window.addEventListener("scroll", this.onViewportChange, { signal, capture: true, passive: true })
    window.addEventListener("resize", this.onViewportChange, { signal, passive: true })

    this.unsubscribeReduced = onReducedMotionChange(reduced => {
      this.reduced = reduced
      this.schedule(true)
    })
    this.rootObserver = new MutationObserver(() => {
      this.appearance = readCursorAppearance()
      this.schedule(true)
    })
    this.rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] })
    this.targetRemovalObserver = new MutationObserver(() => {
      if (this.target && !this.target.isConnected) this.setTarget(null)
    })
  }

  private clearSettle(): void {
    if (this.settleRaf != null) {
      cancelAnimationFrame(this.settleRaf)
      this.settleRaf = null
    }
    if (this.settleTimer != null) {
      window.clearTimeout(this.settleTimer)
      this.settleTimer = null
    }
  }

  /** CSS transforms do not trigger ResizeObserver. Sample the entrance at its
   * start, midpoint, and end without forcing layout on every animation frame. */
  private settleAfterFocus(): void {
    this.clearSettle()
    const settleForMs = jetMotion.duration.overlay * 1000
    this.settleRaf = requestAnimationFrame(() => {
      this.settleRaf = null
      this.schedule(true)
    })
    this.settleTimer = window.setTimeout(() => {
      this.schedule(true)
      this.settleTimer = window.setTimeout(() => {
        this.settleTimer = null
        this.schedule(true)
      }, settleForMs / 2)
    }, settleForMs / 2)
  }

  private observeTarget(target: CaretTarget | null): void {
    this.targetObserver?.disconnect()
    this.targetObserver = null
    this.targetRemovalObserver.disconnect()
    if (!target) return
    if (typeof ResizeObserver !== "undefined") {
      this.targetObserver = new ResizeObserver(() => this.schedule(true))
      this.targetObserver.observe(target)
    }
    this.targetRemovalObserver.observe(document.body, { childList: true, subtree: true })
  }

  private setTarget(target: CaretTarget | null): void {
    if (this.target === target) return
    this.restoreNativeCaret()
    this.clearSettle()
    this.target = target
    this.initialized = false
    this.ghosts.clear()
    this.observeTarget(target)
    if (!target) {
      this.hide()
      return
    }
    this.originalCaretColor = target.style.caretColor
    target.style.caretColor = "transparent"
    this.schedule(true)
    this.settleAfterFocus()
  }

  private eventIsWithinTarget(event: Event): boolean {
    if (!this.target || !(event.target instanceof Node)) return false
    return event.target === this.target || this.target.contains(event.target)
  }

  private restoreNativeCaret(): void {
    if (this.target) this.target.style.caretColor = this.originalCaretColor
    this.originalCaretColor = ""
  }

  private useNativeCaret(): void {
    if (this.target) this.target.style.caretColor = this.originalCaretColor
    this.hide()
    this.stop()
  }

  private useCustomCaret(): void {
    if (this.target) this.target.style.caretColor = "transparent"
  }

  private schedule(instant: boolean): void {
    const target = this.target
    if (target && (!target.isConnected || document.activeElement !== target)) {
      this.setTarget(null)
      return
    }
    if (!target || this.composing || this.selecting) {
      this.hide()
      return
    }
    const point = measureCaret(target, this.measurer)
    if (!point) {
      this.hide()
      return
    }
    this.useCustomCaret()
    const motion = this.appearance.motion
    const snap = instant || this.reduced || motion === "off" || !this.initialized
    const dx = point.x - this.anim.targetX
    const dy = point.y - this.anim.targetY
    const largeJump = Math.abs(dx) > point.charWidth * 12 || Math.abs(dy) > point.h * 5
    if (snap || largeJump) {
      this.anim.snap(point)
      this.ghosts.clear()
      this.lastGhostX = point.x
      this.lastGhostY = point.y
      this.initialized = true
      this.render(this.ghosts.tick(performance.now()))
      this.stop()
      return
    }
    this.anim.followTarget(point)
    this.start()
  }

  private scheduleDeferred(instant: boolean): void {
    if (this.eventRaf != null) cancelAnimationFrame(this.eventRaf)
    if (this.eventTimer != null) window.clearTimeout(this.eventTimer)
    const run = () => {
      if (this.eventRaf != null) cancelAnimationFrame(this.eventRaf)
      if (this.eventTimer != null) window.clearTimeout(this.eventTimer)
      this.eventRaf = null
      this.eventTimer = null
      this.schedule(instant)
    }
    this.eventRaf = requestAnimationFrame(run)
    this.eventTimer = window.setTimeout(run, 32)
  }

  private start(): void {
    if (this.raf != null || this.tickTimer != null) return
    this.lastFrame = performance.now()
    this.raf = requestAnimationFrame(time => this.tick(time))
    this.tickTimer = window.setTimeout(() => this.tick(performance.now()), 32)
  }

  private stop(): void {
    if (this.raf != null) cancelAnimationFrame(this.raf)
    if (this.tickTimer != null) window.clearTimeout(this.tickTimer)
    this.raf = null
    this.tickTimer = null
  }

  private tick(time: number): void {
    if (this.raf != null) cancelAnimationFrame(this.raf)
    if (this.tickTimer != null) window.clearTimeout(this.tickTimer)
    this.raf = null
    this.tickTimer = null
    const dt = Math.min(0.05, Math.max(0, (time - this.lastFrame) / 1000))
    this.lastFrame = time
    const previousX = this.anim.x
    const previousY = this.anim.y
    const moving = this.anim.step(dt)
    if (this.appearance.motion === "trail" && !this.reduced) {
      const distance = Math.hypot(this.anim.x - this.lastGhostX, this.anim.y - this.lastGhostY)
      if (distance >= Math.max(1.5, this.anim.charWidth * 0.35)) {
        this.ghosts.push(previousX, previousY, this.anim.h, time)
        this.lastGhostX = this.anim.x
        this.lastGhostY = this.anim.y
      }
    } else {
      this.ghosts.clear()
    }
    const ghosts = this.ghosts.tick(time)
    const ghostsAlive = ghosts.length > 0
    this.render(ghosts)
    if (moving || ghostsAlive) this.start()
  }

  private styleVisual(element: HTMLElement, x: number, y: number, h: number, opacity: number): void {
    const style = this.appearance.style
    const width = style === "bar" ? 2 : Math.max(1, this.anim.charWidth)
    const height = style === "underline" ? 2 : Math.max(1, h)
    const offsetY = style === "underline" ? Math.max(0, h - height) : 0
    element.style.transform = `translate3d(${x}px, ${y + offsetY}px, 0)`
    element.style.width = `${width}px`
    element.style.height = `${height}px`
    element.style.opacity = String(opacity)
    element.style.borderRadius = style === "block" ? "2px" : "1px"
  }

  private render(ghosts: CaretGhost[]): void {
    this.styleVisual(this.cursor, this.anim.x, this.anim.y, this.anim.h, 0.92)
    this.ghostEls.forEach((element, index) => {
      const ghost = ghosts[index]
      if (!ghost) {
        element.style.opacity = "0"
        return
      }
      this.styleVisual(element, ghost.x, ghost.y, ghost.h, ghost.opacity * 0.92)
    })
  }

  private hide(): void {
    this.cursor.style.opacity = "0"
    this.ghostEls.forEach(element => (element.style.opacity = "0"))
  }

  private readonly onFocusIn = (event: FocusEvent) => {
    this.setTarget(isCaretTarget(event.target) ? event.target : null)
  }
  private readonly onFocusOut = (event: FocusEvent) => {
    if (event.target === this.target) this.setTarget(null)
  }
  private readonly onInput = (event: Event) => {
    if (!this.eventIsWithinTarget(event)) return
    this.clearSettle()
    this.scheduleDeferred(false)
  }
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!this.eventIsWithinTarget(event)) return
    this.clearSettle()
    this.scheduleDeferred(false)
  }
  private readonly onClick = (event: MouseEvent) => {
    if (!this.eventIsWithinTarget(event)) return
    this.clearSettle()
    this.scheduleDeferred(false)
  }
  private readonly onPointerDown = (event: PointerEvent) => {
    if (!this.eventIsWithinTarget(event)) return
    this.selecting = true
    this.useNativeCaret()
  }
  private readonly onPointerUp = (event: PointerEvent) => {
    if (!this.eventIsWithinTarget(event)) return
    this.selecting = false
    this.useCustomCaret()
    this.scheduleDeferred(true)
  }
  private readonly onSelectionChange = () => this.scheduleDeferred(false)
  private readonly onCompositionStart = (event: CompositionEvent) => {
    if (!this.eventIsWithinTarget(event)) return
    this.composing = true
    this.useNativeCaret()
  }
  private readonly onCompositionEnd = (event: CompositionEvent) => {
    if (!this.eventIsWithinTarget(event)) return
    this.composing = false
    this.useCustomCaret()
    this.scheduleDeferred(true)
  }
  private readonly onViewportChange = () => this.scheduleDeferred(true)

  destroy(): void {
    this.restoreNativeCaret()
    this.events.abort()
    this.unsubscribeReduced()
    this.rootObserver.disconnect()
    this.targetRemovalObserver.disconnect()
    this.targetObserver?.disconnect()
    this.measurer.dispose()
    this.stop()
    this.clearSettle()
    if (this.eventRaf != null) cancelAnimationFrame(this.eventRaf)
    if (this.eventTimer != null) window.clearTimeout(this.eventTimer)
    this.layer.remove()
  }
}

export function UniversalCaretLayer() {
  useEffect(() => {
    const controller = new UniversalCaretController()
    const active = document.activeElement
    if (isCaretTarget(active)) active.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    return () => controller.destroy()
  }, [])
  return null
}
