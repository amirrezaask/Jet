import { EditorView, Decoration, ViewPlugin, WidgetType } from "@codemirror/view"
import { StateEffect, StateField, Range, type EditorState, type Extension } from "@codemirror/state"
import { forEachDiagnostic, type Diagnostic } from "@codemirror/lint"
import type { BraceScopeEntry } from "./brace-scope-scan.js"
import { getBraceScopeHost } from "./workers/brace-scope-host.js"
import { perfMeasure } from "./perf-instrumentation.js"
import { fetchHoverPlaintext } from "./lsp-editor-commands.js"
import { extractHoverSignature, plainHoverSnippet } from "./hover-signature.js"

const EOL_MAX_TEXT_LEN = 60
const BRACE_SCOPE_MARGIN = 8 * 1024
const HOVER_DEBOUNCE_MS = 140

type EolSeverity = "error" | "warning" | "info"

type EolOverlayItem =
  | { kind: "diagnostic"; text: string; severity: EolSeverity }
  | { kind: "type"; text: string }
  | { kind: "closeBrace"; text: string }

type TypeHint = { line: number; text: string }

class EolOverlayWidget extends WidgetType {
  constructor(readonly items: EolOverlayItem[]) {
    super()
  }

  eq(other: EolOverlayWidget): boolean {
    if (other.items.length !== this.items.length) return false
    return this.items.every((item, i) => {
      const o = other.items[i]!
      if (item.kind !== o.kind) return false
      if (item.kind === "diagnostic" && o.kind === "diagnostic") {
        return item.text === o.text && item.severity === o.severity
      }
      return item.text === o.text
    })
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("span")
    wrap.className = "cm-eol-overlay-wrap"
    wrap.setAttribute("aria-hidden", "true")
    for (const item of this.items) {
      const span = document.createElement("span")
      span.className = eolItemClass(item)
      span.textContent = item.text
      wrap.appendChild(span)
    }
    return wrap
  }

  ignoreEvent(): boolean {
    return true
  }
}

function eolItemClass(item: EolOverlayItem): string {
  if (item.kind === "diagnostic") return `cm-eol-overlay cm-eol-overlay-diagnostic-${item.severity}`
  if (item.kind === "type") return "cm-eol-overlay cm-eol-overlay-type"
  return "cm-eol-overlay cm-eol-overlay-close-brace"
}

const eolOverlayMark = Decoration.mark({ class: "cm-eol-overlay-wrap-mark" })

const setEolDeco = StateEffect.define<ReturnType<typeof Decoration.set>>()

const eolOverlayField = StateField.define({
  create() {
    return Decoration.none
  },
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setEolDeco)) return e.value
    }
    return deco.map(tr.changes)
  },
  provide: f => EditorView.decorations.from(f),
})

function severityRank(severity: EolSeverity): number {
  if (severity === "error") return 3
  if (severity === "warning") return 2
  return 1
}

function severityFromLint(severity: Diagnostic["severity"]): EolSeverity {
  if (severity === "error") return "error"
  if (severity === "warning") return "warning"
  return "info"
}

function truncateEolText(text: string): string {
  const firstLine = text.split("\n")[0]?.trim() ?? ""
  if (firstLine.length <= EOL_MAX_TEXT_LEN) return firstLine
  return `${firstLine.slice(0, EOL_MAX_TEXT_LEN)}…`
}

type DiagPick = { text: string; severity: EolSeverity; rank: number }

