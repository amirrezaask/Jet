import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { cssToHex, oklchToSrgb } from "./css-color.js"

describe("oklchToSrgb", () => {
  it("converts neutral gray L≈0.7", () => {
    const [r, g, b] = oklchToSrgb(0.7, 0, 0)
    assert.equal(r, g)
    assert.equal(g, b)
    assert.ok(r > 140 && r < 200)
  })

  it("converts saturated keyword red-ish", () => {
    const [r, g, b] = oklchToSrgb(0.704, 0.191, 22.216)
    assert.ok(r > g)
    assert.ok(r > b)
    assert.ok(r > 150)
  })
})

describe("cssToHex", () => {
  it("passes through hex", () => {
    assert.equal(cssToHex("#aabbcc"), "#aabbcc")
    assert.equal(cssToHex("#abc"), "#aabbcc")
  })

  it("parses oklch without DOM conversion", () => {
    const hex = cssToHex("oklch(0.704 0.191 22.216)")
    assert.ok(hex)
    assert.match(hex!, /^#[0-9a-f]{6}$/i)
    const green = cssToHex("oklch(0.696 0.17 162.48)")
    assert.notEqual(hex, green)
  })

  it("parses hsl", () => {
    assert.equal(cssToHex("hsl(0, 100%, 50%)"), "#ff0000")
  })
})
