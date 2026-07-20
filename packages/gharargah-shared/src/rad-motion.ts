/** RAD half-life N factors — rate = 1 - pow(2, (-N * dt)). */
export const GHARARGAH_RATE_HOT = 60
export const GHARARGAH_RATE_MENU = 70
export const GHARARGAH_RATE_SLOW_MENU = 50
export const GHARARGAH_RATE_SCROLL = 60
export const GHARARGAH_RATE_ENTITY = 30
export const GHARARGAH_RATE_THEME = 30

export const GHARARGAH_ANIM_EPSILON = 0.005
export const GHARARGAH_LAYOUT_EPSILON = 0.5

/** Per-frame exponential rate from half-life N and delta time (seconds). */
export function radAnimationRate(halfLifeN: number, dt: number): number {
  if (halfLifeN <= 0 || dt <= 0) return 1
  return 1 - Math.pow(2, -halfLifeN * dt)
}

/** Single-step RAD lerp: current += rate * (target - current). */
export function radLerp(current: number, target: number, rate: number): number {
  if (rate >= 1) return target
  if (rate <= 0) return current
  return current + rate * (target - current)
}

/** Step toward target; returns true while still animating. */
export function radStepToward(
  current: number,
  target: number,
  halfLifeN: number,
  dt: number,
  epsilon = GHARARGAH_ANIM_EPSILON,
): { value: number; active: boolean } {
  const rate = radAnimationRate(halfLifeN, dt)
  const next = radLerp(current, target, rate)
  const active = Math.abs(target - next) > epsilon
  return { value: active ? next : target, active }
}
