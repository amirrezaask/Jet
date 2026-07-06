import {
  useEffect,
  useRef,
  forwardRef,
  type RefObject,
  type InputHTMLAttributes,
} from "react"
import {
  CaretEndpointAnim,
  CaretGhostBuffer,
  prefersReducedMotion,
  onReducedMotionChange,
  type CaretPoint,
} from "@jet/shared"
import { cn } from "@/lib/utils.js"

function measureInputCaret(input: HTMLInputElement, anchor: HTMLElement): CaretPoint | null {
  const style = getComputedStyle(input)
  const mirror = document.createElement("div")
  const textBefore = input.value.slice(0, input.selectionStart ?? 0)
  mirror.style.position = "absolute"
  mirror.style.visibility = "hidden"
  mirror.style.whiteSpace = "pre"
  mirror.style.font = style.font
  mirror.style.letterSpacing = style.letterSpacing
  mirror.style.textTransform = style.textTransform
  mirror.style.padding = "0"
  mirror.textContent = textBefore || " "
  document.body.appendChild(mirror)
  const textWidth = mirror.getBoundingClientRect().width
  document.body.removeChild(mirror)

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
  const contentHeight = input.clientHeight - padTop - padBottom
  const caretH = Math.min(lineHeight, fontSize * 1.25)

  const scrollLeft = input.scrollLeft
  const padLeft = parseFloat(style.paddingLeft) || 0
  const charWidth =
    textBefore.length > 0 ? textWidth / textBefore.length : fontSize * 0.55

  return {
    x: offsetX + padLeft + textWidth - scrollLeft,
    y: offsetY + padTop + (contentHeight - caretH) / 2,
    h: caretH,
    charWidth,
  }
}

function renderCaretLayer(
  layer: HTMLDivElement,
  main: CaretEndpointAnim,
  ghosts: ReturnType<CaretGhostBuffer["tick"]>,
  focusOpacity: number,
): void {
  while (layer.children.length < ghosts.length + 1) {
    const bar = document.createElement("div")
    bar.className = "jet-input-caret-bar"
    bar.style.position = "absolute"
    bar.style.width = "2px"
    bar.style.borderRadius = "1px"
    bar.style.background = "var(--jet-cursor-color, #c4923a)"
    bar.style.pointerEvents = "none"
    layer.appendChild(bar)
  }
  while (layer.children.length > ghosts.length + 1) {
    layer.lastChild?.remove()
  }

  for (let i = 0; i < ghosts.length; i++) {
    const g = ghosts[i]!
    const el = layer.children[i] as HTMLElement
    el.style.display = "block"
    el.style.transform = `translate3d(${g.x}px, ${g.y}px, 0)`
    el.style.height = `${g.h}px`
    el.style.opacity = String(g.opacity * focusOpacity)
  }

  const mainEl = layer.children[ghosts.length] as HTMLElement
  mainEl.style.display = "block"
  mainEl.style.transform = `translate3d(${main.x}px, ${main.y}px, 0)`
  mainEl.style.height = `${main.h}px`
  mainEl.style.opacity = String(focusOpacity)
}

export function useJetCaretOverlay(
  inputRef: RefObject<HTMLInputElement | null>,
  enabled = true,
  anchorRef?: RefObject<HTMLElement | null>,
): void {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const animRef = useRef(new CaretEndpointAnim())
  const ghostsRef = useRef(new CaretGhostBuffer())
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef(0)
  const reducedRef = useRef(prefersReducedMotion())
  const prevPointRef = useRef<CaretPoint | null>(null)

  useEffect(() => onReducedMotionChange(v => (reducedRef.current = v)), [])

  useEffect(() => {
    if (!enabled) return
    const input = inputRef.current
    const anchor = anchorRef?.current ?? input?.parentElement
    if (!input || !anchor) return

    const layer = document.createElement("div")
    layer.className = "jet-input-caret-layer"
    layer.style.position = "absolute"
    layer.style.inset = "0"
    layer.style.pointerEvents = "none"
    layer.style.overflow = "hidden"
    layerRef.current = layer
    anchor.appendChild(layer)

    input.style.caretColor = "transparent"

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastFrameRef.current) / 1000)
      lastFrameRef.current = now
      const measured = measureInputCaret(input, anchor)
      if (measured) {
        animRef.current.followTarget(measured)
      }
      const active = animRef.current.step(dt)
      const ghosts = ghostsRef.current.tick(now)
      renderCaretLayer(layer, animRef.current, ghosts, document.activeElement === input ? 1 : 0.35)
      if (active) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        rafRef.current = null
      }
    }

    const schedule = (instant: boolean) => {
      const measured = measureInputCaret(input, anchor)
      if (!measured) return
      const prev = prevPointRef.current
      if (prev && !instant && !reducedRef.current) {
        const dx = measured.x - prev.x
        const dy = measured.y - prev.y
        if (dx * dx + dy * dy > 0.5) {
          ghostsRef.current.push(animRef.current.x, animRef.current.y, animRef.current.h)
        }
      }
      animRef.current.setTarget(measured, instant || reducedRef.current)
      prevPointRef.current = measured
      renderCaretLayer(
        layer,
        animRef.current,
        ghostsRef.current.tick(),
        document.activeElement === input ? 1 : 0.35,
      )
      if (rafRef.current == null) {
        lastFrameRef.current = performance.now()
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    const onInput = () => schedule(false)
    const onSelect = () => schedule(false)
    const onFocus = () => schedule(true)
    const onBlur = () => schedule(true)

    input.addEventListener("input", onInput)
    input.addEventListener("select", onSelect)
    input.addEventListener("focus", onFocus)
    input.addEventListener("blur", onBlur)
    input.addEventListener("keydown", onInput)
    schedule(true)

    return () => {
      input.removeEventListener("input", onInput)
      input.removeEventListener("select", onSelect)
      input.removeEventListener("focus", onFocus)
      input.removeEventListener("blur", onBlur)
      input.removeEventListener("keydown", onInput)
      input.style.caretColor = ""
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      layer.remove()
      layerRef.current = null
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
    <div ref={anchorRef} className={cn("relative min-w-0", className)}>
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
          caretOverlay && "caret-transparent",
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
