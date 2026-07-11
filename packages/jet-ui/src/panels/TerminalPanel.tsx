import { useEffect, useRef, useState } from "react"
import { RotateCcw, Terminal as TerminalIcon, X } from "lucide-react"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import type { JetTheme } from "@jet/codemirror"
import "@xterm/xterm/css/xterm.css"
import { subscribeRootStyle } from "./root-style-observer.js"
import { Button } from "../components/ui/button.js"
import { TerminalCursorMotionLayer } from "./terminal-cursor-motion.js"
import { TerminalScrollMotion } from "./terminal-scroll-motion.js"

export type TerminalPanelProps = {
  cwdRootUri: string
  launchCommand?: string
  theme: JetTheme
  tabId: string
  focused: boolean
  isActive: boolean
  existingPtyId?: string
  status?: "starting" | "running" | "exited" | "failed"
  exitCode?: number
  sessionGeneration?: number
  onPtyId?: (tabId: string, ptyId: string | null) => void
  onTitleChange?: (tabId: string, title: string) => void
  onRestart?: () => void
  onClose?: () => void
  onFailed?: () => void
}

type TerminalSession = {
  term: XTerm
  fit: FitAddon
  ptyId: string | null
  cursorMotion: TerminalCursorMotionLayer | null
  scrollMotion: TerminalScrollMotion
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
  const ansi = theme.terminalAnsi
  return {
    background: c.bg,
    foreground: c.text,
    cursor: c.accent,
    selectionBackground: c.selection,
    black: ansi?.black,
    red: ansi?.red,
    green: ansi?.green,
    yellow: ansi?.yellow,
    blue: ansi?.blue,
    magenta: ansi?.magenta,
    cyan: ansi?.cyan,
    white: ansi?.white,
    brightBlack: ansi?.brightBlack,
    brightRed: ansi?.brightRed,
    brightGreen: ansi?.brightGreen,
    brightYellow: ansi?.brightYellow,
    brightBlue: ansi?.brightBlue,
    brightMagenta: ansi?.brightMagenta,
    brightCyan: ansi?.brightCyan,
    brightWhite: ansi?.brightWhite,
  }
}

function readCssVar(name: string): string | null {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value.length > 0 ? value : null
}

function liveThemeOptions(theme: JetTheme): NonNullable<XTerm["options"]["theme"]> {
  const options = themeOptions(theme)
  return {
    ...options,
    background: readCssVar("--jet-bg") ?? options.background,
    foreground: readCssVar("--jet-text") ?? options.foreground,
    cursor: readCssVar("--jet-accent") ?? options.cursor,
    selectionBackground: readCssVar("--jet-selection") ?? options.selectionBackground,
  }
}

function readTerminalBackground(theme: JetTheme): string {
  return readCssVar("--jet-bg") ?? theme.colors.bg
}

function readTerminalLineHeight(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--jet-terminal-line-height")
    .trim()
  const n = parseFloat(raw)
  return Number.isFinite(n) && n >= 1 ? n : 1.2
}

function readTerminalCursorBlink(): boolean {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--jet-terminal-cursor-blink")
    .trim()
  return raw !== "0"
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

function focusTerminalInput(tabId: string): void {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    `[data-jet-tab-slot="${tabId}"] [data-jet-terminal-panel] .xterm-helper-textarea`,
  )
  textarea?.focus()
}

