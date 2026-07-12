export function readCssLengthPx(name: string, fallbackRem: number): number {
  if (typeof document === "undefined") return fallbackRem * 13
  const root = document.documentElement
  const fontSize = parseFloat(getComputedStyle(root).fontSize) || 13
  const raw = getComputedStyle(root).getPropertyValue(name).trim()
  if (raw.endsWith("rem")) {
    const rem = parseFloat(raw)
    if (Number.isFinite(rem) && rem > 0) return rem * fontSize
  } else {
    const px = parseFloat(raw)
    if (Number.isFinite(px) && px > 0) return px
  }
  return fontSize * fallbackRem
}

export function readTreeRowHeights(): { project: number; child: number } {
  return {
    project: readCssLengthPx("--jet-project-row-height", 1.75),
    child: readCssLengthPx("--jet-row-height", 1.5),
  }
}

export function readLocationRowHeight(): number {
  return readCssLengthPx("--jet-location-row-height", 2.5)
}
