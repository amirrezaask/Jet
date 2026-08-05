import assert from "node:assert/strict"
import test from "node:test"
import { parseOsc7Cwd } from "./terminal-osc7.js"

test("parseOsc7Cwd extracts file URI paths", () => {
  assert.equal(
    parseOsc7Cwd("\x1b]7;file:///tmp/proj\x07"),
    "/tmp/proj",
  )
  assert.equal(
    parseOsc7Cwd("noise\x1b]7;file://host/Users/me/work\x1b\\more"),
    "/Users/me/work",
  )
  assert.equal(parseOsc7Cwd("no osc here"), null)
})
