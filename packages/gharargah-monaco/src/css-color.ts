function toHexByte(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/** OKLCH → sRGB (CSS Color 4 / Björn Ottosson). */
export function oklchToSrgb(
  L: number,
  C: number,
  hDeg: number,
): [number, number, number] {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_
  const rLin = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  const toGamma = (c: number) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055
  return [
    Math.round(clamp01(toGamma(rLin)) * 255),
    Math.round(clamp01(toGamma(gLin)) * 255),
    Math.round(clamp01(toGamma(bLin)) * 255),
  ]
}

function parseOklch(color: string): [number, number, number] | null {
  const match = color
    .trim()
    .match(
      /^oklch\(\s*([0-9.]+%?)\s+([0-9.]+)\s+([0-9.]+)(?:deg)?(?:\s*\/\s*[0-9.%]+)?\s*\)$/i,
    )
  if (!match) return null
  let L = Number(match[1]!.replace("%", ""))
  if (match[1]!.includes("%")) L /= 100
  // Some themes use L in 0–100 without %; treat >1 as percent.
  if (L > 1) L /= 100
  const C = Number(match[2])
  const h = Number(match[3])
  if (![L, C, h].every(Number.isFinite)) return null
  return oklchToSrgb(L, C, h)
}

function parseRgb(color: string): [number, number, number] | null {
  const match = color.match(
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/,
  )
  if (!match) return null
  return [
    Math.round(Number(match[1])),
    Math.round(Number(match[2])),
    Math.round(Number(match[3])),
  ]
}

function parseHsl(color: string): [number, number, number] | null {
  const match = color
    .trim()
    .match(/^hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%/i)
  if (!match) return null
  const h = Number(match[1]) / 360
  const s = Number(match[2]) / 100
  const l = Number(match[3]) / 100
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ]
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${toHexByte(rgb[0])}${toHexByte(rgb[1])}${toHexByte(rgb[2])}`
}

/**
 * Convert CSS color (oklch/hsl/rgb/hex/var) → `#rrggbb`, or `null` if unresolvable.
 * Modern Chromium may leave `getComputedStyle().color` as `oklch(...)` — parse it.
 */
export function cssToHex(color: string): string | null {
  let trimmed = color.trim()
  if (!trimmed) return null

  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed
  if (/^#[0-9a-fA-F]{8}$/.test(trimmed)) return trimmed.slice(0, 7)
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1]!
    const g = trimmed[2]!
    const b = trimmed[3]!
    return `#${r}${r}${g}${g}${b}${b}`
  }

  // Resolve CSS variables once via computed style when possible.
  if (trimmed.startsWith("var(") && typeof document !== "undefined") {
    try {
      const probe = document.createElement("span")
      probe.style.cssText =
        "position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;"
      probe.style.color = trimmed
      document.body.appendChild(probe)
      trimmed = getComputedStyle(probe).color.trim()
      probe.remove()
    } catch {
      return null
    }
  }

  const oklch = parseOklch(trimmed)
  if (oklch) return rgbToHex(oklch)

  const hsl = parseHsl(trimmed)
  if (hsl) return rgbToHex(hsl)

  const rgb = parseRgb(trimmed)
  if (rgb) return rgbToHex(rgb)

  // Last resort: browser may still expand to rgb()/oklch().
  if (typeof document !== "undefined") {
    try {
      const probe = document.createElement("span")
      probe.style.cssText =
        "position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;"
      probe.style.color = trimmed
      document.body.appendChild(probe)
      const computed = getComputedStyle(probe).color.trim()
      probe.remove()
      if (computed && computed !== trimmed) {
        return cssToHex(computed)
      }
      const computedOklch = parseOklch(computed)
      if (computedOklch) return rgbToHex(computedOklch)
      const computedRgb = parseRgb(computed)
      if (computedRgb) return rgbToHex(computedRgb)
    } catch {
      return null
    }
  }

  return null
}

/** Monaco only accepts #rgb / #rrggbb / #rrggbbaa — not oklch()/hsl(). */
export function monacoCssColor(
  color: string,
  alphaHex?: string,
  fallback = "#cccccc",
): string {
  const hex = cssToHex(color) ?? fallback
  if (alphaHex && hex.length === 7) return `${hex}${alphaHex}`
  return hex
}
