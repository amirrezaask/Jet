import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view"
import type { Extension } from "@codemirror/state"
import {
  ANIM_EPSILON,
  CaretEndpointAnim,
  onReducedMotionChange,
  prefersReducedMotion,
  type CaretPoint,
} from "@jet/shared"

const SVG_NS = "http://www.w3.org/2000/svg"
const STREAK_BASE_ALPHA = 0.35
const STREAK_MIN_ALPHA = 0.1
const STREAK_MAX_SHEAR_DEG = 8
const STREAK_Y_OVERSHOOT = 0.125

const MAIN_THICKNESS = 4
const ANCHOR_THICKNESS = 3

type BracketShape = "open" | "close"

type RenderItem = {
  key: string
  shape: BracketShape
  thickness: number
  opacity: number
}

type EndpointTarget = {
  key: string
  point: CaretPoint
}

type MeasureResult = {
  endpoints: EndpointTarget[]
  renderPlan: RenderItem[]
  focusOpacity: number
  visible: boolean
}

function measurePoint(view: EditorView, pos: number): CaretPoint | null {
  const rect = view.coordsAtPos(pos)
  if (!rect) return null
  const scrollRect = view.scrollDOM.getBoundingClientRect()
  const x = rect.left - scrollRect.left + view.scrollDOM.scrollLeft
  const y = rect.top - scrollRect.top + view.scrollDOM.scrollTop
  const h = rect.bottom - rect.top

  let charWidth = rect.right - rect.left
  const doc = view.state.doc
  if (pos + 1 <= doc.length) {
    const next = view.coordsAtPos(pos + 1)
    if (next && Math.abs(next.top - rect.top) < 1) {
      charWidth = next.left - rect.left
    }
  }
  if (charWidth <= 0) charWidth = h * 0.55

  return { x, y, h, charWidth }
}

function measureCursors(view: EditorView): MeasureResult | null {
  const ranges = view.state.selection.ranges
  const endpoints: EndpointTarget[] = []
  const renderPlan: RenderItem[] = []

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!
    const headPoint = measurePoint(view, range.head)
    if (!headPoint) continue

    const headKey = `r${i}-head`
    endpoints.push({ key: headKey, point: headPoint })

    if (range.empty) {
      renderPlan.push(
        { key: `${headKey}-open`, shape: "open", thickness: MAIN_THICKNESS, opacity: 1 },
        { key: `${headKey}-close`, shape: "close", thickness: MAIN_THICKNESS, opacity: 1 },
      )
      continue
    }

    const anchorPoint = measurePoint(view, range.anchor)
    if (!anchorPoint) continue
    const anchorKey = `r${i}-anchor`
    endpoints.push({ key: anchorKey, point: anchorPoint })

    const headBeforeAnchor = range.head <= range.anchor
    const headShape: BracketShape = headBeforeAnchor ? "open" : "close"
    const anchorShape: BracketShape = headBeforeAnchor ? "close" : "open"

    renderPlan.push({
      key: `${headKey}-${headShape}`,
      shape: headShape,
      thickness: MAIN_THICKNESS,
      opacity: 1,
    })
    renderPlan.push({
      key: `${anchorKey}-${anchorShape}`,
      shape: anchorShape,
      thickness: ANCHOR_THICKNESS,
      opacity: 0.65,
    })
  }

  if (endpoints.length === 0) return null

  return {
    endpoints,
    renderPlan,
    focusOpacity: view.hasFocus ? 1 : 0.4,
    visible: true,
  }
}

function createBracketGroup(): HTMLDivElement {
  const group = document.createElement("div")
  group.className = "jet-bracket-group"
  for (const part of ["top", "left", "bottom", "right"] as const) {
    const el = document.createElement("div")
    el.className = `jet-bracket-part jet-bracket-${part}`
    group.appendChild(el)
  }
  return group
}

function layoutBracketGroup(
  group: HTMLDivElement,
  x: number,
  y: number,
  h: number,
  shape: BracketShape,
  thickness: number,
  opacity: number,
  focusOpacity: number,
): void {
  const bracketW = h * 0.5
  group.style.transform = `translate3d(${x}px, ${y}px, 0)`
  group.style.height = `${h}px`
  group.style.opacity = String(opacity * focusOpacity)

  const top = group.querySelector<HTMLElement>(".jet-bracket-top")!
  const left = group.querySelector<HTMLElement>(".jet-bracket-left")!
  const bottom = group.querySelector<HTMLElement>(".jet-bracket-bottom")!
  const right = group.querySelector<HTMLElement>(".jet-bracket-right")!

  for (const part of [top, left, bottom, right]) {
    part.style.display = "none"
  }

  const color = "var(--jet-cursor-color, #c4923a)"

  if (shape === "open") {
    top.style.display = "block"
    top.style.left = `${thickness}px`
    top.style.top = "0"
    top.style.width = `${bracketW}px`
    top.style.height = `${thickness}px`

    left.style.display = "block"
    left.style.left = "0"
    left.style.top = "0"
    left.style.width = `${thickness}px`
    left.style.height = `${h}px`
  } else {
    bottom.style.display = "block"
    bottom.style.left = `${-bracketW}px`
    bottom.style.top = `${h - thickness}px`
    bottom.style.width = `${bracketW}px`
    bottom.style.height = `${thickness}px`

    right.style.display = "block"
    right.style.left = "0"
    right.style.top = "0"
    right.style.width = `${thickness}px`
    right.style.height = `${h}px`
  }

  for (const part of [top, left, bottom, right]) {
    if (part.style.display !== "none") {
      part.style.background = color
    }
  }
}

