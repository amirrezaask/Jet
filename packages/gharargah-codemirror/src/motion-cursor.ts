import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view"
import type { Extension } from "@codemirror/state"
import {
  CaretEndpointAnim,
  CaretGhostBuffer,
  onReducedMotionChange,
  prefersReducedMotion,
  type CaretPoint,
} from "@gharargah/shared"

type CursorStyle = "bar" | "block" | "underline"
type CursorMotion = "trail" | "smooth" | "off"

type CursorEntry = {
  anim: CaretEndpointAnim
  ghosts: CaretGhostBuffer
  cursor: HTMLDivElement
  ghostEls: HTMLDivElement[]
  lastGhostX: number
  lastGhostY: number
}

function rootSetting<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const root = getComputedStyle(document.documentElement)
  const value = root.getPropertyValue(name).trim() as T
  return allowed.includes(value) ? value : fallback
}

function readCursorAppearance(): { style: CursorStyle; motion: CursorMotion } {
  return {
    style: rootSetting("--gharargah-cursor-style", ["bar", "block", "underline"], "bar"),
    motion: rootSetting("--gharargah-cursor-motion", ["trail", "smooth", "off"], "trail"),
  }
}

function pointAt(view: EditorView, pos: number): CaretPoint | null {
  const rect = view.coordsAtPos(pos)
  if (!rect) return null
  // Position relative to .cm-editor (not .cm-scroller). WKWebView mis-composites
  // transform layers inside overflow scrollers; Electron/Chromium tolerate it.
  const editorRect = view.dom.getBoundingClientRect()
  const h = Math.max(1, rect.bottom - rect.top)
  let charWidth = view.defaultCharacterWidth
  if (pos < view.state.doc.length) {
    const next = view.coordsAtPos(pos + 1)
    if (next && Math.abs(next.top - rect.top) < 1 && next.left > rect.left) {
      charWidth = next.left - rect.left
    }
  }
  return {
    x: rect.left - editorRect.left,
    y: rect.top - editorRect.top,
    h,
    charWidth: Math.max(1, charWidth),
  }
}

function typingHop(update: ViewUpdate): boolean {
  if (!update.docChanged || update.state.selection.ranges.length !== 1) return false
  const before = update.startState.selection.main
  const after = update.state.selection.main
  if (!before.empty || !after.empty || after.head !== before.head + 1) return false
  return update.startState.doc.lineAt(before.head).number === update.state.doc.lineAt(after.head).number
}

function createCursorElement(kind: "cursor" | "ghost"): HTMLDivElement {
  const element = document.createElement("div")
  element.dataset[kind === "cursor" ? "jetEditorCursor" : "jetEditorCursorGhost"] = ""
  Object.assign(element.style, {
    position: "absolute",
    top: "0",
    left: "0",
    pointerEvents: "none",
    willChange: "transform, width, height, opacity",
  })
  return element
}

class MotionCursorPlugin {
  private readonly layer = document.createElement("div")
  private readonly entries = new Map<number, CursorEntry>()
  private reduced = prefersReducedMotion()
  private raf: number | null = null
  private lastFrame = 0
  private instantNext = true
  private typingTrail = false
  private appearance = readCursorAppearance()
  private readonly unsubscribeReduced: () => void
  private readonly rootObserver: MutationObserver

