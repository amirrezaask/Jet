import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { RotateCcw } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"
import { Button } from "@/components/ui/button.js"
import { cn } from "@/lib/utils.js"
import { OpenInAppMenu, type OpenInAppId } from "./OpenInAppMenu.js"
import type { DesktopWindowPlatform } from "./GharargahWindowTitlebar.js"
import { SessionModeDock } from "./SessionModeDock.js"
import {
  SessionHeaderChromeProvider,
  sessionHeaderContextRef,
} from "./session-header-chrome.js"
import type { SessionProvider } from "./session-card-model.js"

export type SessionDialogMode =
  | "agent"
  | "terminal"
  | "editor"
  | "git"
  | "todos"

export type AgentSessionHeaderMeta = {
  threadTitle: string
  projectName?: string | null
  modelLabel?: string | null
}

export type SessionRuntimeStatus = "starting" | "running" | "exited" | "failed"

export type TerminalSessionModalProps = {
  sessionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  presentation?: "modal" | "inline"
  windowChrome?: {
    platform: DesktopWindowPlatform
    titlebarHeight: number
    trafficLights: boolean
  } | null
  title: string
  /** CLI binary running in the PTY (shown under title). */
  launchCommand?: string | null
  status?: SessionRuntimeStatus | null
  archivedAt?: string | null
  onResumeArchived?: () => void
  gitBranch?: string | null
  projectRootUri: string | null
  mode: SessionDialogMode
  onModeChange: (mode: SessionDialogMode) => void
  /** Whether this session has an agent surface (CLI or in-app chat). */
  showAgentTab?: boolean
  /** Drives Agent dock brand glyph (Codex/Claude/…). */
  agentId?: SessionProvider | null
  /** Merged into the session header when mode is agent. */
  agentSessionHeader?: AgentSessionHeaderMeta | null
  onOpenInApp?: (rootUri: string, appId: OpenInAppId) => void
  /** Extra controls before close (e.g. notification bell in sidebar layout). */
  headerEnd?: ReactNode
  agent: ReactNode
  editor: ReactNode
  terminal: ReactNode
  git: ReactNode
  todos: ReactNode
}

/** @deprecated Session list removed from dialog; keep export for test migration. */
export const TERMINAL_MODAL_SESSION_LIST_ID =
  "gharargah:terminal-modal-sessions"

function focusSessionPane(mode: SessionDialogMode) {
  if (mode === "agent") {
    document
      .querySelector<HTMLElement>(
        "[data-gharargah-session-pane='agent'] [data-testid='composer-editor']",
      )
      ?.focus()
    return
  }
  if (mode === "editor") {
    document
      .querySelector<HTMLElement>(
        "[data-gharargah-terminal-modal] [data-gharargah-editor-scroll-area] .monaco-editor textarea.inputarea",
      )
      ?.focus()
    return
  }
  if (mode === "git") {
    document
      .querySelector<HTMLElement>(
        "[data-gharargah-git-workspace] button:not([disabled]), [data-gharargah-git-workspace] select:not([disabled])",
      )
      ?.focus()
    return
  }
  if (mode === "todos") {
    document
      .querySelector<HTMLElement>(
        "[data-gharargah-todo-board] [data-gharargah-todo-column-add], [data-gharargah-todo-board] button",
      )
      ?.focus()
    return
  }
  document
    .querySelector<HTMLElement>(
      "[data-gharargah-terminal-modal] [data-gharargah-terminal-panel] .xterm-helper-textarea",
    )
    ?.focus()
}

function monacoWidgetOwnsEscape(
  activePane: Element | null,
  eventTarget: EventTarget | null,
): boolean {
  if (!activePane) return false
  const targetEditor =
    eventTarget instanceof Element ? eventTarget.closest(".monaco-editor") : null
  const activeEditor =
    document.activeElement instanceof Element
      ? document.activeElement.closest(".monaco-editor")
      : null
  const editor = targetEditor ?? activeEditor
  if (!editor || !activePane.contains(editor)) return false
  return editor.querySelector(
    [
      '.suggest-widget[monaco-visible-content-widget="true"]',
      ".parameter-hints-widget.visible",
      ".rename-box.visible",
      ".find-widget.visible",
      ".zone-widget",
    ].join(","),
  ) != null
}

