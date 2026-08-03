import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  distinctSessionHeaderLabel,
  formatSessionHeaderTitle,
  normalizeSessionHeaderLabel,
  sessionHeaderLabelsMatch,
} from "./session-header-labels.js"

describe("session header labels", () => {
  it("normalizes comparison-only differences", () => {
    assert.equal(
      normalizeSessionHeaderLabel("  Ｓample\u2011Workspace  "),
      "sample-workspace",
    )
    assert.equal(
      sessionHeaderLabelsMatch("Sample   Workspace", " sample workspace "),
      true,
    )
    assert.equal(sessionHeaderLabelsMatch("", "   "), false)
  })

  it("deduplicates a repeated project and context label", () => {
    assert.equal(
      formatSessionHeaderTitle("sample-workspace", " sample-workspace "),
      "sample-workspace",
    )
    assert.equal(
      formatSessionHeaderTitle("Sample Workspace", "sample   workspace"),
      "Sample Workspace",
    )
  })

  it("collapses cwd/OSC path titles that end with the project name", () => {
    assert.equal(
      formatSessionHeaderTitle(
        "sample-workspace",
        "/var/folders/xx/T/j/sample-workspace",
      ),
      "sample-workspace",
    )
    assert.equal(
      formatSessionHeaderTitle(
        "sample-workspace",
        "/v/f/l/4/T/j/sample-workspace",
      ),
      "sample-workspace",
    )
  })

  it("preserves context that adds information", () => {
    assert.equal(
      formatSessionHeaderTitle("sample-workspace", "index.ts"),
      "sample-workspace / index.ts",
    )
    assert.equal(
      formatSessionHeaderTitle("sample-workspace", "Git"),
      "sample-workspace / Git",
    )
    assert.equal(
      formatSessionHeaderTitle("sample-workspace", "Run API"),
      "sample-workspace / Run API",
    )
  })

  it("removes only redundant secondary metadata", () => {
    assert.equal(
      distinctSessionHeaderLabel("sample-workspace", "SAMPLE-WORKSPACE"),
      null,
    )
    assert.equal(
      distinctSessionHeaderLabel("Fix terminal resize", "sample-workspace"),
      "sample-workspace",
    )
  })
})
