import { JET_LAYOUT_EPSILON, JET_RATE_SCROLL, radStepToward } from "./rad-motion.js"

export type RadScrollFrameCallback = (time: number) => void
export type RadScrollFrame = (callback: RadScrollFrameCallback) => number

export type RadScrollControllerOptions = {
  read: () => number
  write: (value: number) => void
  max: () => number
  reducedMotion?: () => boolean
  requestFrame?: RadScrollFrame
  cancelFrame?: (id: number) => void
  rate?: number
  epsilon?: number
}

/**
 * Shared RAD-style scalar scroll animation. It owns no DOM and only schedules
 * frames while converging, so CodeMirror and xterm can share the exact curve.
 */
export class RadScrollController {
  private currentValue = 0
  private targetValue = 0
  private frameId: number | null = null
  private lastFrameAt = 0
  private destroyed = false

  constructor(private readonly options: RadScrollControllerOptions) {
    this.currentValue = this.clamp(options.read())
    this.targetValue = this.currentValue
  }

  get current(): number {
    return this.currentValue
  }

  get target(): number {
    return this.targetValue
  }

  get active(): boolean {
    return this.frameId != null
  }

  pushDelta(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0 || this.destroyed) return
    this.setTarget(this.targetValue + delta)
  }

  setTarget(value: number): void {
    if (!Number.isFinite(value) || this.destroyed) return
    this.targetValue = this.clamp(value)
    if (this.options.reducedMotion?.()) {
      this.snap(this.targetValue)
      return
    }
    if (Math.abs(this.targetValue - this.currentValue) <= this.epsilon()) {
      this.snap(this.targetValue)
      return
    }
    this.start()
  }

  /** Synchronize after scrollbar dragging, buffer trimming, or native scroll. */
  sync(value = this.options.read()): void {
    if (!Number.isFinite(value) || this.destroyed) return
    this.cancel()
    this.currentValue = this.clamp(value)
    this.targetValue = this.currentValue
  }

  snap(value = this.targetValue): void {
    if (this.destroyed) return
    this.cancel()
    const next = this.clamp(value)
    this.currentValue = next
    this.targetValue = next
    this.options.write(next)
  }

  cancel(): void {
    if (this.frameId != null) this.cancelFrame()(this.frameId)
    this.frameId = null
    this.lastFrameAt = 0
  }

  destroy(): void {
    this.cancel()
    this.destroyed = true
  }

  private start(): void {
    if (this.frameId != null) return
    this.lastFrameAt = 0
    this.frameId = this.requestFrame()(time => this.tick(time))
  }

  private tick(time: number): void {
    this.frameId = null
    if (this.destroyed) return
    this.targetValue = this.clamp(this.targetValue)
    const dt = this.lastFrameAt === 0 ? 1 / 120 : Math.min(0.05, Math.max(0, (time - this.lastFrameAt) / 1000))
    this.lastFrameAt = time
    const step = radStepToward(
      this.currentValue,
      this.targetValue,
      this.options.rate ?? JET_RATE_SCROLL,
      dt,
      this.epsilon(),
    )
    this.currentValue = this.clamp(step.value)
    this.options.write(this.currentValue)
    if (step.active && !this.options.reducedMotion?.()) {
      this.frameId = this.requestFrame()(next => this.tick(next))
    } else {
      this.currentValue = this.targetValue
      this.options.write(this.currentValue)
      this.lastFrameAt = 0
    }
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(Math.max(0, this.options.max()), value))
  }

  private epsilon(): number {
    return this.options.epsilon ?? JET_LAYOUT_EPSILON
  }

  private requestFrame(): RadScrollFrame {
    if (this.options.requestFrame) return this.options.requestFrame
    return (globalThis as typeof globalThis & {
      requestAnimationFrame(callback: RadScrollFrameCallback): number
    }).requestAnimationFrame
  }

  private cancelFrame(): (id: number) => void {
    if (this.options.cancelFrame) return this.options.cancelFrame
    return (globalThis as typeof globalThis & {
      cancelAnimationFrame(id: number): void
    }).cancelAnimationFrame
  }
}