  constructor(private readonly view: EditorView) {
    this.layer.className = "jet-editor-cursor-layer"
    this.layer.dataset.jetEditorCursorLayer = ""
    view.dom.appendChild(this.layer)
    this.unsubscribeReduced = onReducedMotionChange(reduced => {
      this.reduced = reduced
      this.instantNext = true
      this.measureAndRetarget()
    })
    this.rootObserver = new MutationObserver(() => {
      this.appearance = readCursorAppearance()
      this.instantNext = true
      this.measureAndRetarget()
    })
    this.rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-gharargah-reduced-motion"],
    })
    this.measureAndRetarget()
  }

  update(update: ViewUpdate): void {
    if (
      !update.selectionSet &&
      !update.docChanged &&
      !update.viewportChanged &&
      !update.geometryChanged &&
      !update.focusChanged
    ) return

    const composing = update.view.composing
    this.layer.style.visibility = composing ? "hidden" : "visible"
    if (composing) {
      this.stop()
      return
    }
    this.typingTrail =
      typingHop(update) && this.appearance.motion === "trail" && !this.reduced
    this.instantNext = true
    this.measureAndRetarget()
  }

  private ensureEntry(index: number, point: CaretPoint): CursorEntry {
    const existing = this.entries.get(index)
    if (existing) return existing
    const cursor = createCursorElement("cursor")
    const ghostEls = Array.from({ length: 5 }, () => createCursorElement("ghost"))
    this.layer.append(cursor, ...ghostEls)
    const anim = new CaretEndpointAnim()
    anim.snap(point)
    const entry: CursorEntry = {
      anim,
      ghosts: new CaretGhostBuffer(),
      cursor,
      ghostEls,
      lastGhostX: point.x,
      lastGhostY: point.y,
    }
    this.entries.set(index, entry)
    return entry
  }

  private measureAndRetarget(): void {
    this.view.requestMeasure({
      read: view => view.state.selection.ranges.map(range => pointAt(view, range.head)),
      write: points => {
        const active = new Set<number>()
        points.forEach((point, index) => {
          if (!point) return
          active.add(index)
          const entry = this.ensureEntry(index, point)
          if (this.typingTrail) {
            entry.ghosts.push(entry.anim.x, entry.anim.y, entry.anim.h, performance.now())
          } else {
            entry.ghosts.clear()
          }
          entry.anim.snap(point)
          entry.lastGhostX = point.x
          entry.lastGhostY = point.y
        })
        for (const [index, entry] of this.entries) {
          if (active.has(index)) continue
          entry.cursor.remove()
          entry.ghostEls.forEach(el => el.remove())
          this.entries.delete(index)
        }
        this.render(performance.now())
        this.instantNext = false
        this.typingTrail = false
        const ghostsAlive = [...this.entries.values()].some(
          entry => entry.ghosts.tick(performance.now()).length > 0,
        )
        if (ghostsAlive) this.start()
        else this.stop()
      },
    })
  }

  private start(): void {
    if (this.raf != null) return
    this.lastFrame = performance.now()
    this.raf = requestAnimationFrame(time => this.tick(time))
  }

  private stop(): void {
    if (this.raf != null) cancelAnimationFrame(this.raf)
    this.raf = null
  }

  private tick(time: number): void {
    this.raf = null
    this.lastFrame = time
    let ghostsAlive = false
    for (const entry of this.entries.values()) {
      if (entry.ghosts.tick(time).length > 0) ghostsAlive = true
    }
    this.render(time)
    if (ghostsAlive) this.start()
  }

  private styleElement(
    element: HTMLElement,
    entry: CursorEntry,
    x: number,
    y: number,
    h: number,
    opacity: number,
  ): void {
    const style = this.appearance.style
    const width = style === "bar" ? 2 : entry.anim.charWidth
    const height = style === "underline" ? 2 : h
    const offsetY = style === "underline" ? Math.max(0, h - height) : 0
    element.style.transform = `translate3d(${x}px, ${y + offsetY}px, 0)`
    element.style.width = `${Math.max(1, width)}px`
    element.style.height = `${Math.max(1, height)}px`
    element.style.opacity = String(opacity)
    element.style.borderRadius = style === "block" ? "2px" : "1px"
    element.style.background = "var(--gharargah-cursor-color, var(--gharargah-accent))"
  }

  private render(time: number): void {
    const focusOpacity = this.view.hasFocus ? 0.92 : 0.42
    for (const entry of this.entries.values()) {
      this.styleElement(entry.cursor, entry, entry.anim.x, entry.anim.y, entry.anim.h, focusOpacity)
      const ghosts = entry.ghosts.tick(time)
      entry.ghostEls.forEach((element, index) => {
        const ghost = ghosts[index]
        if (!ghost) {
          element.style.opacity = "0"
          return
        }
        this.styleElement(element, entry, ghost.x, ghost.y, ghost.h, ghost.opacity * focusOpacity)
      })
    }
  }

  destroy(): void {
    this.stop()
    this.unsubscribeReduced()
    this.rootObserver.disconnect()
    this.entries.clear()
    this.layer.remove()
  }
}

export function motionCursor(): Extension {
  return [
    EditorView.theme({
      "\.gharargah-editor-cursor-layer": {
        position: "absolute",
        inset: "0",
        zIndex: "30",
        pointerEvents: "none",
        overflow: "visible",
        WebkitBackfaceVisibility: "hidden",
        backfaceVisibility: "hidden",
      },
      "\.gharargah-editor-cursor-layer [data-gharargah-editor-cursor], \.gharargah-editor-cursor-layer [data-gharargah-editor-cursor-ghost]":
        {
          WebkitBackfaceVisibility: "hidden",
          backfaceVisibility: "hidden",
        },
      ".cm-cursor": {
        opacity: "0 !important",
      },
    }),
    ViewPlugin.fromClass(MotionCursorPlugin),
  ]
}
