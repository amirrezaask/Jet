import { expSmooth, prefersReducedMotion } from "@jet/shared"

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
  durationMs?: number
  /** New panels grow from this rect (panelId -> spawn rect). */
  spawnFrom?: Map<number, PanelRect>
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

/**
 * FLIP-style morph from `before` rects to current DOM layout.
 * Resolves when animation completes or reduced-motion skips.
 */
export function animateLayoutMorph(
  before: Map<number, PanelRect>,
  opts: LayoutMorphOptions = {},
): Promise<void> {
  if (prefersReducedMotion() || before.size === 0) return Promise.resolve()

  const durationMs = opts.durationMs ?? 220
  const spawnFrom = opts.spawnFrom ?? new Map<number, PanelRect>()
  const clones: { el: HTMLElement; from: PanelRect; to: PanelRect }[] = []

  for (const el of document.querySelectorAll<HTMLElement>("[data-jet-panel-leaf]")) {
    const id = Number(el.dataset.jetPanelLeaf)
    if (!Number.isFinite(id)) continue
    const toRect = el.getBoundingClientRect()
    const to: PanelRect = { x: toRect.left, y: toRect.top, w: toRect.width, h: toRect.height }
    const from = spawnFrom.get(id) ?? before.get(id) ?? to
    if (
      Math.abs(from.x - to.x) < 0.5 &&
      Math.abs(from.y - to.y) < 0.5 &&
      Math.abs(from.w - to.w) < 0.5 &&
      Math.abs(from.h - to.h) < 0.5
    ) {
      continue
    }
    const shell = clonePanelShell(el)
    shell.style.left = `${from.x}px`
    shell.style.top = `${from.y}px`
    shell.style.width = `${from.w}px`
    shell.style.height = `${from.h}px`
    shell.style.opacity = spawnFrom.has(id) ? "0.85" : "0.92"
    document.body.appendChild(shell)
    clones.push({ el: shell, from, to })
  }

  if (clones.length === 0) return Promise.resolve()

  return new Promise(resolve => {
    const start = performance.now()
    const speed = 18

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      let active = false

      for (const { el, from, to } of clones) {
        const x = expSmooth(from.x, to.x, speed, 1 / 60)
        const y = expSmooth(from.y, to.y, speed, 1 / 60)
        const w = expSmooth(from.w, to.w, speed, 1 / 60)
        const h = expSmooth(from.h, to.h, speed, 1 / 60)

        from.x = x
        from.y = y
        from.w = w
        from.h = h

        el.style.left = `${x}px`
        el.style.top = `${y}px`
        el.style.width = `${w}px`
        el.style.height = `${h}px`
        el.style.opacity = String(0.92 * (1 - t * 0.15))

        if (t < 1) active = true
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
