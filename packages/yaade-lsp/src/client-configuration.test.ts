import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { defaultWorkspaceConfiguration, workspaceConfiguration } from "./client-configuration.js"

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

describe("workspaceConfiguration", () => {
  it("returns the requested sections from effective host settings", () => {
    assert.deepEqual(
      workspaceConfiguration(
        { items: [{ section: "gopls" }, { section: "typescript.preferences" }] },
        { gopls: { analyses: { unusedparams: true } }, typescript: { preferences: { quoteStyle: "single" } } },
      ),
      [
        { analyses: { unusedparams: true } },
        { quoteStyle: "single" },
      ],
    )
  })
})
