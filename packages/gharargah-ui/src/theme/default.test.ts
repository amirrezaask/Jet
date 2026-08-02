import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  bundledThemeList,
  bundledThemes,
  defaultThemeId,
  defaultThemeIdForScheme,
  getThemeById,
  siblingThemeForScheme,
  themePreviewSwatches,
} from "./default.js"

type Rgb = readonly [number, number, number]

function oklchToSrgb(value: string): Rgb {
  const match = value.match(
    /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+%?)?\)$/,
  )
  assert.ok(match, `expected an opaque oklch color, received ${value}`)
  const lightness = Number(match[1])
  const chroma = Number(match[2])
  const hue = Number(match[3]) * (Math.PI / 180)
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ] as const
  return linear.map(channel => {
    const encoded =
      channel <= 0.0031308
        ? 12.92 * channel
        : 1.055 * channel ** (1 / 2.4) - 0.055
    return Math.max(0, Math.min(1, encoded))
  }) as unknown as Rgb
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (value: string) =>
    oklchToSrgb(value)
      .map(channel =>
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      )
      .reduce(
        (sum, channel, index) =>
          sum + channel * ([0.2126, 0.7152, 0.0722] as const)[index]!,
        0,
      )
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  )
}

const themeIds = ["default-dark", "default-light"]

describe("bundled Gharargah themes", () => {
  it("registers Default dark/light only", () => {
    assert.equal(defaultThemeId, "default-dark")
    assert.deepEqual(
      bundledThemeList.map(theme => theme.id),
      themeIds,
    )
    assert.equal(Object.keys(bundledThemes).length, 2)
  })

  it("falls back to Default Dark for missing or invalid theme ids", () => {
    assert.equal(getThemeById(null).id, "default-dark")
    assert.equal(getThemeById("missing").id, "default-dark")
    assert.equal(getThemeById("glass-blue").id, "default-dark")
    assert.equal(getThemeById("ayu-dark").id, "default-dark")
  })

  it("maps color schemes to matching Default themes", () => {
    assert.equal(defaultThemeIdForScheme("dark"), "default-dark")
    assert.equal(defaultThemeIdForScheme("light"), "default-light")
    assert.equal(siblingThemeForScheme("default-dark", "light").id, "default-light")
    assert.equal(siblingThemeForScheme("default-light", "dark").id, "default-dark")
  })

  it("provides shell, editor, terminal, source, and swatch metadata for every theme", () => {
    for (const theme of bundledThemeList) {
      assert.ok(theme.scheme === "dark" || theme.scheme === "light")
      assert.equal(theme.family, "Default")
      assert.ok(theme.sourceUrl?.startsWith("https://"))
      assert.ok(theme.colors.bg)
      assert.ok(theme.colors.panel)
      assert.ok(theme.highlights.keyword)
      assert.ok(theme.highlights.string)
      assert.ok(theme.terminalAnsi?.red)
      assert.ok(theme.terminalAnsi?.brightWhite)
      assert.ok(themePreviewSwatches(theme).length >= 4)
      assert.ok(theme.shadcn)
    }
  })

  it("keeps both Default palettes readable and interaction colors consistent", () => {
    for (const themeId of ["default-dark", "default-light"]) {
      const tokens = getThemeById(themeId).shadcn
      assert.ok(tokens)

      const textPairs = [
        ["foreground", tokens.foreground, tokens.background, 7],
        ["muted", tokens.mutedForeground, tokens.background, 4.5],
        ["primary", tokens.primaryForeground, tokens.primary, 4.5],
        ["accent", tokens.accentForeground, tokens.accent, 4.5],
        [
          "destructive",
          tokens.destructiveForeground,
          tokens.destructive,
          4.5,
        ],
        ["sidebar", tokens.sidebarForeground, tokens.sidebar, 7],
        [
          "sidebar primary",
          tokens.sidebarPrimaryForeground,
          tokens.sidebarPrimary,
          4.5,
        ],
        [
          "sidebar accent",
          tokens.sidebarAccentForeground,
          tokens.sidebarAccent,
          4.5,
        ],
      ] as const
      for (const [name, foreground, background, minimum] of textPairs) {
        assert.ok(
          contrastRatio(foreground, background) >= minimum,
          `${themeId} ${name} contrast must be at least ${minimum}:1`,
        )
      }

      assert.ok(
        contrastRatio(tokens.ring, tokens.background) >= 3,
        `${themeId} focus ring must have at least 3:1 contrast`,
      )
      assert.ok(
        contrastRatio(tokens.input, tokens.background) >= 3,
        `${themeId} input boundary must have at least 3:1 contrast`,
      )
      assert.equal(tokens.primary, tokens.sidebarPrimary)
      assert.equal(tokens.ring, tokens.primary)
      assert.equal(tokens.sidebarRing, tokens.primary)
      assert.notEqual(tokens.card, tokens.background)
    }
  })
})
