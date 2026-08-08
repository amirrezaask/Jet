import assert from "node:assert/strict"
import { test } from "node:test"

import { lspGlobMatches, watchedFileChanges } from "./watched-files.js"

test("matches common LSP globs without crossing path separators", () => {
  assert.equal(lspGlobMatches("**/*.{ts,tsx}", "src/deep/file.ts"), true)
  assert.equal(lspGlobMatches("src/*.ts", "src/file.ts"), true)
  assert.equal(lspGlobMatches("src/*.ts", "src/deep/file.ts"), false)
  assert.equal(lspGlobMatches("**/test?.[jt]s", "src/test1.ts"), true)
})

test("filters create/change/delete events by watcher kind and project-relative glob", () => {
  const options = {
    watchers: [{ globPattern: "**/*.ts", kind: 1 | 4 }],
  }
  assert.deepEqual(watchedFileChanges(
    options,
    "file:///workspace",
    { uri: "file:///workspace/src/file.ts", kind: "created" },
  ), [{ uri: "file:///workspace/src/file.ts", type: 1 }])
  assert.deepEqual(watchedFileChanges(
    options,
    "file:///workspace",
    { uri: "file:///workspace/src/file.ts", kind: "changed" },
  ), [])
  assert.deepEqual(watchedFileChanges(
    options,
    "file:///workspace",
    { uri: "file:///workspace/src/file.ts", kind: "deleted" },
  ), [{ uri: "file:///workspace/src/file.ts", type: 3 }])
  assert.deepEqual(watchedFileChanges(
    options,
    "file:///workspace",
    { uri: "file:///other/file.ts", kind: "created" },
  ), [])
})

test("supports relative-pattern base URIs", () => {
  const options = {
    watchers: [{
      globPattern: { baseUri: "file:///workspace/packages/app", pattern: "src/**/*.tsx" },
    }],
  }
  assert.equal(watchedFileChanges(options, "file:///workspace", {
    uri: "file:///workspace/packages/app/src/panes/Editor.tsx",
    kind: "changed",
  }).length, 1)
  assert.equal(watchedFileChanges(options, "file:///workspace", {
    uri: "file:///workspace/packages/other/src/Editor.tsx",
    kind: "changed",
  }).length, 0)
})
