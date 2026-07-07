import { useEffect, useRef } from "react"
import { Terminal as TerminalIcon } from "lucide-react"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import type { JetTheme } from "@jet/codemirror"
import "@xterm/xterm/css/xterm.css"

export type TerminalPanelProps = {
  cwdRootUri: string
  theme: JetTheme
  tabId: string
  focused: boolean
  isActive: boolean
  onPtyId?: (tabId: string, ptyId: string | null) => void
  onTitleChange?: (tabId: string, title: string) => void
}

type TerminalSession = {
  term: XTerm
  fit: FitAddon
  ptyId: string | null
}

const MONO_FONT_FALLBACK =
  '"Geist Mono Variable", "Geist Mono", "IBM Plex Mono", "SFMono-Regular", Menlo, monospace'

function readRootFontSize(): number {
  const px = parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(px) && px > 0 ? px : 13
}

/** xterm measures via canvas — CSS var() in fontFamily breaks cell metrics. */
function readTerminalFontFamily(): string {
  const fromTheme = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim()
  return fromTheme || MONO_FONT_FALLBACK
}

function cellMetricsValid(term: XTerm): boolean {
  const dims = (term as XTerm & { _core?: { _renderService?: { dimensions?: { css?: { cell?: { width?: number; height?: number } } } } } })
    ._core?._renderService?.dimensions?.css?.cell
  if (!dims) return term.cols > 0 && term.rows > 0
  return (dims.width ?? 0) >= 4 && (dims.height ?? 0) >= 4
}

function themeOptions(theme: JetTheme): NonNullable<XTerm["options"]["theme"]> {
  const c = theme.colors
  return {
    background: c.bg,
    foreground: c.text,
    cursor: c.accent,
    selectionBackground: c.selection,
  }
}

function fitWhenReady(session: TerminalSession, container: HTMLElement): boolean {
  if (container.clientWidth < 8 || container.clientHeight < 8) return false
  session.fit.fit()
  if (!cellMetricsValid(session.term)) return false
  return session.term.cols > 0 && session.term.rows > 0
}

function resizePty(session: TerminalSession): void {
  if (!session.ptyId) return
  void window.jet?.terminal?.resize(session.ptyId, session.term.cols, session.term.rows)
}

function focusTerminalInput(): void {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    "[data-jet-tab-slot][data-jet-tab-active] [data-jet-terminal-panel] .xterm-helper-textarea",
  )
  textarea?.focus()
}

export function TerminalPanel({
  cwdRootUri,
  theme,
  tabId,
  focused,
  isActive,
  onPtyId,
  onTitleChange,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<TerminalSession | null>(null)
  const themeRef = useRef(theme)
  themeRef.current = theme
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange

  useEffect(() => {
    const terminalApi = window.jet?.terminal
    if (!terminalApi || !cwdRootUri || !containerRef.current) return
    let cancelled = false
    const container = containerRef.current

    const term = new XTerm({
      theme: themeOptions(theme),
      fontSize: readRootFontSize(),
      fontFamily: readTerminalFontFamily(),
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)

    const session: TerminalSession = { term, fit, ptyId: null }
    sessionRef.current = session

    const titleDispose = term.onTitleChange(raw => {
      const title = raw.trim()
      if (!title) return
      onTitleChangeRef.current?.(
        tabId,
        title.length > 80 ? `${title.slice(0, 77)}…` : title,
      )
    })

    let unsub: (() => void) | null = null
    let dataDispose: { dispose: () => void } | null = null
    let ptyStarted = false

    const syncFit = () => {
      if (cancelled || !fitWhenReady(session, container)) return false
      resizePty(session)
      return true
    }

    const syncTypography = () => {
      const px = readRootFontSize()
      const family = readTerminalFontFamily()
      let changed = false
      if (term.options.fontSize !== px) {
        term.options.fontSize = px
        changed = true
      }
      if (term.options.fontFamily !== family) {
        term.options.fontFamily = family
        changed = true
      }
      if (changed && syncFit()) term.refresh(0, term.rows - 1)
    }

    const startPty = () => {
      if (ptyStarted || cancelled) return
      if (!syncFit()) {
        requestAnimationFrame(startPty)
        return
      }
      ptyStarted = true
      void terminalApi
        .create(cwdRootUri)
        .then(({ id }) => {
          if (cancelled) {
            void terminalApi.dispose(id)
            return
          }
          session.ptyId = id
          onPtyId?.(tabId, id)
          unsub = terminalApi.onData(id, data => term.write(data))
          dataDispose = term.onData(data => void terminalApi.write(id, data))
          syncFit()
          if (focused && isActive) focusTerminalInput()
        })
        .catch(err => {
          const message = err instanceof Error ? err.message : String(err)
          term.writeln(`\r\n\x1b[31mTerminal failed to start:\x1b[0m ${message}`)
        })
    }

    requestAnimationFrame(() => {
      syncTypography()
      syncFit()
      startPty()
    })

    const resizeObserver = new ResizeObserver(() => {
      if (syncFit()) term.refresh(0, term.rows - 1)
    })
    resizeObserver.observe(container)

    const fontObserver = new MutationObserver(() => syncTypography())
    fontObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    })

    const visibilityObserver = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return
      requestAnimationFrame(() => {
        syncTypography()
        if (syncFit()) term.refresh(0, term.rows - 1)
        if (focused && isActive) focusTerminalInput()
      })
    })
    visibilityObserver.observe(container)

    return () => {
      cancelled = true
      resizeObserver.disconnect()
      fontObserver.disconnect()
      visibilityObserver.disconnect()
      titleDispose.dispose()
      dataDispose?.dispose()
      unsub?.()
      if (session.ptyId) {
        void terminalApi.dispose(session.ptyId)
        onPtyId?.(tabId, null)
      }
      term.dispose()
      sessionRef.current = null
    }
  }, [cwdRootUri, tabId, onPtyId])

  useEffect(() => {
    const session = sessionRef.current
    const container = containerRef.current
    if (!session || !container) return

    session.term.options.theme = themeOptions(themeRef.current)

    if (!focused || !isActive) return
    requestAnimationFrame(() => {
      if (fitWhenReady(session, container)) {
        resizePty(session)
        session.term.refresh(0, session.term.rows - 1)
      }
      focusTerminalInput()
    })
  }, [focused, isActive, theme])

  if (!window.jet?.terminal) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 text-[var(--jet-text-muted)]"
        role="region"
        aria-label="Terminal"
        data-jet-terminal-panel=""
      >
        <TerminalIcon className="size-8 opacity-40" />
        <p className="text-sm">Integrated terminal</p>
        <p className="max-w-xs text-center text-xs opacity-70">
          Terminal requires Electron (node-pty + xterm). Browser mode shows this placeholder.
        </p>
      </div>
    )
  }

  return (
    <div
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
      data-jet-terminal-panel=""
      onMouseDown={e => {
        e.stopPropagation()
        focusTerminalInput()
      }}
    >
      <div
        ref={containerRef}
        className="jet-terminal-surface min-h-0 flex-1 overflow-hidden p-1"
        style={{ background: theme.colors.bg }}
      />
    </div>
  )
}