export function TerminalPanel({
  cwdRootUri,
  launchCommand,
  theme,
  tabId,
  focused,
  isActive,
  existingPtyId,
  status = "starting",
  exitCode,
  sessionGeneration = 0,
  onPtyId,
  onTitleChange,
  onRestart,
  onClose,
  onFailed,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<TerminalSession | null>(null)
  const [displayStatus, setDisplayStatus] = useState(status)
  const [displayExitCode, setDisplayExitCode] = useState(exitCode)
  const [connectedPtyId, setConnectedPtyId] = useState<string | null>(existingPtyId ?? null)
  const themeRef = useRef(theme)
  themeRef.current = theme
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange
  const onFailedRef = useRef(onFailed)
  onFailedRef.current = onFailed

  useEffect(() => {
    const terminalApi = window.jet?.terminal
    if (!terminalApi || !cwdRootUri || !containerRef.current) return
    let cancelled = false
    const container = containerRef.current

    const term = new XTerm({
      theme: themeOptions(theme),
      fontSize: readRootFontSize(),
      fontFamily: readTerminalFontFamily(),
      lineHeight: readTerminalLineHeight(),
      cursorBlink: readTerminalCursorBlink(),
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)

    const screen = container.querySelector<HTMLElement>(".xterm-screen")
    const session: TerminalSession = {
      term,
      fit,
      ptyId: null,
      cursorMotion: screen ? new TerminalCursorMotionLayer(term, screen) : null,
      scrollMotion: new TerminalScrollMotion(term, container),
    }
    session.cursorMotion?.setActive(focused && isActive)
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
    const exitUnsubscribe = terminalApi.onExit((id, code) => {
      if (session.ptyId !== id) return
      setDisplayStatus("exited")
      setDisplayExitCode(code)
    })

    const syncFit = () => {
      if (cancelled || !fitWhenReady(session, container)) return false
      resizePty(session)
      return true
    }

    const syncTypography = () => {
      const px = readRootFontSize()
      const family = readTerminalFontFamily()
      const lineHeight = readTerminalLineHeight()
      const cursorBlink = readTerminalCursorBlink()
      let changed = false
      if (term.options.fontSize !== px) {
        term.options.fontSize = px
        changed = true
      }
      if (term.options.fontFamily !== family) {
        term.options.fontFamily = family
        changed = true
      }
      if (term.options.lineHeight !== lineHeight) {
        term.options.lineHeight = lineHeight
        changed = true
      }
      if (term.options.cursorBlink !== cursorBlink) {
        term.options.cursorBlink = cursorBlink
        changed = true
      }
      if (changed && syncFit()) term.refresh(0, term.rows - 1)
      session.cursorMotion?.refresh(changed)
    }

    const syncTheme = () => {
      term.options.theme = liveThemeOptions(themeRef.current)
      container.style.background = readTerminalBackground(themeRef.current)
      term.refresh(0, Math.max(0, term.rows - 1))
      session.cursorMotion?.refresh(false)
    }

    const connectPty = (id: string) => {
      session.ptyId = id
      setConnectedPtyId(id)
      setDisplayStatus("running")
      setDisplayExitCode(undefined)
      unsub = terminalApi.onData(id, data => term.write(data))
      dataDispose = term.onData(data => void terminalApi.write(id, data))
      syncFit()
      if (focused && isActive) focusTerminalInput(tabId)
    }

    const startPty = () => {
      if (ptyStarted || cancelled) return
      if (!syncFit()) {
        requestAnimationFrame(startPty)
        return
      }
      ptyStarted = true
      if (existingPtyId) {
        void terminalApi.attach(existingPtyId).then(attached => {
          if (cancelled) return
          if (!attached) {
            term.writeln("\r\n\x1b[31mTerminal session is no longer available.\x1b[0m")
            onFailedRef.current?.()
            return
          }
          if (attached.output) term.write(attached.output)
          if (attached.title) onTitleChangeRef.current?.(tabId, attached.title)
          connectPty(existingPtyId)
          if (attached.status === "exited") {
            setDisplayStatus("exited")
            setDisplayExitCode(attached.exitCode)
          }
        })
        return
      }
      void terminalApi
        .create(cwdRootUri, launchCommand ? { command: launchCommand } : undefined)
        .then(({ id, title }) => {
          if (cancelled) {
            void terminalApi.dispose(id)
            return
          }
          onPtyId?.(tabId, id)
          if (title) onTitleChangeRef.current?.(tabId, title)
          connectPty(id)
        })
        .catch(err => {
          const message = err instanceof Error ? err.message : String(err)
          term.writeln(`\r\n\x1b[31mTerminal failed to start:\x1b[0m ${message}`)
          onFailedRef.current?.()
        })
    }

    requestAnimationFrame(() => {
      syncTheme()
      syncTypography()
      syncFit()
      startPty()
    })

    const resizeObserver = new ResizeObserver(() => {
      if (syncFit()) term.refresh(0, term.rows - 1)
    })
    resizeObserver.observe(container)

    const unsubscribeRootStyleObserver = subscribeRootStyle(() => {
      syncTheme()
      syncTypography()
    })

    const visibilityObserver = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return
      requestAnimationFrame(() => {
        syncTypography()
        if (syncFit()) term.refresh(0, term.rows - 1)
        if (focused && isActive) focusTerminalInput(tabId)
      })
    })
    visibilityObserver.observe(container)

    return () => {
      cancelled = true
      resizeObserver.disconnect()
      unsubscribeRootStyleObserver()
      visibilityObserver.disconnect()
      titleDispose.dispose()
      exitUnsubscribe()
      dataDispose?.dispose()
      unsub?.()
      session.cursorMotion?.dispose()
      session.scrollMotion.dispose()
      term.dispose()
      sessionRef.current = null
    }
  }, [cwdRootUri, tabId, onPtyId, launchCommand, sessionGeneration])

  useEffect(() => {
    setDisplayStatus(status)
    setDisplayExitCode(exitCode)
  }, [status, exitCode, sessionGeneration])

  useEffect(() => {
    const session = sessionRef.current
    const container = containerRef.current
    if (!session || !container) return

    session.term.options.theme = liveThemeOptions(themeRef.current)
    container.style.background = readTerminalBackground(themeRef.current)
    session.cursorMotion?.setActive(focused && isActive)

    if (!focused || !isActive) return
    requestAnimationFrame(() => {
      if (fitWhenReady(session, container)) {
        resizePty(session)
        session.term.refresh(0, session.term.rows - 1)
      }
      focusTerminalInput(tabId)
    })
  }, [focused, isActive, theme, tabId])

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
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background"
      data-jet-terminal-panel=""
      data-jet-terminal-pty-id={connectedPtyId ?? ""}
      data-jet-terminal-status={displayStatus}
      onMouseDown={() => {
        focusTerminalInput(tabId)
      }}
    >
      <div
        ref={containerRef}
        className="jet-terminal-surface min-h-0 flex-1 overflow-hidden bg-background p-1.5"
      />
      {displayStatus === "exited" || displayStatus === "failed" ? (
        <div
          data-jet-terminal-exit-bar
          className="flex h-9 shrink-0 items-center gap-2 border-t border-border/70 bg-muted/35 px-2.5 text-xs text-muted-foreground"
        >
          <span className="min-w-0 flex-1 truncate">
            {displayStatus === "failed"
              ? "Terminal failed to start"
              : `Process exited${displayExitCode == null ? "" : ` with code ${displayExitCode}`}`}
          </span>
          <Button type="button" size="xs" variant="ghost" onClick={onRestart}>
            <RotateCcw className="size-3" />
            Restart
          </Button>
          <Button type="button" size="icon-xs" variant="ghost" aria-label="Close terminal" onClick={onClose}>
            <X className="size-3" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