function pickDiagnosticForLine(
  state: EditorState,
  lineNum: number,
  cursorPos: number,
  cursorLine: number,
): { text: string; severity: EolSeverity } | null {
  const line = state.doc.line(lineNum)
  const picks: { atCursor: DiagPick | null; best: DiagPick | null } = { atCursor: null, best: null }

  forEachDiagnostic(state, (diag, from, to) => {
    if (to < line.from || from > line.to) return
    const severity = severityFromLint(diag.severity)
    const rank = severityRank(severity)
    const entry: DiagPick = { text: truncateEolText(diag.message), severity, rank }
    if (lineNum === cursorLine && cursorPos >= from && cursorPos <= to) {
      if (!picks.atCursor || rank > picks.atCursor.rank) picks.atCursor = entry
    }
    if (!picks.best || rank > picks.best.rank) picks.best = entry
  })

  const chosen = picks.atCursor ?? picks.best
  if (!chosen) return null
  return { text: chosen.text, severity: chosen.severity }
}

function viewportDiagnosticFingerprint(state: EditorState, from: number, to: number): string {
  const parts: string[] = []
  forEachDiagnostic(state, (diag, diagFrom, diagTo) => {
    if (diagTo < from || diagFrom > to) return
    parts.push(`${diagFrom}:${diagTo}:${diag.severity}:${diag.message}`)
  })
  return parts.join("|")
}

function buildEolDecorations(
  view: EditorView,
  scopes: BraceScopeEntry[],
  typeHint: TypeHint | null,
): ReturnType<typeof Decoration.set> {
  const deco: Range<Decoration>[] = []
  const { state } = view
  const doc = state.doc
  const cursorPos = state.selection.main.head
  const cursorLine = doc.lineAt(cursorPos).number
  const vp = view.viewport
  const lineStart = doc.lineAt(vp.from).number
  const lineEnd = doc.lineAt(vp.to).number

  const closeBraceByLine = new Map<number, string>()
  for (const scope of scopes) {
    closeBraceByLine.set(scope.closeLine + 1, scope.label)
  }

  const lineNums = new Set<number>()
  for (let n = lineStart; n <= lineEnd; n++) {
    if (pickDiagnosticForLine(state, n, cursorPos, cursorLine)) lineNums.add(n)
  }
  for (const lineNum of closeBraceByLine.keys()) lineNums.add(lineNum)
  if (typeHint?.text) lineNums.add(typeHint.line)

  for (const lineNum of lineNums) {
    const items: EolOverlayItem[] = []
    const diagnostic = pickDiagnosticForLine(state, lineNum, cursorPos, cursorLine)
    if (diagnostic) {
      items.push({ kind: "diagnostic", text: diagnostic.text, severity: diagnostic.severity })
    }
    if (typeHint?.text && lineNum === typeHint.line) {
      items.push({ kind: "type", text: typeHint.text })
    }
    const closeLabel = closeBraceByLine.get(lineNum)
    if (closeLabel) {
      items.push({ kind: "closeBrace", text: closeLabel })
    }
    if (!items.length) continue

    const line = doc.line(lineNum)
    deco.push(
      Decoration.widget({
        widget: new EolOverlayWidget(items),
        side: 1,
        marks: [eolOverlayMark],
      }).range(line.to),
    )
  }

  return Decoration.set(deco, true)
}

type PluginEntry = {
  ownerId: number
  scanStamp: number
  scanDebounce: ReturnType<typeof setTimeout> | null
  hoverStamp: number
  hoverDebounce: ReturnType<typeof setTimeout> | null
  scopes: BraceScopeEntry[]
  typeHint: TypeHint | null
  lastDiagFingerprint: string
}

const viewState = new WeakMap<EditorView, PluginEntry>()
let nextOwnerId = 1

function rebuildDecorations(view: EditorView, entry: PluginEntry): void {
  queueMicrotask(() => {
    if (!viewState.has(view)) return
    view.dispatch({
      effects: setEolDeco.of(buildEolDecorations(view, entry.scopes, entry.typeHint)),
    })
  })
}

