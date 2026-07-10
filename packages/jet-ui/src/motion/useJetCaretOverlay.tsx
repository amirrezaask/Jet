import {
  useEffect,
  useRef,
  forwardRef,
  type RefObject,
  type InputHTMLAttributes,
} from "react"
import {
  ANIM_EPSILON,
  CaretEndpointAnim,
  prefersReducedMotion,
  onReducedMotionChange,
  type CaretPoint,
} from "@jet/shared"
import { cn } from "@/lib/utils.js"

const SVG_NS = "http://www.w3.org/2000/svg"
const INPUT_STREAK_BASE_ALPHA = 0.32
const INPUT_STREAK_MIN_ALPHA = 0.1
const INPUT_STREAK_MAX_SHEAR_DEG = 6
const INPUT_STREAK_Y_OVERSHOOT = 0.1

let nextGradientId = 0

type InputVisualState = {
  point: CaretPoint | null
  visible: boolean
  allowStreak: boolean
}

type StreakEntry = {
  svg: SVGSVGElement
  rect: SVGRectElement
  stopA: SVGStopElement
  stopB: SVGStopElement
}

function createMirror(style: CSSStyleDeclaration): HTMLDivElement {
  const mirror = document.createElement("div")
  mirror.style.position = "absolute"
  mirror.style.visibility = "hidden"
  mirror.style.left = "-9999px"
  mirror.style.top = "0"
  mirror.style.whiteSpace = "pre"
  mirror.style.font = style.font
  mirror.style.fontKerning = style.fontKerning
  mirror.style.fontVariantLigatures = style.fontVariantLigatures
  mirror.style.letterSpacing = style.letterSpacing
  mirror.style.textTransform = style.textTransform
  mirror.style.textIndent = style.textIndent
  mirror.style.textRendering = style.textRendering
  mirror.style.padding = "0"
  mirror.style.border = "0"
  mirror.style.margin = "0"
  return mirror
}

function measureTextOffset(style: CSSStyleDeclaration, textBefore: string): number {
  const mirror = createMirror(style)
  const marker = document.createElement("span")
  marker.textContent = "\u200b"
  mirror.append(textBefore)
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const mirrorRect = mirror.getBoundingClientRect()
  const markerRect = marker.getBoundingClientRect()
  document.body.removeChild(mirror)
  return markerRect.left - mirrorRect.left
}

function measureCharWidth(style: CSSStyleDeclaration, char: string, fallback: number): number {
  if (!char) return fallback
  const mirror = createMirror(style)
  mirror.textContent = char
  document.body.appendChild(mirror)
  const width = mirror.getBoundingClientRect().width
  document.body.removeChild(mirror)
  return width > 0 ? width : fallback
}

function measureInputCaret(input: HTMLInputElement, anchor: HTMLElement): CaretPoint | null {
  const selectionStart = input.selectionStart
  const selectionEnd = input.selectionEnd
  if (selectionStart == null || selectionEnd == null || selectionStart !== selectionEnd) return null

  const style = getComputedStyle(input)
  const textBefore = input.value.slice(0, selectionStart)
  const textOffset = measureTextOffset(style, textBefore)

  const anchorRect = anchor.getBoundingClientRect()
  const inputRect = input.getBoundingClientRect()
  const offsetX = inputRect.left - anchorRect.left
  const offsetY = inputRect.top - anchorRect.top

  const parsedLineHeight = parseFloat(style.lineHeight)
  const fontSize = parseFloat(style.fontSize) || 13
  const lineHeight =
    Number.isFinite(parsedLineHeight) && parsedLineHeight > 0
      ? parsedLineHeight
      : fontSize * 1.4
  const padTop = parseFloat(style.paddingTop) || 0
  const padBottom = parseFloat(style.paddingBottom) || 0
  const padLeft = parseFloat(style.paddingLeft) || 0
  const contentHeight = input.clientHeight - padTop - padBottom
  const caretH = Math.min(lineHeight, fontSize * 1.25)
  const scrollLeft = input.scrollLeft
  const nextChar = input.value.slice(selectionStart, selectionStart + 1)
  const prevChar = selectionStart > 0 ? input.value.slice(selectionStart - 1, selectionStart) : ""
  const charWidth = measureCharWidth(style, nextChar || prevChar, fontSize * 0.55)

  return {
    x: offsetX + padLeft + textOffset - scrollLeft,
    y: offsetY + padTop + (contentHeight - caretH) / 2,
    h: caretH,
    charWidth,
  }
}

