export const BRACE_SCOPE_SCAN_LIMIT = 16 * 1024
const MAX_LABEL_WALKBACK = 8
const MAX_LABEL_LEN = 60
const MIN_LABEL_SCOPE_LINES = 6

export type BraceScopeEntry = {
  openPos: number
  closePos: number
  openLine: number
  closeLine: number
  label: string
  guideColumn: number
}

export type BraceScopeScanJob = {
  requestId: number
  ownerId: number
  changeStamp: number
  textOffset: number
  lineNumberOffset: number
  viewportFrom: number
  viewportTo: number
  cursorPos: number
  text: string
}

export type BraceScopeScanResult = {
  requestId: number
  changeStamp: number
  scopes: BraceScopeEntry[]
}

export function braceGuideVisualColumn(lineText: string, tabWidth = 4): number {
  const tab = Math.max(1, tabWidth)
  let col = 0
  for (const c of lineText) {
    if (!/\s/.test(c)) break
    if (c === "\t") col += tab - (col % tab)
    else col += 1
  }
  return col
}

function lineHasDeclKeyword(line: string): boolean {
  const keywords = [
    "fn ",
    "struct ",
    "enum ",
    "trait ",
    "impl ",
    "pub ",
    "async ",
    "unsafe ",
    "class ",
    "interface ",
    "func ",
    "def ",
    "module ",
    "type ",
    "extern ",
  ]
  return keywords.some(kw => line.includes(kw))
}

export function scopeOpenLabel(lines: string[], openLine: number): string | null {
  let lineNum = openLine
  let steps = 0
  let inMultilineSig = false
  while (steps < MAX_LABEL_WALKBACK) {
    steps++
    const text = lines[lineNum]
    if (text == null) return null
    const trimmed = text.trim()
    const hasContent = [...trimmed].some(
      c => !/\s/.test(c) && !"{}()[],;".includes(c),
    )
    const alwaysSkip =
      !hasContent ||
      trimmed.startsWith("#[") ||
      trimmed.startsWith("///") ||
      trimmed.startsWith("//!") ||
      trimmed.startsWith("@")
    if (alwaysSkip) {
      if (lineNum === 0) return null
      lineNum -= 1
      continue
    }
    const sigCont = trimmed.startsWith(")") || trimmed.startsWith("->")
    if (sigCont && !lineHasDeclKeyword(trimmed)) {
      inMultilineSig = true
      if (lineNum === 0) return null
      lineNum -= 1
      continue
    }
    if (inMultilineSig && !lineHasDeclKeyword(trimmed)) {
      if (lineNum === 0) return null
      lineNum -= 1
      continue
    }
    return trimmed.length > MAX_LABEL_LEN ? `${trimmed.slice(0, MAX_LABEL_LEN)}…` : trimmed
  }
  return null
}

function charAt(text: string, i: number): string {
  return text[i] ?? ""
}

function forwardMatchCloseBrace(text: string, openIdx: number): number | null {
  let depth = 1
  const end = Math.min(text.length, openIdx + BRACE_SCOPE_SCAN_LIMIT)
  for (let i = openIdx + 1; i < end; i++) {
    const c = charAt(text, i)
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) return i
    }
  }
  return null
}

function offsetToLine(lineStartOffsets: number[], pos: number): number {
  let lo = 0
  let hi = lineStartOffsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStartOffsets[mid]! <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}

function findScopesInViewport(
  text: string,
  lineStartOffsets: number[],
  lines: string[],
  viewportFrom: number,
  viewportTo: number,
  textOffset: number,
  lineNumberOffset: number,
): BraceScopeEntry[] {
  const scopes: BraceScopeEntry[] = []
  const seen = new Set<number>()

  for (let i = viewportFrom; i < Math.min(text.length, viewportTo); i++) {
    if (charAt(text, i) !== "{") continue
    const close = forwardMatchCloseBrace(text, i)
    if (close == null) continue
    if (close < viewportFrom || i > viewportTo) continue
    if (seen.has(i)) continue
    seen.add(i)

    const openLine = offsetToLine(lineStartOffsets, i)
    const closeLine = offsetToLine(lineStartOffsets, close)
    if (closeLine - openLine < MIN_LABEL_SCOPE_LINES) continue

    const label = scopeOpenLabel(lines, openLine)
    if (!label) continue

    const closeLineText = lines[closeLine] ?? ""
    scopes.push({
      openPos: textOffset + i,
      closePos: textOffset + close,
      openLine: lineNumberOffset + openLine,
      closeLine: lineNumberOffset + closeLine,
      label,
      guideColumn: braceGuideVisualColumn(closeLineText),
    })
  }

  return scopes
}

export function scanBraceScopes(job: BraceScopeScanJob): BraceScopeScanResult {
  const lines = job.text.length === 0 ? [""] : job.text.split("\n")
  const lineStartOffsets = buildLineStartOffsets(lines)
  const scopes = findScopesInViewport(
    job.text,
    lineStartOffsets,
    lines,
    job.viewportFrom,
    job.viewportTo,
    job.textOffset,
    job.lineNumberOffset,
  )
  return {
    requestId: job.requestId,
    changeStamp: job.changeStamp,
    scopes,
  }
}

export function buildLineStartOffsets(lines: string[]): number[] {
  const offsets: number[] = [0]
  for (let i = 0; i < lines.length - 1; i++) {
    offsets.push(offsets[i]! + lines[i]!.length + 1)
  }
  return offsets
}

export function snapshotViewportLines(
  docLines: { from: number; to: number; text: string; number: number }[],
  viewportFrom: number,
  viewportTo: number,
): { lines: string[]; lineStartOffsets: number[]; textFrom: number; textTo: number } {
  const filtered = docLines.filter(l => l.to >= viewportFrom && l.from <= viewportTo)
  if (!filtered.length) {
    return { lines: [], lineStartOffsets: [0], textFrom: 0, textTo: 0 }
  }
  const lines = filtered.map(l => l.text)
  const textFrom = filtered[0]!.from
  const textTo = filtered[filtered.length - 1]!.to
  const lineStartOffsets = filtered.map(l => l.from)
  return { lines, lineStartOffsets, textFrom, textTo }
}
