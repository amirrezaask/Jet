import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  isGenericAgentSessionTitle,
  shouldApplyAgentSessionTitle,
  titleFromUserPrompt,
} from "./agent-session-title.js"

describe("agent-session-title", () => {
  it("treats driver labels and Cursor Agent as generic", () => {
    assert.equal(isGenericAgentSessionTitle("Cursor", "cursor"), true)
    assert.equal(isGenericAgentSessionTitle("Cursor Agent", "cursor"), true)
    assert.equal(isGenericAgentSessionTitle("Codex", "codex"), true)
    assert.equal(isGenericAgentSessionTitle("", "cursor"), true)
    assert.equal(
      isGenericAgentSessionTitle("Fix the sidebar title", "cursor"),
      false,
    )
  })

  it("only upgrades generic titles with a concrete next title", () => {
    assert.equal(
      shouldApplyAgentSessionTitle("Fix auth", "Cursor", "cursor"),
      true,
    )
    assert.equal(
      shouldApplyAgentSessionTitle("Cursor Agent", "Cursor", "cursor"),
      false,
    )
    assert.equal(
      shouldApplyAgentSessionTitle("New name", "Fix auth", "cursor"),
      false,
    )
  })

  it("collapses whitespace and truncates prompts", () => {
    assert.equal(
      titleFromUserPrompt("  Fix\nthe\n  sidebar  "),
      "Fix the sidebar",
    )
    const long = "x".repeat(100)
    const titled = titleFromUserPrompt(long, 20)
    assert.equal(titled.endsWith("…"), true)
    assert.ok(titled.length <= 20)
  })
})