function createStreakLayer(): StreakEntry {
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.classList.add("jet-input-caret-streak-layer")
  svg.dataset.jetInputCaret = "streak-layer"
  svg.style.position = "absolute"
  svg.style.inset = "0"
  svg.style.pointerEvents = "none"
  svg.style.overflow = "visible"
  svg.style.width = "100%"
  svg.style.height = "100%"

  const defs = document.createElementNS(SVG_NS, "defs")
  svg.appendChild(defs)

  const gradient = document.createElementNS(SVG_NS, "linearGradient")
  const gradientId = `jet-input-streak-${nextGradientId++}`
  gradient.setAttribute("id", gradientId)
  gradient.setAttribute("gradientUnits", "objectBoundingBox")
  gradient.setAttribute("x1", "0")
  gradient.setAttribute("y1", "0")
  gradient.setAttribute("x2", "1")
  gradient.setAttribute("y2", "0")

  const stopA = document.createElementNS(SVG_NS, "stop")
  stopA.setAttribute("offset", "0")
  stopA.setAttribute("stop-color", "var(--jet-cursor-color, #c4923a)")
  const stopB = document.createElementNS(SVG_NS, "stop")
  stopB.setAttribute("offset", "1")
  stopB.setAttribute("stop-color", "var(--jet-cursor-color, #c4923a)")
  gradient.appendChild(stopA)
  gradient.appendChild(stopB)
  defs.appendChild(gradient)

  const rect = document.createElementNS(SVG_NS, "rect")
  rect.dataset.jetInputCaret = "streak"
  rect.setAttribute("fill", `url(#${gradientId})`)
  rect.setAttribute("rx", "1")
  svg.appendChild(rect)

  return { svg, rect, stopA, stopB }
}

function hideCaretVisuals(caretBar: HTMLDivElement, streak: StreakEntry): void {
  caretBar.style.display = "none"
  streak.svg.style.display = "none"
}

function renderCaretBar(caretBar: HTMLDivElement, anim: CaretEndpointAnim): void {
  caretBar.style.display = "block"
  caretBar.style.transform = `translate3d(${anim.x}px, ${anim.y}px, 0)`
  caretBar.style.height = `${anim.h}px`
  caretBar.style.opacity = "1"
}

function renderStreak(streak: StreakEntry, anim: CaretEndpointAnim): void {
  const dx = anim.targetX - anim.x
  const dy = anim.targetY - anim.y
  const distSq = dx * dx + dy * dy
  if (distSq < ANIM_EPSILON * ANIM_EPSILON) {
    streak.svg.style.display = "none"
    return
  }

  const x0 = Math.min(anim.x, anim.targetX)
  const x1 = Math.max(anim.x, anim.targetX)
  const width = Math.max(x1 - x0, 1)
  const overshoot = anim.h * INPUT_STREAK_Y_OVERSHOOT
  const y0 = anim.y - overshoot
  const height = anim.h + overshoot * 2
  const rightward = anim.targetX > anim.x
  const leadAlpha = INPUT_STREAK_BASE_ALPHA
  const trailAlpha = INPUT_STREAK_BASE_ALPHA * INPUT_STREAK_MIN_ALPHA

  streak.stopA.setAttribute("stop-opacity", String(rightward ? trailAlpha : leadAlpha))
  streak.stopB.setAttribute("stop-opacity", String(rightward ? leadAlpha : trailAlpha))

  let shearDeg = 0
  if (Math.abs(dy) > 1.5) {
    const raw = (-Math.atan(dy * 0.5) * 180) / Math.PI
    shearDeg = Math.max(-INPUT_STREAK_MAX_SHEAR_DEG, Math.min(INPUT_STREAK_MAX_SHEAR_DEG, raw))
    if (!rightward) shearDeg = -shearDeg
  }

  streak.rect.setAttribute("x", String(x0))
  streak.rect.setAttribute("y", String(y0))
  streak.rect.setAttribute("width", String(width))
  streak.rect.setAttribute("height", String(height))
  streak.rect.setAttribute(
    "transform",
    shearDeg !== 0 ? `skewY(${shearDeg.toFixed(2)})` : "",
  )
  streak.svg.style.display = "block"
}

