import assert from "node:assert/strict"
import test from "node:test"
import { buildModelPickerSearchText, scoreModelPickerSearch } from "./modelPickerSearch.js"

test("buildModelPickerSearchText joins provider + model fields", () => {
  assert.equal(
    buildModelPickerSearchText({
      driverKind: "codex",
      providerDisplayName: "Codex Personal",
      name: "GPT-5",
      shortName: "5",
    }),
    "gpt-5 5 codex codex personal",
  )
})

test("scoreModelPickerSearch matches display name and boosts favorites", () => {
  const model = {
    driverKind: "claude",
    providerDisplayName: "Claude",
    name: "Sonnet",
    shortName: "Sonnet",
  }
  const plain = scoreModelPickerSearch(model, "son")
  const favorite = scoreModelPickerSearch({ ...model, isFavorite: true }, "son")
  assert.notEqual(plain, null)
  assert.notEqual(favorite, null)
  assert.ok((favorite as number) < (plain as number))
})

test("scoreModelPickerSearch returns null when no token matches", () => {
  assert.equal(
    scoreModelPickerSearch(
      {
        driverKind: "cursor",
        providerDisplayName: "Cursor",
        name: "Composer",
      },
      "zzzz-no-match",
    ),
    null,
  )
})
