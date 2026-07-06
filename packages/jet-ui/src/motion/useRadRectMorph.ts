import { useEffect, useRef, useState } from "react"
import {
  JET_RATE_MENU,
  JET_LAYOUT_EPSILON,
  prefersReducedMotion,
  radAnimationRate,
  radLerp,
} from "@jet/shared"

export type RadRect = { x: number; y: number; w: number; h: number }

function centerSeed(panelW: number, panelH: number): RadRect {
  return { x: panelW / 2, y: panelH / 2, w: 0, h: 0 }
}

function rectsEqual(a: RadRect, b: RadRect, eps = JET_LAYOUT_EPSILON): boolean {
  return (
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.w - b.w) < eps &&
    Math.abs(a.h - b.h) < eps
  )
}

/**
 * Exponential rect morph (RAD menu rate) from panel center to `target`.
 * Returns null when inactive.
 */
export function useRadRectMorph(
  target: RadRect | null,
  panelSize: { w: number; h: number },
  halfLifeN = JET_RATE_MENU,
): RadRect | null {
  const [display, setDisplay] = useState<RadRect | null>(null)
  const currentRef = useRef<RadRect | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef(0)

  useEffect(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    if (!target || panelSize.w <= 0 || panelSize.h <= 0) {
      currentRef.current = null
      setDisplay(null)
      return
    }

    if (prefersReducedMotion()) {
      currentRef.current = target
      setDisplay(target)
      return
    }

    const from = centerSeed(panelSize.w, panelSize.h)
    currentRef.current = { ...from }
    setDisplay({ ...from })

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastFrameRef.current) / 1000)
      lastFrameRef.current = now
      const rate = radAnimationRate(halfLifeN, dt)
      const cur = currentRef.current!
      const next: RadRect = {
        x: radLerp(cur.x, target.x, rate),
        y: radLerp(cur.y, target.y, rate),
        w: radLerp(cur.w, target.w, rate),
        h: radLerp(cur.h, target.h, rate),
      }
      currentRef.current = next
      setDisplay({ ...next })

      if (rectsEqual(next, target)) {
        currentRef.current = target
        setDisplay(target)
        rafRef.current = null
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    lastFrameRef.current = performance.now()
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [target, panelSize.w, panelSize.h, halfLifeN])

  return display
}
