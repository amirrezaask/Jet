import {
  JET_RATE_MENU,
  JET_LAYOUT_EPSILON,
  prefersReducedMotion,
  radAnimationRate,
  radLerp,
} from "@jet/shared"

export type PanelRect = { x: number; y: number; w: number; h: number }

export function capturePanelLeafRects(): Map<number, PanelRect> {
  const map = new Map<number, PanelRect>()
  for (const el of document.querySelectorAll<HTMLElement>("[data-jet-panel-leaf]")) {
    const id = Number(el.dataset.jetPanelLeaf)
    if (!Number.isFinite(id)) continue
    const r = el.getBoundingClientRect()
    map.set(id, { x: r.left, y: r.top, w: r.width, h: r.height })
  }
  return map
}

export type LayoutMorphOptions = {
  /** New panels grow from this rect (panelId -> spawn rect). */
  spawnFrom?: Map<number, PanelRect>
  /** RAD half-life N for menu-rate panel morph. */
  halfLifeN?: number
}

function clonePanelShell(from: HTMLElement): HTMLElement {
  const shell = document.createElement("div")
  shell.className =
    "pointer-events-none fixed z-[100] overflow-hidden rounded-sm border border-border/80 bg-background shadow-md"
  shell.style.willChange = "transform, width, height, opacity"
  const inner = from.cloneNode(true) as HTMLElement
  inner.style.pointerEvents = "none"
  inner.style.width = "100%"
  inner.style.height = "100%"
  shell.appendChild(inner)
  return shell
}

function panelRectSettled(current: PanelRect, target: PanelRect): boolean {
  return (
    Math.abs(current.x - target.x) < JET_LAYOUT_EPSILON &&
    Math.abs(current.y - target.y) < JET_LAYOUT_EPSILON &&
    Math.abs(current.w - target.w) < JET_LAYOUT_EPSILON &&
    Math.abs(current.h - target.h) < JET_LAYOUT_EPSILON
  )
}

/**
 * FLIP-style morph from `before` rects to current DOM layout.
 * Uses RAD exponential smoothing at menu rate (N=70).
 */
export function animateLayoutMorph(
  before: Map<number, PanelRect>,
  opts: LayoutMorphOptions = {},
): Promise<void> {
  if (prefersReducedMotion() || before.size === 0) return Promise.resolve()

  const halfLifeN = opts.halfLifeN ?? JET_RATE_MENU
  const spawnFrom = opts.spawnFrom ?? new Map<number, PanelRect>()
  const clones: { el: HTMLElement; current: PanelRect; to: PanelRect; spawn: boolean }[] = []

  for (const el of document.querySelectorAll<HTMLElement>("[data-jet-panel-leaf]")) {
    const id = Number(el.dataset.jetPanelLeaf)
    if (!Number.isFinite(id)) continue
    const toRect = el.getBoundingClientRect()
    const to: PanelRect = { x: toRect.left, y: toRect.top, w: toRect.width, h: toRect.height }
    const fromSeed = spawnFrom.get(id) ?? before.get(id) ?? to
    const from: PanelRect = { ...fromSeed }
    if (panelRectSettled(from, to)) continue

    const shell = clonePanelShell(el)
    shell.style.left = `${from.x}px`
    shell.style.top = `${from.y}px`
    shell.style.width = `${from.w}px`
    shell.style.height = `${from.h}px`
    shell.style.opacity = spawnFrom.has(id) ? "0.85" : "0.92"
    document.body.appendChild(shell)
    clones.push({ el: shell, current: { ...from }, to, spawn: spawnFrom.has(id) })
  }

  if (clones.length === 0) return Promise.resolve()

  return new Promise(resolve => {
    let lastFrame = performance.now()
    let opacityT = 0

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastFrame) / 1000)
      lastFrame = now
      const rate = radAnimationRate(halfLifeN, dt)
      let active = false

      for (const clone of clones) {
        const { current, to } = clone
        current.x = radLerp(current.x, to.x, rate)
        current.y = radLerp(current.y, to.y, rate)
        current.w = radLerp(current.w, to.w, rate)
        current.h = radLerp(current.h, to.h, rate)

        clone.el.style.left = `${current.x}px`
        clone.el.style.top = `${current.y}px`
        clone.el.style.width = `${current.w}px`
        clone.el.style.height = `${current.h}px`

        if (!panelRectSettled(current, to)) active = true
      }

      opacityT = radLerp(opacityT, 1, rate)
      for (const clone of clones) {
        clone.el.style.opacity = String(0.92 * (1 - opacityT * 0.15))
      }

      if (active) {
        requestAnimationFrame(tick)
      } else {
        for (const { el } of clones) el.remove()
        resolve()
      }
    }

    requestAnimationFrame(tick)
  })
}
