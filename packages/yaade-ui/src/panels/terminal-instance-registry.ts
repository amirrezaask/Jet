import type { Terminal } from "@xterm/xterm"

const instances = new Map<string, Terminal>()

export function registerTerminalInstance(tabId: string, term: Terminal): void {
  instances.set(tabId, term)
}

export function unregisterTerminalInstance(tabId: string, term?: Terminal): void {
  if (term && instances.get(tabId) !== term) return
  instances.delete(tabId)
}

function resolveTerminal(tabId?: string): Terminal | undefined {
  if (tabId) return instances.get(tabId)
  // Prefer the focused/running panel when no tab id is given.
  const running = document.querySelector<HTMLElement>(
    '[data-yaade-terminal-panel][data-yaade-terminal-status="running"]',
  )
  const fromDom = running?.dataset.yaadeTerminalTabId
  if (fromDom && instances.has(fromDom)) return instances.get(fromDom)
  const last = [...instances.values()]
  return last[last.length - 1]
}

/**
 * Buffer-backed terminal text for E2E / agent bridge.
 * WebGL/Canvas renderers do not keep readable `.xterm-rows` DOM text.
 */
export function readTerminalBufferText(tabId?: string): string {
  const term = resolveTerminal(tabId)
  if (!term) return ""
  const buf = term.buffer.active
  // Tail the buffer — markers in benches/E2E land near the bottom.
  const keep = Math.max(term.rows * 8, 200)
  const start = Math.max(0, buf.length - keep)
  const lines: string[] = []
  for (let i = start; i < buf.length; i++) {
    const line = buf.getLine(i)
    if (line) lines.push(line.translateToString(true))
  }
  return lines.join("\n")
}

export function readTerminalDims(
  tabId?: string,
): { cols: number; rows: number } | null {
  const term = resolveTerminal(tabId)
  if (!term) return null
  return { cols: term.cols, rows: term.rows }
}

export function readTerminalCursor(
  tabId?: string,
): { x: number; y: number; hidden: boolean } | null {
  const term = resolveTerminal(tabId)
  if (!term) return null
  const buf = term.buffer.active
  const core = (
    term as Terminal & {
      _core?: { _coreService?: { isCursorHidden?: boolean }; coreService?: { isCursorHidden?: boolean } }
    }
  )._core
  const hidden =
    core?._coreService?.isCursorHidden === true ||
    core?.coreService?.isCursorHidden === true
  return {
    x: buf.cursorX,
    y: buf.cursorY,
    hidden,
  }
}

/** Cell height in CSS px from the active renderer, or 0 when unavailable. */
export function readTerminalCellHeight(tabId?: string): number {
  const term = resolveTerminal(tabId)
  if (!term) return 0
  const dims = (
    term as Terminal & {
      _core?: {
        _renderService?: { dimensions?: { css?: { cell?: { height?: number } } } }
      }
    }
  )._core?._renderService?.dimensions?.css?.cell
  const height = dims?.height ?? 0
  if (height >= 4) return height
  const canvas = document
    .querySelector<HTMLElement>(
      tabId
        ? `[data-yaade-terminal-panel][data-yaade-terminal-tab-id="${tabId}"] canvas`
        : "[data-yaade-terminal-panel] canvas",
    )
  if (canvas && term.rows > 0) {
    const rect = canvas.getBoundingClientRect()
    if (rect.height > 0) return rect.height / term.rows
  }
  return 0
}
