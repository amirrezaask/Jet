import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"

export type ListRowsOpts = {
  panel: string
  minItems: number
  minUniqueTops?: number
  minRowHeight?: number
  needle?: string
  noResultsText?: string
}

export async function expectListRows(page: Page, opts: ListRowsOpts): Promise<void> {
  const { panel, minItems, minUniqueTops = minItems, minRowHeight = 18, needle, noResultsText = "No results" } = opts
  const panelSel = `[data-jet-list-panel="${panel}"]`
  const itemSel = `${panelSel} [data-jet-list-item]`

  await expect(page.locator(panelSel)).toBeVisible()
  await expect(page.locator(panelSel)).not.toContainText(noResultsText)

  if (needle) {
    await expect(page.locator(panelSel)).toContainText(needle)
  }

  await expectLayout(page, { selector: itemSel, minItems, minUniqueTops, minRowHeight })
  await expectNoOverlap(page, { selector: itemSel, minItems })
  await expectRowTextVisible(page, { selector: itemSel, minItems })
}

export type LayoutOpts = {
  selector?: string
  minItems?: number
  minUniqueTops?: number
  minRowHeight?: number
}

export async function expectLayout(page: Page, opts: LayoutOpts): Promise<void> {
  const sel = opts.selector ?? "[data-jet-list-item]"
  const minItems = opts.minItems ?? 2
  const minUniqueTops = opts.minUniqueTops ?? minItems
  const minRowHeight = opts.minRowHeight ?? 18

  const layout = await page.evaluate(
    ({ sel, minItems: _mi, minUniqueTops: _mut, minRowHeight: _mrh }) => {
      const all = [...document.querySelectorAll<HTMLElement>(sel)]
      const items = all.filter(el => {
        if (el.hasAttribute("aria-hidden") && el.getAttribute("aria-hidden") !== "false") return false
        const cs = getComputedStyle(el)
        if (cs.display === "none" || cs.visibility === "hidden") return false
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) return false
        return true
      })
      const rects = items.map(el => el.getBoundingClientRect())
      const tops = rects.map(r => Math.round(r.top))
      const uniqueTops = new Set(tops).size
      const minH = rects.length ? Math.min(...rects.map(r => r.height)) : 0
      const flexShrinks = items.slice(0, 5).map(el => getComputedStyle(el).flexShrink)
      return { count: items.length, uniqueTops, minH, tops: tops.slice(0, 8), flexShrinks }
    },
    { sel, minItems, minUniqueTops, minRowHeight },
  )

  if (layout.count < minItems) {
    throw new Error(`expectLayout: count=${layout.count} expected>=${minItems}`)
  }
  if (layout.uniqueTops < minUniqueTops) {
    throw new Error(
      `expectLayout: uniqueTops=${layout.uniqueTops} expected>=${minUniqueTops} tops=${JSON.stringify(layout.tops)}`,
    )
  }
  if (layout.minH < minRowHeight) {
    throw new Error(`expectLayout: minRowHeight=${layout.minH} expected>=${minRowHeight}`)
  }
  const enforceShrink = /data-jet-list-item|role=["']option/.test(sel)
  if (enforceShrink && layout.flexShrinks.some(s => s !== "0")) {
    throw new Error(`expectLayout: flexShrink must be 0, got ${JSON.stringify(layout.flexShrinks)}`)
  }
}

export type NoOverlapOpts = {
  selector?: string
  minItems?: number
  tolerancePx?: number
}

