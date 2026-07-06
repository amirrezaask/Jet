export const CURSOR_SPEED = 24
export const CURSOR_SHORT_HOP_MULT = 2.5
export const CURSOR_RETARGET_WINDOW = 0.12
export const ANIM_EPSILON = 0.5
export const GHOST_MAX = 5
export const GHOST_DECAY_MS = 120

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
    this.ghosts.unshift({ x, y, h, opacity: 0.45, bornAt: now })
    if (this.ghosts.length > GHOST_MAX) this.ghosts.length = GHOST_MAX
  }

  tick(now = performance.now()): CaretGhost[] {
    this.ghosts = this.ghosts.filter(g => {
      const age = now - g.bornAt
      g.opacity = 0.45 * (1 - age / GHOST_DECAY_MS)
      return age < GHOST_DECAY_MS && g.opacity > 0.02
    })
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
