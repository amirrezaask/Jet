export const CURSOR_SPEED = 24
export const CURSOR_SHORT_HOP_MULT = 2.5
export const CURSOR_RETARGET_WINDOW = 0.12
export const ANIM_EPSILON = 0.5
export const GHOST_MAX = 5
export const GHOST_DECAY_MS = 200
export const GHOST_INITIAL_OPACITY = 0.28
export const GHOST_DECAY_CURVE = 1.6
export const GHOST_EASING = "cubic-bezier(0.23, 1, 0.32, 1)"

export type CaretPoint = {
  x: number
  y: number
  h: number
  charWidth: number
}

export type CaretGhost = {
  x: number
  y: number
  h: number
  opacity: number
  bornAt: number
}

export type CaretGhostVisual = {
  x: number
  y: number
  width: number
  height: number
  opacity?: number
  borderRadius?: string
  background?: string
}

/** Local WAAPI shapes — avoid DOM lib so Node packages can typecheck shared. */
type CaretKeyframe = Record<string, string | number>
type CaretKeyframeAnimationOptions = {
  duration: number
  easing?: string
  fill?: "none" | "forwards" | "backwards" | "both" | "auto"
}

type CaretGhostElement = {
  style: {
    transform: string
    width: string
    height: string
    opacity: string
    borderRadius: string
    background: string
    willChange: string
  }
  animate(
    frames: CaretKeyframe[],
    options: CaretKeyframeAnimationOptions,
  ): { cancel(): void }
}

/**
 * Reuses a fixed set of ghost nodes and lets the compositor own their fade.
 * Callers only write geometry when a caret moves; there is no per-frame JS.
 */
export class CaretGhostCompositor {
  private readonly animations: Array<{ cancel(): void } | null>
  private next = 0

  constructor(private readonly elements: readonly CaretGhostElement[]) {
    this.animations = elements.map(element => {
      element.style.willChange = "transform, opacity"
      element.style.opacity = "0"
      return null
    })
  }

  push(visual: CaretGhostVisual): void {
    if (this.elements.length === 0) return
    const index = this.next
    this.next = (this.next + 1) % this.elements.length
    const element = this.elements[index]!
    this.animations[index]?.cancel()
    element.style.transform = `translate3d(${visual.x}px, ${visual.y}px, 0)`
    element.style.width = `${Math.max(1, visual.width)}px`
    element.style.height = `${Math.max(1, visual.height)}px`
    element.style.borderRadius = visual.borderRadius ?? "1px"
    element.style.background =
      visual.background ?? "var(--gharargah-cursor-color, var(--gharargah-accent))"
    const opacity = visual.opacity ?? GHOST_INITIAL_OPACITY
    element.style.opacity = String(opacity)
    this.animations[index] = element.animate(
      [{ opacity }, { opacity: 0 }],
      {
        duration: GHOST_DECAY_MS,
        easing: GHOST_EASING,
        fill: "forwards",
      },
    )
  }

  clear(): void {
    for (let index = 0; index < this.elements.length; index++) {
      this.animations[index]?.cancel()
      this.animations[index] = null
      this.elements[index]!.style.opacity = "0"
    }
    this.next = 0
  }

  dispose(): void {
    this.clear()
  }
}

export function expSmooth(current: number, target: number, speed: number, dt: number): number {
  if (speed <= 0 || dt <= 0) return target
  return current + (target - current) * (1 - Math.exp(-speed * dt))
}

export class CaretEndpointAnim {
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

  snap(point: CaretPoint): void {
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

  setTarget(point: CaretPoint, instant: boolean): boolean {
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

  followTarget(point: CaretPoint): void {
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

export class CaretGhostBuffer {
  private ghosts: CaretGhost[] = []

  push(x: number, y: number, h: number, now = performance.now()): void {
    this.ghosts.unshift({ x, y, h, opacity: GHOST_INITIAL_OPACITY, bornAt: now })
    if (this.ghosts.length > GHOST_MAX) this.ghosts.length = GHOST_MAX
  }

  tick(now = performance.now()): CaretGhost[] {
    let write = 0
    for (let read = 0; read < this.ghosts.length; read++) {
      const g = this.ghosts[read]!
      const age = now - g.bornAt
      const remaining = 1 - age / GHOST_DECAY_MS
      g.opacity =
        remaining > 0 ? GHOST_INITIAL_OPACITY * Math.pow(remaining, GHOST_DECAY_CURVE) : 0
      if (age < GHOST_DECAY_MS && g.opacity > 0.02) {
        this.ghosts[write++] = g
      }
    }
    this.ghosts.length = write
    return this.ghosts
  }

  clear(): void {
    this.ghosts = []
  }
}

/** True when a single-cursor head advanced by one char on the same line (typing hop). */
export function isSingleCharTypingHop(
  prevHead: number,
  nextHead: number,
  prevLine: (pos: number) => number,
  nextLine: (pos: number) => number,
): boolean {
  if (nextHead !== prevHead + 1) return false
  return prevLine(prevHead) === nextLine(nextHead)
}