export async function expectNoOverlap(page: Page, opts: NoOverlapOpts = {}): Promise<void> {
  const sel = opts.selector ?? "[data-jet-list-item]"
  const minItems = opts.minItems ?? 2
  const tol = opts.tolerancePx ?? 0

  const report = await page.evaluate(
    ({ sel, tol }) => {
      const items = [...document.querySelectorAll<HTMLElement>(sel)]
      const rects = items.map((el, i) => {
        const r = el.getBoundingClientRect()
        return { i, top: r.top, bottom: r.bottom, left: r.left, right: r.right, text: (el.textContent ?? "").trim().slice(0, 40) }
      })
      const overlaps: Array<{ a: number; b: number; aText: string; bText: string; overlapY: number }> = []
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i]!
          const b = rects[j]!
          const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          if (yOverlap > tol && xOverlap > tol) {
            overlaps.push({ a: a.i, b: b.i, aText: a.text, bText: b.text, overlapY: yOverlap })
          }
        }
      }
      return { count: rects.length, overlaps: overlaps.slice(0, 5), totalOverlaps: overlaps.length }
    },
    { sel, tol },
  )

  if (report.count < minItems) {
    throw new Error(`expectNoOverlap: found ${report.count} items, expected >= ${minItems}`)
  }
  if (report.totalOverlaps > 0) {
    throw new Error(
      `expectNoOverlap: ${report.totalOverlaps} overlapping pair(s). Examples: ${JSON.stringify(report.overlaps)}`,
    )
  }
}

export type NoClippingOpts = {
  selector?: string
  containerSelector?: string
}

export async function expectNoClipping(page: Page, opts: NoClippingOpts = {}): Promise<void> {
  const sel = opts.selector ?? "[data-jet-list-item]"
  const containerSel = opts.containerSelector ?? null

  const report = await page.evaluate(
    ({ sel, containerSel }) => {
      const items = [...document.querySelectorAll<HTMLElement>(sel)]
      const container = containerSel ? document.querySelector<HTMLElement>(containerSel) : null
      const containerRect = container?.getBoundingClientRect() ?? null
      const clipped: Array<{ i: number; text: string; scrollW: number; clientW: number }> = []
      items.forEach((el, i) => {
        const r = el.getBoundingClientRect()
        if (containerRect) {
          if (r.top >= containerRect.bottom || r.bottom <= containerRect.top) return
        }
        const scrollW = el.scrollWidth
        const clientW = el.clientWidth
        if (scrollW - clientW > 1 && getComputedStyle(el).textOverflow !== "ellipsis") {
          const inner = [...el.querySelectorAll<HTMLElement>("*")]
          const trunc = inner.some(child => getComputedStyle(child).textOverflow === "ellipsis")
          if (!trunc) {
            clipped.push({ i, text: (el.textContent ?? "").trim().slice(0, 40), scrollW, clientW })
          }
        }
        if (containerRect) {
          if (r.right > containerRect.right + 1) {
            clipped.push({ i, text: (el.textContent ?? "").trim().slice(0, 40), scrollW, clientW })
          }
        }
      })
      return { count: items.length, clipped: clipped.slice(0, 5), total: clipped.length }
    },
    { sel, containerSel },
  )

  if (report.total > 0) {
    throw new Error(
      `expectNoClipping: ${report.total} clipped element(s). Examples: ${JSON.stringify(report.clipped)}`,
    )
  }
}

export type RowSpacingOpts = {
  selector?: string
  minItems?: number
  maxGapPx?: number
  tolerancePx?: number
}

export async function expectRowSpacing(page: Page, opts: RowSpacingOpts = {}): Promise<void> {
  const sel = opts.selector ?? "[data-jet-list-item]"
  const minItems = opts.minItems ?? 2
  const maxGap = opts.maxGapPx ?? 2
  const tol = opts.tolerancePx ?? 0.5

  const report = await page.evaluate(
    ({ sel, maxGap, tol }) => {
      const items = [...document.querySelectorAll<HTMLElement>(sel)]
      const rects = items
        .map((el, i) => ({ i, top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom, text: (el.textContent ?? "").trim().slice(0, 40) }))
        .sort((a, b) => a.top - b.top || a.i - b.i)
      const badGaps: Array<{ a: number; b: number; gap: number; aText: string; bText: string }> = []
      for (let j = 1; j < rects.length; j++) {
        const gap = rects[j]!.top - rects[j - 1]!.bottom
        if (gap > maxGap + tol) {
          badGaps.push({ a: rects[j - 1]!.i, b: rects[j]!.i, gap: Math.round(gap * 10) / 10, aText: rects[j - 1]!.text, bText: rects[j]!.text })
        }
      }
      return { count: rects.length, badGaps: badGaps.slice(0, 5), totalBad: badGaps.length }
    },
    { sel, maxGap, tol },
  )

  if (report.count < minItems) {
    throw new Error(`expectRowSpacing: found ${report.count} items, expected >= ${minItems}`)
  }
  if (report.totalBad > 0) {
    throw new Error(
      `expectRowSpacing: ${report.totalBad} gap(s) exceed ${maxGap}px. Examples: ${JSON.stringify(report.badGaps)}`,
    )
  }
}