export function TerminalSessionModal(props: TerminalSessionModalProps) {
  const monacoEscapeOwnedRef = useRef(false)
  const [headerContextEl, setHeaderContextEl] = useState<HTMLElement | null>(
    null,
  )
  const {
    sessionId,
    open,
    onOpenChange,
    presentation = "modal",
    windowChrome = null,
    title,
    launchCommand: _launchCommand,
    status: _status = null,
    archivedAt = null,
    onResumeArchived,
    gitBranch: _gitBranch,
    projectRootUri,
    mode,
    onModeChange,
    showAgentTab = false,
    agentId = null,
    agentSessionHeader = null,
    onOpenInApp,
    headerEnd = null,
    agent,
    editor,
    terminal,
    git,
    todos,
  } = props

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => focusSessionPane(mode))
    return () => cancelAnimationFrame(frame)
  }, [open, mode])

  useEffect(() => {
    if (!open || presentation !== "modal" || mode !== "editor") return
    const captureMonacoEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      const activePane = document.querySelector(
        '[data-gharargah-session-pane="editor"][data-active]',
      )
      monacoEscapeOwnedRef.current = monacoWidgetOwnsEscape(activePane, event.target)
    }
    // Radix observes Escape at document capture, before React capture handlers.
    // Window capture records Monaco ownership first without blocking Monaco.
    window.addEventListener("keydown", captureMonacoEscape, true)
    return () => window.removeEventListener("keydown", captureMonacoEscape, true)
  }, [open, presentation, mode])

  if (!open) return null

  const showAgentMeta = mode === "agent" && agentSessionHeader
  const ownsWindowChrome = presentation === "modal" && windowChrome != null
  const dragRegion = ownsWindowChrome
    ? ({ WebkitAppRegion: "drag" } as CSSProperties)
    : undefined
  const noDragRegion = ownsWindowChrome
    ? ({ WebkitAppRegion: "no-drag" } as CSSProperties)
    : undefined
  const headerStyle = ownsWindowChrome
    ? ({
        ...dragRegion,
        height: `${windowChrome.titlebarHeight}px`,
        minHeight: `${windowChrome.titlebarHeight}px`,
      } as CSSProperties)
    : undefined
  const displayTitle = showAgentMeta ? agentSessionHeader.threadTitle : title
  const showVisibleTitle = mode === "agent"

  const sessionHeader = (
    <DialogHeader
      data-gharargah-terminal-modal-header=""
      {...(showAgentMeta ? { "data-chat-header": "true" } : {})}
      data-gharargah-window-drag-region={ownsWindowChrome ? "" : undefined}
      className={cn(
        "flex flex-row shrink-0 items-center gap-2 border-b bg-background px-2.5 py-0 text-left sm:text-left",
        !ownsWindowChrome && "h-10",
      )}
      style={headerStyle}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-1.5",
          showVisibleTitle ? "max-w-[42%] shrink" : "shrink-0",
        )}
      >
        {windowChrome?.trafficLights && ownsWindowChrome ? (
          <div
            aria-hidden
            data-gharargah-traffic-light-spacer=""
            style={dragRegion}
          />
        ) : null}
        <h2
          data-gharargah-terminal-modal-title
          className={cn(
            showVisibleTitle
              ? "min-w-0 truncate text-xs font-semibold tracking-tight text-foreground"
              : "sr-only",
          )}
        >
          {displayTitle}
        </h2>
      </div>

      <div
        ref={sessionHeaderContextRef(setHeaderContextEl)}
        data-gharargah-session-header-context=""
        className="flex min-h-0 min-w-0 flex-1 items-center overflow-hidden"
        style={noDragRegion}
      />

      <div
        className="flex shrink-0 items-center gap-0.5"
        style={noDragRegion}
      >
        {projectRootUri && onOpenInApp ? (
          <OpenInAppMenu
            rootUri={projectRootUri}
            onOpenInApp={onOpenInApp}
            data-gharargah-open-in-app="modal"
            className="h-6 gap-0.5 px-1 text-muted-foreground hover:text-foreground"
          />
        ) : null}
        {headerEnd}
        {archivedAt && onResumeArchived ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={onResumeArchived}
            data-gharargah-session-resume-archived=""
            title="Resume archived session"
          >
            <RotateCcw aria-hidden data-icon="inline-start" />
            <span className="hidden min-[720px]:inline">Resume</span>
          </Button>
        ) : null}
      </div>
    </DialogHeader>
  )

  const modeDock = (
    <div
      data-gharargah-session-mode-dock-host=""
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-3"
    >
      <SessionModeDock
        mode={mode}
        onModeChange={onModeChange}
        showAgentTab={showAgentTab}
        agentId={agentId}
      />
    </div>
  )

  const stage = (
    <SessionHeaderChromeProvider target={headerContextEl}>
      {sessionHeader}
      <div
        data-gharargah-terminal-modal-body=""
        data-gharargah-session-dock-inset=""
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden overscroll-contain"
      >
        {showAgentTab ? (
          <div
            id="gharargah-session-pane-agent"
            role="tabpanel"
            aria-labelledby="gharargah-session-tab-agent"
            data-gharargah-terminal-modal-stage=""
            data-gharargah-session-pane="agent"
            data-active={mode === "agent" ? "" : undefined}
            hidden={mode !== "agent"}
            aria-hidden={mode !== "agent"}
            className={cn(
              "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background",
              mode === "agent" ? "z-10" : "pointer-events-none z-0",
            )}
          >
            {mode === "agent" ? agent : null}
          </div>
        ) : null}
        <div
          id="gharargah-session-pane-editor"
          role="tabpanel"
          aria-labelledby="gharargah-session-tab-editor"
          data-gharargah-terminal-modal-stage=""
          data-gharargah-session-pane="editor"
          data-active={mode === "editor" ? "" : undefined}
          hidden={mode !== "editor"}
          aria-hidden={mode !== "editor"}
          className={cn(
            "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background",
            mode === "editor" ? "z-10" : "pointer-events-none z-0",
          )}
        >
          {editor}
        </div>
        <div
          id="gharargah-session-pane-terminal"
          role="tabpanel"
          aria-labelledby="gharargah-session-tab-terminal"
          data-gharargah-terminal-modal-stage=""
          data-gharargah-session-pane="terminal"
          data-active={mode === "terminal" ? "" : undefined}
          hidden={mode !== "terminal"}
          aria-hidden={mode !== "terminal"}
          className={cn(
            "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background",
            mode === "terminal" ? "z-10" : "pointer-events-none z-0",
          )}
        >
          {terminal}
        </div>
        <div
          id="gharargah-session-pane-git"
          role="tabpanel"
          aria-labelledby="gharargah-session-tab-git"
          data-gharargah-terminal-modal-stage=""
          data-gharargah-session-pane="git"
          data-active={mode === "git" ? "" : undefined}
          hidden={mode !== "git"}
          aria-hidden={mode !== "git"}
          className={cn(
            "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background",
            mode === "git" ? "z-10" : "pointer-events-none z-0",
          )}
        >
          {mode === "git" ? git : null}
        </div>
        <div
          id="gharargah-session-pane-todos"
          role="tabpanel"
          aria-labelledby="gharargah-session-tab-todos"
          data-gharargah-terminal-modal-stage=""
          data-gharargah-session-pane="todos"
          data-active={mode === "todos" ? "" : undefined}
          hidden={mode !== "todos"}
          aria-hidden={mode !== "todos"}
          className={cn(
            "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background",
            mode === "todos" ? "z-10" : "pointer-events-none z-0",
          )}
        >
          {mode === "todos" ? todos : null}
        </div>
        {modeDock}
      </div>
    </SessionHeaderChromeProvider>
  )

  if (presentation === "inline") {
    return (
      <section
        data-gharargah-glass=""
        data-gharargah-terminal-modal
        data-gharargah-session-id={sessionId}
        data-gharargah-session-presentation="inline"
        data-gharargah-session-mode={mode}
        aria-label={displayTitle}
        className="flex h-full min-h-0 w-full flex-col gap-0 overflow-hidden bg-background"
      >
        {stage}
      </section>
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        size="stage"
        showCloseButton={false}
        onInteractOutside={event => event.preventDefault()}
        onEscapeKeyDown={event => {
          if (monacoEscapeOwnedRef.current) {
            monacoEscapeOwnedRef.current = false
            event.preventDefault()
            return
          }
          const activePane = document.querySelector(
            `[data-gharargah-session-pane="${mode}"][data-active]`,
          )
          // Radix observes Escape before Monaco's textarea receives it. Keep
          // the session mounted while Monaco dismisses its active widget.
          if (mode === "editor" && monacoWidgetOwnsEscape(activePane, event.target)) {
            event.preventDefault()
            return
          }
          const visibleTerminal =
            activePane?.querySelector<HTMLElement>(
              "[data-gharargah-session-terminal-pane][data-active] [data-gharargah-terminal-panel]",
            ) ??
            activePane?.querySelector<HTMLElement>(
              "[data-gharargah-terminal-panel]",
            )
          if (!visibleTerminal) return
          event.preventDefault()
          if (
            event.target instanceof Element &&
            event.target.closest(".xterm")
          ) {
            return
          }
          visibleTerminal
            .querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")
            ?.focus()
          const ptyId = visibleTerminal.dataset.gharargahTerminalPtyId
          if (ptyId) {
            void window.gharargah?.terminal?.write(ptyId, "\u001b")
          }
        }}
        data-gharargah-glass=""
        data-gharargah-terminal-modal
        data-gharargah-session-id={sessionId}
        data-gharargah-session-presentation="modal"
        data-gharargah-session-mode={mode}
        className="flex flex-col gap-0 overflow-hidden border bg-background p-0 shadow-xl"
        aria-describedby={undefined}
        onOpenAutoFocus={event => {
          event.preventDefault()
          requestAnimationFrame(() => focusSessionPane(mode))
        }}
      >
        <DialogTitle className="sr-only">{displayTitle}</DialogTitle>
        {stage}
      </DialogContent>
    </Dialog>
  )
}
