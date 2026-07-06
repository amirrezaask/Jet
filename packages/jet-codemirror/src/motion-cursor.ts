import { EditorView, ViewPlugin, drawSelection, type ViewUpdate } from "@codemirror/view"
import type { Extension } from "@codemirror/state"
import {
  ANIM_EPSILON,
  CaretEndpointAnim,
  CaretGhostBuffer,
  onReducedMotionChange,
  prefersReducedMotion,
  type CaretPoint,
} from "@jet/shared"

const MAIN_THICKNESS = 4
const ANCHOR_THICKNESS = 3

type BracketShape = "open" | "close"

type RenderItem = {
  key: string
  shape: BracketShape
  thickness: number
  opacity: number
  ghost?: boolean
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

function createBracketGroup(ghost = false): HTMLDivElement {
  const group = document.createElement("div")
  group.className = ghost ? "jet-bracket-group jet-bracket-ghost" : "jet-bracket-group"
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
  private ghostLayer: HTMLDivElement
  private groups: HTMLDivElement[] = []
  private ghostGroups: HTMLDivElement[] = []
  private anims = new Map<string, CaretEndpointAnim>()
  private ghosts = new Map<string, CaretGhostBuffer>()
  private renderPlan: RenderItem[] = []
  private ghostRenderPlan: RenderItem[] = []
  private focusOpacity = 1
  private visible = true
  private rafId: number | null = null
  private lastFrameTime = 0
  private instantNext = true
  private reducedMotion: boolean
  private unsubMotion: (() => void) | null = null

  constructor(private view: EditorView) {
    this.reducedMotion = prefersReducedMotion()
    this.ghostLayer = document.createElement("div")
    this.ghostLayer.className = "jet-cursor-ghost-layer"
    this.layer = document.createElement("div")
    this.layer.className = "jet-cursor-layer"
    view.scrollDOM.appendChild(this.ghostLayer)
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
        this.visible = false
        this.layer.style.opacity = "0"
        this.ghostLayer.style.opacity = "0"
        this.stopRaf()
        return
      }
      this.visible = true
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
          this.ghostLayer.style.opacity = "0"
          return
        }

        this.focusOpacity = result.focusOpacity
        this.renderPlan = result.renderPlan
        this.layer.style.opacity = "1"
        this.ghostLayer.style.opacity = "1"

        const activeKeys = new Set<string>()
        let snapped = false

        for (const { key, point } of result.endpoints) {
          activeKeys.add(key)
          let anim = this.anims.get(key)
          if (!anim) {
            anim = new CaretEndpointAnim()
            anim.snap(point)
            this.anims.set(key, anim)
            if (!this.ghosts.has(key)) this.ghosts.set(key, new CaretGhostBuffer())
            snapped = true
          } else {
            if (!this.instantNext && !this.reducedMotion) {
              const dx = point.x - anim.x
              const dy = point.y - anim.y
              if (dx * dx + dy * dy > 0.5) {
                this.ghosts.get(key)?.push(anim.x, anim.y, anim.h)
              }
            }
            if (anim.setTarget(point, this.instantNext)) snapped = true
          }
        }

        for (const key of this.anims.keys()) {
          if (!activeKeys.has(key)) {
            this.anims.delete(key)
            this.ghosts.delete(key)
          }
        }

        this.buildGhostRenderPlan()
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

  private buildGhostRenderPlan() {
    const plan: RenderItem[] = []
    const now = performance.now()
    for (const [key, buffer] of this.ghosts) {
      for (const g of buffer.tick(now)) {
        plan.push({
          key: `${key}-ghost-${g.bornAt}`,
          shape: "open",
          thickness: MAIN_THICKNESS - 1,
          opacity: g.opacity,
          ghost: true,
        })
      }
    }
    this.ghostRenderPlan = plan
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

    this.buildGhostRenderPlan()
    this.render()

    if (active) this.rafId = requestAnimationFrame(t => this.tick(t))
    else this.rafId = null
  }

  private renderGhostGroups() {
    const ghosts = this.ghostRenderPlan
    const now = performance.now()
    let gi = 0
    for (const [, buffer] of this.ghosts) {
      for (const g of buffer.tick(now)) {
        while (this.ghostGroups.length <= gi) {
          const group = createBracketGroup(true)
          this.ghostGroups.push(group)
          this.ghostLayer.appendChild(group)
        }
        const group = this.ghostGroups[gi]!
        group.style.display = "block"
        layoutBracketGroup(group, g.x, g.y, g.h, "open", MAIN_THICKNESS - 1, g.opacity, this.focusOpacity)
        gi++
      }
    }
    while (this.ghostGroups.length > gi) {
      this.ghostGroups.pop()?.remove()
    }
  }

  private render() {
    this.renderGhostGroups()

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
    this.ghostLayer.remove()
    this.anims.clear()
    this.ghosts.clear()
  }
}

export function motionCursor(): Extension {
  return [
    drawSelection({ cursorBlinkRate: 0 }),
    EditorView.theme({
      ".jet-cursor-ghost-layer": {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
        zIndex: "29",
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
      ".jet-bracket-ghost": {
        filter: "blur(0.3px)",
      },
      ".jet-bracket-part": {
        position: "absolute",
        borderRadius: "1px",
      },
    }),
    ViewPlugin.fromClass(BracketCursorPlugin),
  ]
}
