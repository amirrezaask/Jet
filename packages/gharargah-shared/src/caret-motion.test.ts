import assert from "node:assert/strict"
import test from "node:test"
import {
  CaretGhostCompositor,
  GHOST_DECAY_MS,
  GHOST_EASING,
} from "./caret-motion.js"

type FakeAnimation = { cancelled: boolean; cancel(): void }

function fakeElement() {
  const animations: Array<{
    frames: Record<string, string | number>[]
    options: { duration: number; easing?: string; fill?: string }
    animation: FakeAnimation
  }> = []
  return {
    style: {
      transform: "",
      width: "",
      height: "",
      opacity: "",
      borderRadius: "",
      background: "",
      willChange: "",
    },
    animations,
    animate(
      frames: Record<string, string | number>[],
      options: { duration: number; easing?: string; fill?: string },
    ) {
      const animation: FakeAnimation = {
        cancelled: false,
        cancel() {
          animation.cancelled = true
        },
      }
      animations.push({ frames, options, animation })
      return animation
    },
  }
}

test("CaretGhostCompositor reuses a bounded pool and cancels reused animations", () => {
  const first = fakeElement()
  const second = fakeElement()
  const trail = new CaretGhostCompositor([first, second])

  trail.push({ x: 4, y: 8, width: 2, height: 18 })
  trail.push({ x: 12, y: 8, width: 2, height: 18 })
  trail.push({ x: 20, y: 8, width: 2, height: 18 })

  assert.equal(first.animations.length, 2)
  assert.equal(first.animations[0]!.animation.cancelled, true)
  assert.equal(first.style.transform, "translate3d(20px, 8px, 0)")
  assert.equal(first.style.willChange, "transform, opacity")
  assert.deepEqual(first.animations[1]!.frames, [{ opacity: 0.28 }, { opacity: 0 }])
  assert.equal(first.animations[1]!.options.duration, GHOST_DECAY_MS)
  assert.equal(first.animations[1]!.options.easing, GHOST_EASING)

  trail.dispose()
  assert.equal(first.animations[1]!.animation.cancelled, true)
  assert.equal(second.animations[0]!.animation.cancelled, true)
  assert.equal(first.style.opacity, "0")
  assert.equal(second.style.opacity, "0")
})
