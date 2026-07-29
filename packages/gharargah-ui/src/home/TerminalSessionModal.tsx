import { useEffect, type ReactNode } from "react"
import type { AgentUsage } from "@gharargah/agents"
import { GitBranch, XIcon } from "lucide-react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"
import { Button } from "@/components/ui/button.js"
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.js"
import { cn } from "@/lib/utils.js"
import { formatKeyBinding } from "@/lib/format-key.js"
import { OpenInAppMenu, type OpenInAppId } from "./OpenInAppMenu.js"

export type SessionDialogMode =
  | "agent"
  | "terminal"
  | "editor"
  | "git"
  | "todos"

export type AgentSessionHeaderMeta = {
  threadTitle: string
  projectName?: string | null
  providerName?: string | null
  modelLabel?: string | null
  usage?: AgentUsage | null
}

export type TerminalSessionModalProps = {
  sessionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  presentation?: "modal" | "inline"
  title: string
  /** CLI binary running in the PTY (shown under title). */
  launchCommand?: string | null
  gitBranch?: string | null
  projectRootUri: string | null
  mode: SessionDialogMode
  onModeChange: (mode: SessionDialogMode) => void
  /** Whether this session has an agent surface (CLI or in-app chat). */
  showAgentTab?: boolean
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
        "[data-gharargah-terminal-modal] [data-gharargah-editor-scroll-area] .cm-content",
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

export function TerminalSessionModal(props: TerminalSessionModalProps) {
  const {
    sessionId,
    open,
    onOpenChange,
    presentation = "modal",
    title,
    launchCommand,
    gitBranch,
    projectRootUri,
    mode,
    onModeChange,
    showAgentTab = false,
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

  if (!open) return null

  const closeButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      data-gharargah-terminal-modal-close
      aria-label={
        presentation === "inline" ? "Return to new tab" : "Close session"
      }
      className="size-6 shrink-0 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
      onClick={
        presentation === "inline" ? () => onOpenChange(false) : undefined
      }
    >
      <XIcon aria-hidden />
    </Button>
  )

  const showAgentMeta = mode === "agent" && agentSessionHeader
  const displayTitle = showAgentMeta ? agentSessionHeader.threadTitle : title

  const sessionHeader = (
    <DialogHeader
      data-gharargah-terminal-modal-header=""
      {...(showAgentMeta ? { "data-chat-header": "true" } : {})}
      className="grid h-10 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b bg-background px-2 py-0 text-left sm:text-left"
    >
      <div className="flex min-w-0 items-center gap-1.5 justify-self-stretch">
        <h2
          data-gharargah-terminal-modal-title
          className="shrink truncate text-sm font-semibold tracking-tight text-foreground"
        >
          {displayTitle}
        </h2>
        {showAgentMeta ? (
          <div className="flex min-w-0 items-center gap-1 truncate font-mono text-3xs text-muted-foreground">
            {agentSessionHeader.projectName ||
            agentSessionHeader.providerName ||
            agentSessionHeader.modelLabel ? (
              <span aria-hidden="true" className="text-muted-foreground/50">
                ·
              </span>
            ) : null}
            {agentSessionHeader.projectName ? (
              <span className="truncate">{agentSessionHeader.projectName}</span>
            ) : null}
            {agentSessionHeader.projectName &&
            agentSessionHeader.providerName ? (
              <span aria-hidden="true" className="text-muted-foreground/50">
                ·
              </span>
            ) : null}
            {agentSessionHeader.providerName ? (
              <span className="truncate" data-chat-header-provider="true">
                {agentSessionHeader.providerName}
              </span>
            ) : null}
            {(agentSessionHeader.projectName ||
              agentSessionHeader.providerName) &&
            agentSessionHeader.modelLabel ? (
              <span aria-hidden="true" className="text-muted-foreground/50">
                ·
              </span>
            ) : null}
            {agentSessionHeader.modelLabel ? (
              <span className="truncate" data-chat-header-model="true">
                {agentSessionHeader.modelLabel}
              </span>
            ) : null}
          </div>
        ) : launchCommand || gitBranch ? (
          <p className="flex min-w-0 items-center gap-1.5 truncate font-mono text-3xs text-muted-foreground">
            <span aria-hidden="true" className="text-muted-foreground/50">
              ·
            </span>
            {launchCommand ? (
              <span
                data-gharargah-terminal-launch-command
                className="truncate"
              >
                {launchCommand}
              </span>
            ) : null}
            {launchCommand && gitBranch ? (
              <span className="text-muted-foreground/50" aria-hidden>
                ·
              </span>
            ) : null}
            {gitBranch ? (
              <span
                data-gharargah-terminal-git-branch
                className="flex min-w-0 items-center gap-0.5 truncate"
              >
                <GitBranch
                  className="size-2.5 shrink-0 opacity-80"
                  aria-hidden
                />
                <span className="truncate">{gitBranch}</span>
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      <Tabs
        data-gharargah-session-mode-switch
        value={mode}
        onValueChange={value => onModeChange(value as SessionDialogMode)}
        className="block min-w-0 justify-self-center"
      >
        <TabsList
          variant="line"
          aria-label="Session tools"
          className="gap-0"
        >
          <SessionToolTab
            mode="agent"
            label="Agent"
            disabled={!showAgentTab}
            active={mode === "agent"}
          />
          <SessionToolTab
            mode="editor"
            active={mode === "editor"}
            label="Editor"
            shortcut="Mod-Shift-e"
          />
          <SessionToolTab
            mode="git"
            active={mode === "git"}
            label="Git"
            shortcut="Mod-Shift-g"
          />
          <SessionToolTab
            mode="terminal"
            active={mode === "terminal"}
            label="Terminal"
            shortcut="Mod-Shift-t"
          />
        </TabsList>
      </Tabs>

      <div className="flex min-w-0 shrink-0 items-center justify-self-end gap-0.5">
        {projectRootUri && onOpenInApp ? (
          <OpenInAppMenu
            rootUri={projectRootUri}
            onOpenInApp={onOpenInApp}
            data-gharargah-open-in-app="modal"
            className="h-6 gap-0.5 px-1 text-muted-foreground hover:text-foreground"
          />
        ) : null}
        {headerEnd}
        {presentation === "modal" ? (
          <DialogClose asChild>{closeButton}</DialogClose>
        ) : (
          closeButton
        )}
      </div>
    </DialogHeader>
  )

  const stage = (
    <>
      {sessionHeader}
      <div
        data-gharargah-terminal-modal-body=""
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
      </div>
    </>
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
          const activePane = document.querySelector(
            `[data-gharargah-session-pane="${mode}"][data-active]`,
          )
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

function SessionToolTab(props: {
  mode: SessionDialogMode
  active: boolean
  label: string
  shortcut?: string
  disabled?: boolean
}) {
  const { mode, active, label, shortcut, disabled = false } = props
  const title = disabled
    ? `${label} (no agent in this session)`
    : shortcut
      ? `${label} (${formatKeyBinding(shortcut)})`
      : label
  return (
    <TabsTrigger
      value={mode}
      aria-label={label}
      title={title}
      aria-controls={`gharargah-session-pane-${mode}`}
      id={`gharargah-session-tab-${mode}`}
      disabled={disabled}
      data-gharargah-session-mode-tab={mode}
      data-active={active ? "" : undefined}
      className="min-w-14 px-3"
    >
      {label}
    </TabsTrigger>
  )
}
