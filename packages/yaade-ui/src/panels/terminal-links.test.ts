import assert from "node:assert/strict"
import test from "node:test"
import { scanTerminalPathLinks } from "./terminal-links.js"

test("parses file URI line and column suffixes outside the path", () => {
  assert.deepEqual(scanTerminalPathLinks("file:///tmp/project/main.ts:12:3"), [
    {
      startIndex: 0,
      length: 32,
      path: "/tmp/project/main.ts",
      line: 12,
      column: 3,
    },
  ])
})

test("parses relative and absolute source locations", () => {
  const links = scanTerminalPathLinks("at src/main.ts:4:2 from /tmp/other.ts:9")
  assert.deepEqual(
    links.map(link => ({ path: link.path, line: link.line, column: link.column })),
    [
      { path: "src/main.ts", line: 4, column: 2 },
      { path: "/tmp/other.ts", line: 9, column: undefined },
    ],
  )
})
