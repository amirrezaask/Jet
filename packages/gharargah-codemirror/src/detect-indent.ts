export type DetectedIndent = {
  style: "tab" | "space"
  size: number
}

const DEFAULT_INDENT: DetectedIndent = { style: "space", size: 4 }
const MAX_SCAN_LINES = 1000

function gcd(a: number, b: number): number {
  let x = a
  let y = b
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return x
}

/** Infer dominant indent style from buffer text (first ~1000 non-empty lines). */
export function detectIndent(text: string): DetectedIndent {
  if (!text.length) return DEFAULT_INDENT

  let tabLines = 0
  let spaceLines = 0
  let spaceGcd = 0

  const lines = text.split("\n")
  const limit = Math.min(lines.length, MAX_SCAN_LINES)

  for (let i = 0; i < limit; i++) {
    const line = lines[i]!
    if (!line.trim()) continue
    const match = line.match(/^(\t+| +)/)
    if (!match) continue
    const lead = match[1]!
    if (lead.includes("\t")) {
      tabLines++
    } else {
      spaceLines++
      const n = lead.length
      spaceGcd = spaceGcd === 0 ? n : gcd(spaceGcd, n)
    }
  }

  if (tabLines === 0 && spaceLines === 0) return DEFAULT_INDENT
  if (tabLines >= spaceLines) return { style: "tab", size: 4 }
  const size = spaceGcd > 0 && spaceGcd <= 8 ? spaceGcd : 4
  return { style: "space", size }
}

export function indentUnitFor(detected: DetectedIndent): string {
  return detected.style === "tab" ? "\t" : " ".repeat(detected.size)
}