export type RowTextVisibleOpts = {
  selector?: string
  minItems?: number
  textSelector?: string
  minGlyphHeightPx?: number
  requireWithinRowBounds?: boolean
}

export async function expectRowTextVisible(page: Page, opts: RowTextVisibleOpts = {}): Promise<void> {
  const sel = opts.selector ?? "[data-jet-list-item]"
  const minItems = opts.minItems ?? 1
  const textSel = opts.textSelector ?? "span, [data-slot='row-label'], [data-slot='row-detail']"
  const minGlyphH = opts.minGlyphHeightPx ?? 8
  const requireWithin = opts.requireWithinRowBounds !== false

  const report = await page.evaluate(
    ({ sel, textSel, minGlyphH, requireWithin }) => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>(sel))
      const problems: Array<{ i: number; reason: string; text: string }> = []
      rows.forEach((row, i) => {
        const rowRect = row.getBoundingClientRect()
        const texts = Array.from(row.querySelectorAll<HTMLElement>(textSel))
        if (texts.length === 0 && (row.textContent ?? "").trim().length > 0) {
          problems.push({ i, reason: "no text child elements", text: (row.textContent ?? "").trim().slice(0, 40) })
          return
        }
        let anyVisible = false
        for (const t of texts) {
          const tr = t.getBoundingClientRect()
          const cs = getComputedStyle(t)
          const isTransparent =
            cs.color === "rgba(0, 0, 0, 0)" || cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity || "1") === 0
          const glyphH = tr.height
          const insideRow = !requireWithin || (tr.top >= rowRect.top - 1 && tr.bottom <= rowRect.bottom + 1)
          if (!isTransparent && glyphH >= minGlyphH && insideRow) {
            anyVisible = true
            break
          }
          if (!isTransparent && glyphH >= minGlyphH && !insideRow) {
            problems.push({
              i,
              reason: `text overflows row bounds: text=(${Math.round(tr.top)},${Math.round(tr.bottom)}) row=(${Math.round(rowRect.top)},${Math.round(rowRect.bottom)})`,
              text: (t.textContent ?? "").trim().slice(0, 40),
            })
            return
          }
        }
        if (!anyVisible && (row.textContent ?? "").trim().length > 0) {
          problems.push({ i, reason: "no visible text (transparent/hidden/zero-height)", text: (row.textContent ?? "").trim().slice(0, 40) })
        }
      })
      return { count: rows.length, problems: problems.slice(0, 5), totalProblems: problems.length }
    },
    { sel, textSel, minGlyphH, requireWithin },
  )

  if (report.count < minItems) {
    throw new Error(`expectRowTextVisible: found ${report.count} rows, expected >= ${minItems}`)
  }
  if (report.totalProblems > 0) {
    throw new Error(
      `expectRowTextVisible: ${report.totalProblems} row(s) have unreadable text. Examples: ${JSON.stringify(report.problems)}`,
    )
  }
}

export type ElementWidthOpts = {
  selector: string
  minPx?: number
  maxPx?: number
  minPctOfViewport?: number
  maxPctOfViewport?: number
}

