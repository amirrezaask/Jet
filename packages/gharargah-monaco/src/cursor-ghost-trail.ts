import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import {
  CaretGhostCompositor,
  GHOST_MAX,
  onReducedMotionChange,
  prefersReducedMotion,
  type CaretGhostVisual,
  type CaretPoint,
} from "@gharargah/shared"

type CursorStyle = "bar" | "block" | "underline"
type CursorMotion = "trail" | "smooth" | "off"

function setting<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim() as T
  return allowed.includes(value) ? value : fallback
}

function readAppearance(): { style: CursorStyle; motion: CursorMotion } {
  return {
    style: setting("--gharargah-cursor-style", ["bar", "block", "underline"], "bar"),
    motion: setting("--gharargah-cursor-motion", ["trail", "smooth", "off"], "trail"),
  }
}

function moved(a: CaretPoint | null, b: CaretPoint | null): boolean {
  if (!a || !b) return false
  return Math.abs(a.x - b.x) > 0.25 || Math.abs(a.y - b.y) > 0.25
}

/**
 * Adds a ghost-only trail to Monaco. Monaco keeps ownership of the live caret,
 * including blinking, IME behavior, multiple selections, and accessibility.
 */
export class MonacoCursorGhostTrail {
  private readonly layer = document.createElement("div")
  private readonly ghostElements = Array.from({ length: GHOST_MAX }, () =>
    document.createElement("div"),
  )
  private readonly trail = new CaretGhostCompositor(this.ghostElements)
  private readonly disposables: monaco.IDisposable[] = []
  private readonly rootObserver: MutationObserver
  private readonly unsubscribeReducedMotion: () => void
  private previous: CaretPoint | null = null
  private reduced = prefersReducedMotion()
  private appearance = readAppearance()

  constructor(private readonly editor: monaco.editor.ICodeEditor) {
    this.layer.dataset.gharargahMonacoCursorTrail = ""
    Object.assign(this.layer.style, {
      position: "absolute",
      inset: "0",
      zIndex: "7",
      pointerEvents: "none",
      overflow: "hidden",
    })
    for (const ghost of this.ghostElements) {
      ghost.dataset.gharargahMonacoCursorGhost = ""
      Object.assign(ghost.style, {
        position: "absolute",
        top: "0",
        left: "0",
        pointerEvents: "none",
        background: "var(--gharargah-cursor-color, var(--gharargah-accent))",
      })
      this.layer.appendChild(ghost)
    }
    editor.getDomNode()?.appendChild(this.layer)

    this.disposables.push(
      editor.onDidChangeCursorPosition(() => this.sync(false)),
      editor.onDidFocusEditorText(() => this.sync(true)),
      editor.onDidBlurEditorText(() => this.clear()),
      editor.onDidScrollChange(() => this.sync(true)),
      editor.onDidLayoutChange(() => this.sync(true)),
      editor.onDidChangeModel(() => this.sync(true)),
    )
    this.unsubscribeReducedMotion = onReducedMotionChange(reduced => {
      this.reduced = reduced
      this.sync(true)
    })
    this.rootObserver = new MutationObserver(() => {
      this.appearance = readAppearance()
      this.sync(true)
    })
    this.rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    })
    this.sync(true)
  }

  private point(): CaretPoint | null {
    const position = this.editor.getPosition()
    if (!position) return null
    const visible = this.editor.getScrolledVisiblePosition(position)
    if (!visible) return null
    const layout = this.editor.getLayoutInfo()
    if (
      visible.left < 0 ||
      visible.top < 0 ||
      visible.left > layout.width ||
      visible.top > layout.height
    ) return null
    const fontInfo = this.editor.getOption(monaco.editor.EditorOption.fontInfo)
    return {
      x: visible.left,
      y: visible.top,
      h: visible.height,
      charWidth: Math.max(1, fontInfo.typicalHalfwidthCharacterWidth),
    }
  }

  private visual(point: CaretPoint): CaretGhostVisual {
    const style = this.appearance.style
    const width = style === "bar" ? 2 : point.charWidth
    const height = style === "underline" ? 2 : point.h
    return {
      x: point.x,
      y: point.y + (style === "underline" ? Math.max(0, point.h - height) : 0),
      width,
      height,
      opacity: 0.26,
      borderRadius: style === "block" ? "2px" : "1px",
    }
  }

  private sync(snap: boolean): void {
    const next = this.editor.hasTextFocus() ? this.point() : null
    if (
      !snap &&
      !this.reduced &&
      this.appearance.motion === "trail" &&
      moved(this.previous, next)
    ) {
      this.trail.push(this.visual(this.previous!))
    } else if (snap || this.reduced || this.appearance.motion !== "trail") {
      this.trail.clear()
    }
    this.previous = next
  }

  private clear(): void {
    this.previous = null
    this.trail.clear()
  }

  dispose(): void {
    this.clear()
    this.unsubscribeReducedMotion()
    this.rootObserver.disconnect()
    for (const disposable of this.disposables) disposable.dispose()
    this.trail.dispose()
    this.layer.remove()
  }
}
