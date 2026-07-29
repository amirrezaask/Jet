import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { defaultWorkspaceConfiguration } from "./client-configuration.js"

describe("defaultWorkspaceConfiguration", () => {
  it("returns one settings object for every server request", () => {
    assert.deepEqual(
      defaultWorkspaceConfiguration({
        items: [
          { scopeUri: "file:///workspace", section: "gopls" },
          { scopeUri: "file:///workspace", section: "typescript" },
        ],
      }),
      [{}, {}],
    )
  })

  it("preserves an empty request", () => {
    assert.deepEqual(defaultWorkspaceConfiguration({ items: [] }), [])
  })
})
