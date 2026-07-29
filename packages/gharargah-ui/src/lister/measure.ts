export function resolveCssLengthPx(
  raw: string,
  fontSize: number,
  fallbackRem: number,
): number {
  if (raw.endsWith("rem")) {
    const rem = parseFloat(raw)
    if (Number.isFinite(rem) && rem > 0) return rem * fontSize
  } else {
    const px = parseFloat(raw)
    if (Number.isFinite(px) && px > 0) return px
  }
  return fontSize * fallbackRem
}

export function readCssLengthPx(name: string, fallbackRem: number): number {
  if (typeof document === "undefined") return fallbackRem * 13
  const root = document.documentElement
  const fontSize = parseFloat(getComputedStyle(root).fontSize) || 13
  const raw = getComputedStyle(root).getPropertyValue(name).trim()
  return resolveCssLengthPx(raw, fontSize, fallbackRem)
}

export type PaletteRowLayout = "single" | "detail"

export function readPaletteRowHeight(layout: PaletteRowLayout): number {
  return layout === "detail"
    ? readCssLengthPx("--gharargah-palette-detail-row-height", 3.5)
    : readCssLengthPx("--gharargah-palette-row-height", 2.5)
}

export function readTreeRowHeights(): { project: number; child: number } {
  return {
    project: readCssLengthPx("--gharargah-project-row-height", 1.75),
    child: readCssLengthPx("--gharargah-row-height", 1.5),
  }
}

export function readLocationRowHeight(): number {
  return readCssLengthPx("--gharargah-location-row-height", 2.5)
}