function runScan(view: EditorView, entry: PluginEntry): void {
  const stamp = ++entry.scanStamp
  const { state } = view
  const vp = view.viewport
  const sliceFrom = Math.max(0, vp.from - BRACE_SCOPE_MARGIN)
  const sliceTo = Math.min(state.doc.length, vp.to + BRACE_SCOPE_MARGIN)
  const lineOffset = state.doc.lineAt(sliceFrom).number - 1
  const text = state.doc.sliceString(sliceFrom, sliceTo)

  perfMeasure("jet:brace-scope-prep", () => {
    getBraceScopeHost().schedule(
      entry.ownerId,
      {
        changeStamp: stamp,
        textOffset: sliceFrom,
        lineNumberOffset: lineOffset,
        viewportFrom: vp.from - sliceFrom,
        viewportTo: vp.to - sliceFrom,
        cursorPos: state.selection.main.head - sliceFrom,
        text,
        tabWidth: state.tabSize,
      },
      result => {
        if (result.changeStamp !== stamp) return
        entry.scopes = result.scopes
        rebuildDecorations(view, entry)
      },
    )
  })
}

function scheduleScan(view: EditorView, entry: PluginEntry): void {
  if (entry.scanDebounce != null) clearTimeout(entry.scanDebounce)
  entry.scanDebounce = setTimeout(() => {
    entry.scanDebounce = null
    runScan(view, entry)
  }, 16)
}

function scheduleHover(view: EditorView, entry: PluginEntry): void {
  if (entry.hoverDebounce != null) clearTimeout(entry.hoverDebounce)
  const stamp = ++entry.hoverStamp
  entry.typeHint = null
  rebuildDecorations(view, entry)

  entry.hoverDebounce = setTimeout(() => {
    entry.hoverDebounce = null
    const pos = view.state.selection.main.head
    const line = view.state.doc.lineAt(pos).number
    void fetchHoverPlaintext(view, pos).then(text => {
      if (stamp !== entry.hoverStamp) return
      if (view.state.selection.main.head !== pos) return
      if (!text) {
        entry.typeHint = null
        rebuildDecorations(view, entry)
        return
      }
      const signature = extractHoverSignature(text)
      const snippet = signature ?? plainHoverSnippet(text)
      if (!snippet) {
        entry.typeHint = null
        rebuildDecorations(view, entry)
        return
      }
      entry.typeHint = {
        line,
        text: truncateEolText(snippet),
      }
      rebuildDecorations(view, entry)
    })
  }, HOVER_DEBOUNCE_MS)
}

function maybeRebuildOnUpdate(view: EditorView, entry: PluginEntry, u: ViewUpdateLike): void {
  const { state } = view
  const fp = viewportDiagnosticFingerprint(state, view.viewport.from, view.viewport.to)
  const diagChanged = fp !== entry.lastDiagFingerprint
  if (diagChanged) entry.lastDiagFingerprint = fp

  if (u.docChanged || u.viewportChanged) scheduleScan(view, entry)
  if (u.selectionSet || u.docChanged) scheduleHover(view, entry)
  else if (diagChanged) rebuildDecorations(view, entry)
}

type ViewUpdateLike = {
  docChanged: boolean
  viewportChanged: boolean
  selectionSet: boolean
}

export function eolOverlayExtension(): Extension {
  return [
    eolOverlayField,
    ViewPlugin.define(view => {
      const entry: PluginEntry = {
        ownerId: nextOwnerId++,
        scanStamp: 0,
        scanDebounce: null,
        hoverStamp: 0,
        hoverDebounce: null,
        scopes: [],
        typeHint: null,
        lastDiagFingerprint: viewportDiagnosticFingerprint(
          view.state,
          view.viewport.from,
          view.viewport.to,
        ),
      }
      viewState.set(view, entry)
      scheduleScan(view, entry)
      scheduleHover(view, entry)
      return {
        update(u) {
          maybeRebuildOnUpdate(view, entry, u)
        },
        destroy() {
          if (entry.scanDebounce != null) clearTimeout(entry.scanDebounce)
          if (entry.hoverDebounce != null) clearTimeout(entry.hoverDebounce)
          viewState.delete(view)
          getBraceScopeHost().cancel(entry.ownerId)
        },
      }
    }),
  ]
}

