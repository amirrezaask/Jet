import assert from "node:assert/strict"
import test from "node:test"
import {
  COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX,
  shouldUseCompactComposerFooter,
  shouldUseCompactComposerPrimaryActions,
} from "./composerFooterLayout.js"

test("compact footer activates below the breakpoint", () => {
  assert.equal(shouldUseCompactComposerFooter(null), false)
  assert.equal(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX), false)
  assert.equal(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX - 1), true)
})

test("primary actions stay expanded unless wide actions need room", () => {
  assert.equal(shouldUseCompactComposerPrimaryActions(400), false)
  assert.equal(shouldUseCompactComposerPrimaryActions(400, { hasWideActions: true }), true)
  assert.equal(shouldUseCompactComposerPrimaryActions(900, { hasWideActions: true }), false)
})