function isTypingHop(update: ViewUpdate): boolean {
  if (!update.docChanged) return false
  const prev = update.startState
  const next = update.state
  if (next.selection.ranges.length !== 1) return false
  const r = next.selection.main
  const pr = prev.selection.main
  if (!r.empty || !pr.empty) return false
  if (r.head !== pr.head + 1) return false
  return prev.doc.lineAt(pr.head).number === next.doc.lineAt(r.head).number
}

class BracketCursorPlugin {
  private layer: HTMLDivElement
  private streakSvg: SVGSVGElement
  private streakRects = new Map<string, {
    rect: SVGRectElement
    gradient: SVGLinearGradientElement
    stopA: SVGStopElement
    stopB: SVGStopElement
  }>()
  private groups: HTMLDivElement[] = []
  private anims = new Map<string, CaretEndpointAnim>()
  private renderPlan: RenderItem[] = []
  private focusOpacity = 1
  private rafId: number | null = null
  private lastFrameTime = 0
  private instantNext = true
  private reducedMotion: boolean
  private unsubMotion: (() => void) | null = null
  private streakDefs: SVGDefsElement

  constructor(private view: EditorView) {
    this.reducedMotion = prefersReducedMotion()
    this.streakSvg = document.createElementNS(SVG_NS, "svg")
    this.streakSvg.setAttribute("class", "jet-cursor-streak-layer")
    this.streakSvg.style.position = "absolute"
    this.streakSvg.style.inset = "0"
    this.streakSvg.style.pointerEvents = "none"
    this.streakSvg.style.overflow = "visible"
    this.streakSvg.style.zIndex = "29"
    this.streakSvg.style.width = "100%"
    this.streakSvg.style.height = "100%"
    this.streakDefs = document.createElementNS(SVG_NS, "defs")
    this.streakSvg.appendChild(this.streakDefs)
    this.layer = document.createElement("div")
    this.layer.className = "jet-cursor-layer"
    view.scrollDOM.appendChild(this.streakSvg)
    view.scrollDOM.appendChild(this.layer)
    this.unsubMotion = onReducedMotionChange(v => {
      this.reducedMotion = v
    })
    this.scheduleMeasure()
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
        this.layer.style.opacity = "0"
        this.streakSvg.style.opacity = "0"
        this.stopRaf()
        return
      }
      const typingHop = isTypingHop(update)
      this.instantNext = this.reducedMotion || (update.docChanged && !typingHop)
      this.scheduleMeasure()
    }
  }

  private scheduleMeasure() {
    this.view.requestMeasure({
      read: view => measureCursors(view),
      write: result => {
        if (!result || !result.visible) {
          this.layer.style.opacity = "0"
          this.streakSvg.style.opacity = "0"
          return
        }

        this.focusOpacity = result.focusOpacity
        this.renderPlan = result.renderPlan
        this.layer.style.opacity = "1"
        this.streakSvg.style.opacity = "1"

        const activeKeys = new Set<string>()
        let snapped = false

        for (const { key, point } of result.endpoints) {
          activeKeys.add(key)
          let anim = this.anims.get(key)
          if (!anim) {
            anim = new CaretEndpointAnim()
            anim.snap(point)
            this.anims.set(key, anim)
            snapped = true
          } else {
            if (anim.setTarget(point, this.instantNext)) snapped = true
          }
        }

        for (const key of this.anims.keys()) {
          if (!activeKeys.has(key)) {
            this.anims.delete(key)
            this.removeStreak(key)
          }
        }

        this.render()

        const shouldAnimate =
          !this.instantNext &&
          !snapped &&
          [...this.anims.values()].some(a => {
            const dx = a.targetX - a.x
            const dy = a.targetY - a.y
            return dx * dx + dy * dy > ANIM_EPSILON * ANIM_EPSILON
          })

        if (!shouldAnimate) this.stopRaf()
        else this.startRaf()
        this.instantNext = false
      },
    })
  }

  private startRaf() {
    if (this.rafId != null) return
    this.lastFrameTime = performance.now()
    this.rafId = requestAnimationFrame(t => this.tick(t))
  }

  private stopRaf() {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  private tick(time: number) {
    const dt = Math.min(0.05, (time - this.lastFrameTime) / 1000)
    this.lastFrameTime = time

    const measured = measureCursors(this.view)
    if (measured) {
      for (const { key, point } of measured.endpoints) {
        this.anims.get(key)?.followTarget(point)
      }
    }

    let active = false
    for (const anim of this.anims.values()) {
      if (anim.step(dt)) active = true
    }

    this.render()

    if (active) this.rafId = requestAnimationFrame(t => this.tick(t))
    else this.rafId = null
  }

  private removeStreak(key: string) {
    const entry = this.streakRects.get(key)
    if (!entry) return
    entry.rect.remove()
    entry.gradient.remove()
    this.streakRects.delete(key)
  }

  private ensureStreak(key: string) {
    let entry = this.streakRects.get(key)
    if (entry) return entry
    const gradient = document.createElementNS(SVG_NS, "linearGradient")
    const gradId = `jet-streak-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`
    gradient.setAttribute("id", gradId)
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
    this.streakDefs.appendChild(gradient)

    const rect = document.createElementNS(SVG_NS, "rect")
    rect.setAttribute("fill", `url(#${gradId})`)
    rect.setAttribute("rx", "1")
    this.streakSvg.appendChild(rect)
    entry = { rect, gradient, stopA, stopB }
    this.streakRects.set(key, entry)
    return entry
  }

  private renderStreaks() {
    const activeStreakKeys = new Set<string>()

    for (const { key } of this.renderPlan) {
      const endpointKey = key.replace(/-(open|close)$/, "")
      const anim = this.anims.get(endpointKey)
      if (!anim) continue

      const dx = anim.targetX - anim.x
      const dy = anim.targetY - anim.y
      const distSq = dx * dx + dy * dy
      if (this.reducedMotion || distSq < ANIM_EPSILON * ANIM_EPSILON) {
        this.removeStreak(endpointKey)
        continue
      }

      activeStreakKeys.add(endpointKey)
      const entry = this.ensureStreak(endpointKey)

      const x0 = Math.min(anim.x, anim.targetX)
      const x1 = Math.max(anim.x, anim.targetX)
      const width = Math.max(x1 - x0, 1)
      const overshoot = anim.h * STREAK_Y_OVERSHOOT
      const y0 = anim.y - overshoot
      const height = anim.h + overshoot * 2
      const rightward = anim.targetX > anim.x
      const baseAlpha = STREAK_BASE_ALPHA * this.focusOpacity

      const leadAlpha = baseAlpha
      const trailAlpha = baseAlpha * STREAK_MIN_ALPHA

      entry.stopA.setAttribute("stop-opacity", String(rightward ? trailAlpha : leadAlpha))
      entry.stopB.setAttribute("stop-opacity", String(rightward ? leadAlpha : trailAlpha))

      let shearDeg = 0
      if (Math.abs(dy) > 2) {
        const raw = (-Math.atan(dy * 0.5) * 180) / Math.PI
        shearDeg = Math.max(-STREAK_MAX_SHEAR_DEG, Math.min(STREAK_MAX_SHEAR_DEG, raw))
        if (!rightward) shearDeg = -shearDeg
      }

      entry.rect.setAttribute("x", String(x0))
      entry.rect.setAttribute("y", String(y0))
      entry.rect.setAttribute("width", String(width))
      entry.rect.setAttribute("height", String(height))
      entry.rect.setAttribute(
        "transform",
        shearDeg !== 0 ? `skewY(${shearDeg.toFixed(2)})` : "",
      )
    }

    for (const key of Array.from(this.streakRects.keys())) {
      if (!activeStreakKeys.has(key)) this.removeStreak(key)
    }
  }

  private render() {
    this.renderStreaks()

    const needed = this.renderPlan.length
    while (this.groups.length < needed) {
      const group = createBracketGroup()
      this.groups.push(group)
      this.layer.appendChild(group)
    }
    while (this.groups.length > needed) {
      this.groups.pop()?.remove()
    }

    for (let i = 0; i < needed; i++) {
      const item = this.renderPlan[i]!
      const group = this.groups[i]!
      const endpointKey = item.key.replace(/-(open|close)$/, "")
      const anim = this.anims.get(endpointKey)
      if (!anim) {
        group.style.display = "none"
        continue
      }
      group.style.display = "block"
      layoutBracketGroup(
        group,
        anim.x,
        anim.y,
        anim.h,
        item.shape,
        item.thickness,
        item.opacity,
        this.focusOpacity,
      )
    }
  }

  destroy() {
    this.stopRaf()
    this.unsubMotion?.()
    this.layer.remove()
    this.streakSvg.remove()
    this.anims.clear()
    this.streakRects.clear()
  }
}

export function motionCursor(): Extension {
  return [
    EditorView.theme({
      ".jet-cursor-streak-layer": {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
        zIndex: "29",
        overflow: "visible",
      },
      ".jet-cursor-layer": {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
        zIndex: "30",
      },
      ".jet-bracket-group": {
        position: "absolute",
        top: "0",
        left: "0",
        width: "0",
        willChange: "transform, opacity",
      },
      ".jet-bracket-part": {
        position: "absolute",
        borderRadius: "1px",
      },
    }),
    ViewPlugin.fromClass(BracketCursorPlugin),
  ]
}