function measureVisualState(
  input: HTMLInputElement,
  anchor: HTMLElement,
  composing: boolean,
  pointerSelecting: boolean,
): InputVisualState {
  const focused = document.activeElement === input
  const point = measureInputCaret(input, anchor)
  const visible = focused && point != null && !composing
  return {
    point,
    visible,
    allowStreak: visible && !pointerSelecting,
  }
}

export function useJetCaretOverlay(
  inputRef: RefObject<HTMLInputElement | null>,
  enabled = true,
  anchorRef?: RefObject<HTMLElement | null>,
): void {
  const animRef = useRef(new CaretEndpointAnim())
  const rafRef = useRef<number | null>(null)
  const eventRafRef = useRef<number | null>(null)
  const lastFrameRef = useRef(0)
  const reducedRef = useRef(prefersReducedMotion())
  const composingRef = useRef(false)
  const pointerSelectingRef = useRef(false)

  useEffect(() => onReducedMotionChange(v => (reducedRef.current = v)), [])

  useEffect(() => {
    if (!enabled) return
    // AppShell owns a single delegated caret layer so every input surface uses
    // one engine. Keep this hook as a standalone fallback for isolated UI use.
    if (document.querySelector("[data-jet-universal-caret]")) return
    const input = inputRef.current
    const anchor = anchorRef?.current ?? input?.parentElement
    if (!input || !anchor) return

    const streak = createStreakLayer()
    const layer = document.createElement("div")
    layer.className = "jet-input-caret-layer"
    layer.dataset.jetInputCaret = "layer"
    layer.style.position = "absolute"
    layer.style.inset = "0"
    layer.style.pointerEvents = "none"
    layer.style.overflow = "hidden"

    const caretBar = document.createElement("div")
    caretBar.className = "jet-input-caret-bar"
    caretBar.dataset.jetInputCaret = "bar"
    caretBar.style.position = "absolute"
    caretBar.style.width = "2px"
    caretBar.style.borderRadius = "1px"
    caretBar.style.background = "var(--jet-cursor-color, #c4923a)"
    caretBar.style.pointerEvents = "none"

    layer.appendChild(caretBar)
    anchor.appendChild(streak.svg)
    anchor.appendChild(layer)
    hideCaretVisuals(caretBar, streak)

    input.style.caretColor = "transparent"

    const stopAnimating = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }

    const render = (state: InputVisualState) => {
      if (!state.visible || state.point == null) {
        hideCaretVisuals(caretBar, streak)
        return
      }
      renderCaretBar(caretBar, animRef.current)
      if (!state.allowStreak || reducedRef.current) {
        streak.svg.style.display = "none"
        return
      }
      renderStreak(streak, animRef.current)
    }

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastFrameRef.current) / 1000)
      lastFrameRef.current = now

      const state = measureVisualState(
        input,
        anchor,
        composingRef.current,
        pointerSelectingRef.current,
      )
      if (!state.visible || state.point == null) {
        hideCaretVisuals(caretBar, streak)
        rafRef.current = null
        return
      }

      animRef.current.followTarget(state.point)
      const active = animRef.current.step(dt)
      render(state)
      if (active) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        rafRef.current = null
      }
    }

    const schedule = (instant: boolean) => {
      const state = measureVisualState(
        input,
        anchor,
        composingRef.current,
        pointerSelectingRef.current,
      )
      if (!state.visible || state.point == null) {
        hideCaretVisuals(caretBar, streak)
        stopAnimating()
        return
      }

      if (!instant && !reducedRef.current) {
        animRef.current.lastRetargetAt = 0
      }
      animRef.current.setTarget(state.point, instant || reducedRef.current)
      render(state)

      const dx = animRef.current.targetX - animRef.current.x
      const dy = animRef.current.targetY - animRef.current.y
      const dh = animRef.current.targetH - animRef.current.h
      const shouldAnimate =
        !instant &&
        !reducedRef.current &&
        dx * dx + dy * dy + dh * dh > ANIM_EPSILON * ANIM_EPSILON

      if (!shouldAnimate) {
        stopAnimating()
        return
      }

      if (rafRef.current == null) {
        lastFrameRef.current = performance.now()
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    const scheduleDeferred = (instant: boolean) => {
      if (eventRafRef.current != null) cancelAnimationFrame(eventRafRef.current)
      eventRafRef.current = requestAnimationFrame(() => {
        eventRafRef.current = null
        schedule(instant)
      })
    }

    const onInput = () => schedule(false)
    const onSelect = () => schedule(false)
    const onFocus = () => schedule(true)
    const onBlur = () => {
      pointerSelectingRef.current = false
      schedule(true)
    }
    const onKeyDown = () => scheduleDeferred(false)
    const onClick = () => scheduleDeferred(false)
    const onPointerDown = () => {
      pointerSelectingRef.current = true
      schedule(true)
    }
    const onPointerUp = () => {
      pointerSelectingRef.current = false
      scheduleDeferred(false)
    }
    const onScroll = () => schedule(true)
    const onCompositionStart = () => {
      composingRef.current = true
      schedule(true)
    }
    const onCompositionEnd = () => {
      composingRef.current = false
      scheduleDeferred(true)
    }

    const controller = new AbortController()
    const { signal } = controller
    input.addEventListener("input", onInput, { signal })
    input.addEventListener("select", onSelect, { signal })
    input.addEventListener("focus", onFocus, { signal })
    input.addEventListener("blur", onBlur, { signal })
    input.addEventListener("keydown", onKeyDown, { signal })
    input.addEventListener("click", onClick, { signal })
    input.addEventListener("pointerdown", onPointerDown, { signal })
    input.addEventListener("pointerup", onPointerUp, { signal })
    input.addEventListener("pointercancel", onPointerUp, { signal })
    input.addEventListener("scroll", onScroll, { signal, passive: true })
    input.addEventListener("compositionstart", onCompositionStart, { signal })
    input.addEventListener("compositionend", onCompositionEnd, { signal })
    schedule(true)

    return () => {
      controller.abort()
      input.style.caretColor = ""
      stopAnimating()
      if (eventRafRef.current != null) cancelAnimationFrame(eventRafRef.current)
      layer.remove()
      streak.svg.remove()
    }
  }, [inputRef, anchorRef, enabled])
}

export const JetCaretInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { caretOverlay?: boolean }
>(function JetCaretInput({ className, caretOverlay = true, ...props }, ref) {
  const innerRef = useRef<HTMLInputElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  useJetCaretOverlay(innerRef, caretOverlay, anchorRef)

  return (
    <div ref={anchorRef} data-jet-caret-anchor="" className="relative min-w-0">
      <input
        ref={el => {
          innerRef.current = el
          if (typeof ref === "function") ref(el)
          else if (ref) ref.current = el
        }}
        data-slot="input"
        className={cn(
          "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
          className,
        )}
        {...props}
      />
    </div>
  )
})

export function useJetCaretOverlayRef<T extends HTMLInputElement>(
  externalRef: RefObject<T | null>,
  enabled = true,
): RefObject<T | null> {
  useJetCaretOverlay(externalRef, enabled)
  return externalRef
}
