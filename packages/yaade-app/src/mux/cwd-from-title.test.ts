import assert from "node:assert/strict"
import test from "node:test"
import { cwdUriFromTerminalTitle } from "./cwd-from-title.js"

test("cwdUriFromTerminalTitle parses absolute and home paths", () => {
  assert.equal(
    cwdUriFromTerminalTitle("/tmp/proj", "/Users/me"),
    "file:///tmp/proj",
  )
  assert.equal(
    cwdUriFromTerminalTitle("~/work", "/Users/me"),
    "file:///Users/me/work",
  )
  assert.equal(
    cwdUriFromTerminalTitle("me@host:~/work", "/Users/me"),
    "file:///Users/me/work",
  )
  assert.equal(cwdUriFromTerminalTitle("nvim", "/Users/me"), null)
  assert.equal(cwdUriFromTerminalTitle("work", "/Users/me"), null)
})