export async function expectElementWidth(page: Page, opts: ElementWidthOpts): Promise<void> {
  const report = await page.evaluate(
    ({ sel }) => {
      const el = document.querySelector<HTMLElement>(sel)
      if (!el) return { found: false as const }
      const width = el.getBoundingClientRect().width
      return { found: true as const, width, viewport: window.innerWidth }
    },
    { sel: opts.selector },
  )

  if (!report.found) {
    throw new Error(`expectElementWidth: no element matches ${opts.selector}`)
  }

  const { width, viewport } = report
  if (opts.minPx != null && width < opts.minPx) {
    throw new Error(`expectElementWidth: width=${width}px expected>=${opts.minPx}px`)
  }
  if (opts.maxPx != null && width > opts.maxPx) {
    throw new Error(`expectElementWidth: width=${width}px expected<=${opts.maxPx}px`)
  }
  const pct = (width / viewport) * 100
  if (opts.minPctOfViewport != null && pct < opts.minPctOfViewport) {
    throw new Error(`expectElementWidth: width=${width}px (${pct.toFixed(1)}% vw) expected>=${opts.minPctOfViewport}%`)
  }
  if (opts.maxPctOfViewport != null && pct > opts.maxPctOfViewport) {
    throw new Error(`expectElementWidth: width=${width}px (${pct.toFixed(1)}% vw) expected<=${opts.maxPctOfViewport}%`)
  }
}

export type SyntaxHighlightingOpts = {
  selector?: string
  minColoredSpans?: number
  minUniqueColors?: number
  requireKeywordColor?: boolean
}

export async function expectSyntaxHighlighting(page: Page, opts: SyntaxHighlightingOpts = {}): Promise<void> {
  const sel = opts.selector ?? ".cm-line span"
  const minSpans = opts.minColoredSpans ?? 5
  const minColors = opts.minUniqueColors ?? 3

  const report = await page.evaluate(
    ({ sel }) => {
      const spans = [...document.querySelectorAll<HTMLElement>(sel)]
      const colored = spans.filter(s => {
        const c = getComputedStyle(s).color
        return c && c !== "rgba(0, 0, 0, 0)"
      })
      const colors = [...new Set(colored.map(s => getComputedStyle(s).color))]
      const keywords = colored.filter(s =>
        /^(import|export|function|const|let|return|fn|pub|enum|struct)\b/.test(s.textContent ?? ""),
      )
      const keywordColors = [...new Set(keywords.map(s => getComputedStyle(s).color))]
      return { spanCount: spans.length, coloredCount: colored.length, uniqueColors: colors.length, keywordCount: keywords.length, keywordUniqueColors: keywordColors.length, sampleColors: colors.slice(0, 6) }
    },
    { sel },
  )

  if (report.spanCount < minSpans) {
    throw new Error(`expectSyntaxHighlighting: spanCount=${report.spanCount} expected>=${minSpans}`)
  }
  if (report.coloredCount < minSpans) {
    throw new Error(`expectSyntaxHighlighting: coloredCount=${report.coloredCount} expected>=${minSpans}`)
  }
  if (report.uniqueColors < minColors) {
    throw new Error(
      `expectSyntaxHighlighting: uniqueColors=${report.uniqueColors} expected>=${minColors} sample=${JSON.stringify(report.sampleColors)}`,
    )
  }
  if (opts.requireKeywordColor && report.keywordCount > 0 && report.keywordUniqueColors < 1) {
    throw new Error("expectSyntaxHighlighting: keyword tokens have no distinct color")
  }
}

export async function dragResizeHandle(page: Page, opts: { selector?: string; deltaX?: number; deltaY?: number }): Promise<void> {
  const sel = opts.selector ?? '[data-slot="resizable-handle"]'
  const deltaX = opts.deltaX ?? 0
  const deltaY = opts.deltaY ?? 0
  const handle = page.locator(sel).first()
  const box = await handle.boundingBox()
  if (!box) throw new Error(`dragResizeHandle: no bounding box for ${sel}`)
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 12 })
  await page.mouse.up()
}
