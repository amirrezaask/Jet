import { EditorView, ViewPlugin, drawSelection, type ViewUpdate } from "@codemirror/view"
import type { Extension } from "@codemirror/state"

const CURSOR_SPEED = 24
const CURSOR_SHORT_HOP_MULT = 2.5
const CURSOR_RETARGET_WINDOW = 0.12
const ANIM_EPSILON = 0.5
const MAIN_THICKNESS = 4
const ANCHOR_THICKNESS = 3

type BracketShape = "open" | "close"

type MeasuredPoint = {
  x: number
  y: number
  h: number
  charWidth: number
}

type RenderItem = {
  key: string
  shape: BracketShape
  thickness: number
  opacity: number
}

type EndpointTarget = {
  key: string
  point: MeasuredPoint
}

type MeasureResult = {
  endpoints: EndpointTarget[]
  renderPlan: RenderItem[]
  focusOpacity: number
  visible: boolean
}

function expSmooth(current: number, target: number, speed: number, dt: number): number {
  if (speed <= 0 || dt <= 0) return target
  return current + (target - current) * (1 - Math.exp(-speed * dt))
}

class CursorEndpointAnim {
  x = 0
  y = 0
  h = 0
  targetX = 0
  targetY = 0
  targetH = 0
  charWidth = 8
  prevTargetX = 0
  prevTargetY = 0
  lastRetargetAt = 0
  lastAnimY0 = 0
  lastAnimY1 = 0

  snap(point: MeasuredPoint): void {
    this.x = point.x
    this.y = point.y
    this.h = point.h
    this.targetX = point.x
    this.targetY = point.y
    this.targetH = point.h
    this.charWidth = point.charWidth
    this.prevTargetX = point.x
    this.prevTargetY = point.y
    this.lastAnimY0 = point.y
    this.lastAnimY1 = point.y + point.h
  }

  setTarget(point: MeasuredPoint, instant: boolean): boolean {
    const dx = point.x - this.prevTargetX
    const dy = point.y - this.prevTargetY
    const moved = dx * dx + dy * dy > 0.25

    if (moved) {
      const now = performance.now()
      if (
        this.lastRetargetAt > 0 &&
        now - this.lastRetargetAt < CURSOR_RETARGET_WINDOW * 1000
      ) {
        this.snap(point)
        this.prevTargetX = point.x
        this.prevTargetY = point.y
        this.lastRetargetAt = now
        return true
      }
      this.lastRetargetAt = now
      this.prevTargetX = point.x
      this.prevTargetY = point.y
    }

    this.targetX = point.x
    this.targetY = point.y
    this.targetH = point.h
    this.charWidth = point.charWidth

    if (instant) {
      this.snap(point)
      return true
    }
    return false
  }

  /** Refresh target coords during rAF without retarget/snap policy. */
  followTarget(point: MeasuredPoint): void {
    this.targetX = point.x
    this.targetY = point.y
    this.targetH = point.h
    this.charWidth = point.charWidth
  }

  step(dt: number): boolean {
    const dx = this.targetX - this.x
    const dy = this.targetY - this.y
    const dh = this.targetH - this.h

    if (
      Math.abs(dx) < ANIM_EPSILON &&
      Math.abs(dy) < ANIM_EPSILON &&
      Math.abs(dh) < ANIM_EPSILON
    ) {
      this.x = this.targetX
      this.y = this.targetY
      this.h = this.targetH
      this.lastAnimY0 = this.y
      this.lastAnimY1 = this.y + this.h
      return false
    }

    const shortHop =
      Math.abs(dx) <= this.charWidth * 2.001 && Math.abs(dy) <= this.targetH * 0.001
    const speed = shortHop ? CURSOR_SPEED * CURSOR_SHORT_HOP_MULT : CURSOR_SPEED

    let nextX = expSmooth(this.x, this.targetX, speed, dt)
    let nextY = expSmooth(this.y, this.targetY, speed, dt)
    let nextH = expSmooth(this.h, this.targetH, speed, dt)

    const yChange = this.targetY - this.lastAnimY0
    if (Math.abs(yChange) > 0.001) {
      nextH = this.targetH * (1 + Math.abs(yChange) / 60)
    }

    const nextY1 = nextY + nextH
    if (this.targetY > this.lastAnimY0) {
      if (nextY < this.lastAnimY0) nextY = this.lastAnimY0
    } else if (this.targetY < this.lastAnimY0) {
      if (nextY1 > this.lastAnimY1) nextH = this.lastAnimY1 - nextY
    }

    this.x = nextX
    this.y = nextY
    this.h = nextH
    this.lastAnimY0 = nextY
    this.lastAnimY1 = nextY + nextH
    return true
  }
}

function measurePoint(view: EditorView, pos: number): MeasuredPoint | null {
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

class BracketCursorPlugin {
  private layer: HTMLDivElement
  private groups: HTMLDivElement[] = []
  private anims = new Map<string, CursorEndpointAnim>()
  private renderPlan: RenderItem[] = []
  private focusOpacity = 1
  private visible = true
  private rafId: number | null = null
  private lastFrameTime = 0
  private instantNext = true
  private reducedMotion: boolean

  constructor(private view: EditorView) {
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    this.layer = document.createElement("div")
    this.layer.className = "jet-cursor-layer"
    view.scrollDOM.appendChild(this.layer)
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
        this.visible = false
        this.layer.style.opacity = "0"
        this.stopRaf()
        return
      }
      this.visible = true
      // Only snap on doc edits or reduced-motion; scroll/geometry must not cancel tween
      this.instantNext = this.reducedMotion || update.docChanged
      this.scheduleMeasure()
    }
  }

  private scheduleMeasure() {
    this.view.requestMeasure({
      read: view => measureCursors(view),
      write: result => {
        if (!result || !result.visible) {
          this.layer.style.opacity = "0"
          return
        }

        this.focusOpacity = result.focusOpacity
        this.renderPlan = result.renderPlan
        this.layer.style.opacity = "1"

        const activeKeys = new Set<string>()

        let snapped = false
        for (const { key, point } of result.endpoints) {
          activeKeys.add(key)
          let anim = this.anims.get(key)
          if (!anim) {
            anim = new CursorEndpointAnim()
            anim.snap(point)
            this.anims.set(key, anim)
            snapped = true
          } else if (anim.setTarget(point, this.instantNext)) {
            snapped = true
          }
        }

        for (const key of this.anims.keys()) {
          if (!activeKeys.has(key)) this.anims.delete(key)
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

        if (!shouldAnimate) {
          this.stopRaf()
        } else {
          this.startRaf()
        }
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

    if (active) {
      this.rafId = requestAnimationFrame(t => this.tick(t))
    } else {
      this.rafId = null
    }
  }

  private render() {
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
    this.layer.remove()
    this.anims.clear()
  }
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
