import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { readPaletteRowHeight, resolveCssLengthPx } from "./measure.js"

describe("resolveCssLengthPx", () => {
  it("scales semantic rem row heights with the persisted UI font size", () => {
    assert.equal(resolveCssLengthPx("3.5rem", 13, 3.5), 45.5)
    assert.equal(resolveCssLengthPx("3.5rem", 24, 3.5), 84)
  })

  it("keeps explicit CSS pixel contracts and falls back for calc expressions", () => {
    assert.equal(resolveCssLengthPx("48px", 24, 3.5), 48)
    assert.equal(
      resolveCssLengthPx("calc(var(--gharargah-fs-base) * 3.5)", 24, 3.5),
      84,
    )
  })

  it("keeps the single-line palette contract denser than detail rows", () => {
    assert.equal(readPaletteRowHeight("single"), 32.5)
    assert.equal(readPaletteRowHeight("detail"), 45.5)
    assert.equal(resolveCssLengthPx("2.5rem", 10, 2.5), 25)
    assert.equal(resolveCssLengthPx("3.5rem", 10, 3.5), 35)
    assert.equal(resolveCssLengthPx("2.5rem", 24, 2.5), 60)
    assert.equal(resolveCssLengthPx("3.5rem", 24, 3.5), 84)
  })
})
