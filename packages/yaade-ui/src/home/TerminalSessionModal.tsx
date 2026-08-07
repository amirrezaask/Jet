import { useEffect, useRef, useState, type ReactNode } from "react"
import { RotateCcw } from "lucide-react"
import type { PanelId } from "@yaade/shared"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"
import { Button } from "@/components/ui/button.js"
import { cn } from "@/lib/utils.js"
import { OpenInAppMenu, type OpenInAppId } from "./OpenInAppMenu.js"
import { SessionModeDock } from "./SessionModeDock.js"
import {
  SessionHeaderChromeProvider,
  sessionHeaderContextRef,
} from "./session-header-chrome.js"
import type { SessionProvider } from "./session-card-model.js"
import { SessionPaneChrome } from "../dock/SessionPaneChrome.js"
import type { TabStore } from "../tabs/registry.js"

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

/** Clears the floating mode dock; keep in sync with `--yaade-session-dock-clearance`. */
const SESSION_STAGE_CLASS =
  "absolute inset-x-0 top-0 bottom-[length:var(--yaade-session-dock-clearance,3.75rem)] flex min-h-0 min-w-0 flex-col overflow-hidden bg-transparent"

export type TerminalSessionModalProps = {
  sessionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  presentation?: "modal" | "inline"
  /** Nested inside a session window leaf — omit outer glass chrome (leaf provides it). */
  embedded?: boolean
  /** Required when embedded — tiling DnD + close live on the pane titlebar. */
  panelId?: PanelId | null
  tabStore?: TabStore | null
  paneFocused?: boolean
  onHideSession?: () => void
  title: string
  /** CLI binary running in the PTY (shown under title). */
  launchCommand?: string | null
  status?: SessionRuntimeStatus | null
  archivedAt?: string | null
  onResumeArchived?: () => void
  gitBranch?: string | null
  projectRootUri: string | null
  /** Project folder name for collapsing cwd titles in the pane chrome. */
  projectName?: string | null
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
  "yaade:terminal-modal-sessions"

function focusSessionPane(mode: SessionDialogMode) {
  if (mode === "agent") {
    document
      .querySelector<HTMLElement>(
        "[data-yaade-session-pane='agent'] [data-testid='composer-editor']",
      )
      ?.focus()
    return
  }
  if (mode === "editor") {
    document
      .querySelector<HTMLElement>(
        "[data-yaade-terminal-modal] [data-yaade-editor-scroll-area] .monaco-editor textarea.inputarea",
      )
      ?.focus()
    return
  }
  if (mode === "git") {
    document
      .querySelector<HTMLElement>(
        "[data-yaade-git-workspace] button:not([disabled]), [data-yaade-git-workspace] select:not([disabled])",
      )
      ?.focus()
    return
  }
  if (mode === "todos") {
    document
      .querySelector<HTMLElement>(
        "[data-yaade-todo-board] [data-yaade-todo-column-add], [data-yaade-todo-board] button",
      )
      ?.focus()
    return
  }
  document
    .querySelector<HTMLElement>(
      "[data-yaade-terminal-modal] [data-yaade-terminal-panel] .xterm-helper-textarea",
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
    embedded = false,
    panelId = null,
    tabStore = null,
    paneFocused = false,
    onHideSession,
    title,
    launchCommand: _launchCommand,
    status: _status = null,
    archivedAt = null,
    onResumeArchived,
    gitBranch: _gitBranch,
    projectRootUri,
    projectName = null,
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
        '[data-yaade-session-pane="editor"][data-active]',
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
  const displayTitle = showAgentMeta ? agentSessionHeader.threadTitle : title
  // Embedded panes use SessionPaneChrome for the visible title.
  const showVisibleTitle = !embedded && mode === "agent"
  const usePaneTitlebar = embedded && panelId != null && tabStore != null

  const headerTrailing = (
    <>
      {projectRootUri && onOpenInApp ? (
        <OpenInAppMenu
          rootUri={projectRootUri}
          onOpenInApp={onOpenInApp}
          data-yaade-open-in-app="modal"
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
          data-yaade-session-resume-archived=""
          title="Resume archived session"
        >
          <RotateCcw aria-hidden data-icon="inline-start" />
          <span className="hidden min-[720px]:inline">Resume</span>
        </Button>
      ) : null}
    </>
  )

  const sessionHeader = usePaneTitlebar ? (
    <SessionPaneChrome
      panelId={panelId}
      tabId={sessionId}
      store={tabStore}
      projectName={projectName}
      focused={paneFocused}
      onClose={() => onHideSession?.()}
      trailing={headerTrailing}
      contextRef={sessionHeaderContextRef(setHeaderContextEl)}
    />
  ) : (
    <DialogHeader
      data-yaade-terminal-modal-header=""
      {...(showAgentMeta ? { "data-chat-header": "true" } : {})}
      className={cn(
        "flex h-10 flex-row shrink-0 items-center gap-2 border-b border-transparent bg-transparent px-2.5 py-0 text-left sm:text-left",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-1.5",
          showVisibleTitle ? "max-w-[42%] shrink" : "shrink-0",
        )}
      >
        <h2
          data-yaade-terminal-modal-title
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
        data-yaade-session-header-context=""
        className="flex min-h-0 min-w-0 flex-1 items-center overflow-hidden"
      />

      <div className="flex shrink-0 items-center gap-0.5">
        {headerTrailing}
      </div>
    </DialogHeader>
  )

  const modeDock = (
    <div
      data-yaade-session-mode-dock-host=""
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
        data-yaade-terminal-modal-body=""
        data-yaade-session-dock-inset=""
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden overscroll-contain"
      >
        {showAgentTab ? (
          <div
            id="yaade-session-pane-agent"
            role="tabpanel"
            aria-labelledby="yaade-session-tab-agent"
            data-yaade-terminal-modal-stage=""
            data-yaade-session-pane="agent"
            data-active={mode === "agent" ? "" : undefined}
            hidden={mode !== "agent"}
            aria-hidden={mode !== "agent"}
            className={cn(
              SESSION_STAGE_CLASS,
              mode === "agent" ? "z-10" : "pointer-events-none z-0",
            )}
          >
            {mode === "agent" ? agent : null}
          </div>
        ) : null}
        <div
          id="yaade-session-pane-editor"
          role="tabpanel"
          aria-labelledby="yaade-session-tab-editor"
          data-yaade-terminal-modal-stage=""
          data-yaade-session-pane="editor"
          data-active={mode === "editor" ? "" : undefined}
          hidden={mode !== "editor"}
          aria-hidden={mode !== "editor"}
          className={cn(
            SESSION_STAGE_CLASS,
            mode === "editor" ? "z-10" : "pointer-events-none z-0",
          )}
        >
          {mode === "editor" ? editor : null}
        </div>
        <div
          id="yaade-session-pane-terminal"
          role="tabpanel"
          aria-labelledby="yaade-session-tab-terminal"
          data-yaade-terminal-modal-stage=""
          data-yaade-session-pane="terminal"
          data-active={mode === "terminal" ? "" : undefined}
          hidden={mode !== "terminal"}
          aria-hidden={mode !== "terminal"}
          className={cn(
            SESSION_STAGE_CLASS,
            mode === "terminal" ? "z-10" : "pointer-events-none z-0",
          )}
        >
          {mode === "terminal" ? terminal : null}
        </div>
        <div
          id="yaade-session-pane-git"
          role="tabpanel"
          aria-labelledby="yaade-session-tab-git"
          data-yaade-terminal-modal-stage=""
          data-yaade-session-pane="git"
          data-active={mode === "git" ? "" : undefined}
          hidden={mode !== "git"}
          aria-hidden={mode !== "git"}
          className={cn(
            SESSION_STAGE_CLASS,
            mode === "git" ? "z-10" : "pointer-events-none z-0",
          )}
        >
          {mode === "git" ? git : null}
        </div>
        <div
          id="yaade-session-pane-todos"
          role="tabpanel"
          aria-labelledby="yaade-session-tab-todos"
          data-yaade-terminal-modal-stage=""
          data-yaade-session-pane="todos"
          data-active={mode === "todos" ? "" : undefined}
          hidden={mode !== "todos"}
          aria-hidden={mode !== "todos"}
          className={cn(
            SESSION_STAGE_CLASS,
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
        data-yaade-terminal-modal
        data-yaade-session-id={sessionId}
        data-yaade-session-presentation="inline"
        data-yaade-session-embedded={embedded ? "" : undefined}
        data-yaade-session-mode={mode}
        aria-label={displayTitle}
        className={cn(
          "flex h-full min-h-0 w-full flex-col gap-0 overflow-hidden bg-transparent",
          embedded && "border-0 shadow-none",
        )}
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
            `[data-yaade-session-pane="${mode}"][data-active]`,
          )
          // Radix observes Escape before Monaco's textarea receives it. Keep
          // the session mounted while Monaco dismisses its active widget.
          if (mode === "editor" && monacoWidgetOwnsEscape(activePane, event.target)) {
            event.preventDefault()
            return
          }
          const visibleTerminal =
            activePane?.querySelector<HTMLElement>(
              "[data-yaade-session-terminal-pane][data-active] [data-yaade-terminal-panel]",
            ) ??
            activePane?.querySelector<HTMLElement>(
              "[data-yaade-terminal-panel]",
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
          const ptyId = visibleTerminal.dataset.yaadeTerminalPtyId
          if (ptyId) {
            void window.yaade?.terminal?.write(ptyId, "\u001b")
          }
        }}
        data-yaade-terminal-modal
        data-yaade-session-id={sessionId}
        data-yaade-session-presentation="modal"
        data-yaade-session-mode={mode}
        motion="instant"
        className="flex flex-col gap-0 overflow-hidden border-transparent bg-transparent p-0 shadow-none"
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
