import { useEffect, type KeyboardEvent, type ReactNode } from "react"
import type { AgentUsage } from "@gharargah/agents"
import {
  Bot,
  Columns3,
  GitBranch,
  SquareTerminal,
  XIcon,
  FileCode2,
} from "lucide-react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"
import { Button } from "@/components/ui/button.js"
import { cn } from "@/lib/utils.js"
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
  /** Agent/ACP tab only for sessions launched with an ACP driver. */
  showAgentTab?: boolean
  /** Merged into the session footer when mode is agent. */
  agentSessionHeader?: AgentSessionHeaderMeta | null
  onOpenInApp?: (rootUri: string, appId: OpenInAppId) => void
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
    agent,
    editor,
    terminal,
    git,
    todos,
  } = props

  useEffect(() => {
    if (!open || presentation !== "inline") return
    const frame = requestAnimationFrame(() => focusSessionPane(mode))
    return () => cancelAnimationFrame(frame)
  }, [open, mode, presentation])

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
      className="shrink-0 text-muted-foreground hover:text-foreground"
      onClick={
        presentation === "inline" ? () => onOpenChange(false) : undefined
      }
    >
      <XIcon aria-hidden />
    </Button>
  )

  const showAgentMeta = mode === "agent" && agentSessionHeader
  const displayTitle = showAgentMeta ? agentSessionHeader.threadTitle : title

  const stage = (
    <>
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

      <DialogHeader
        data-gharargah-terminal-modal-header=""
        {...(showAgentMeta ? { "data-chat-header": "true" } : {})}
        className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-t bg-background px-3 py-2 text-left sm:text-left"
      >
        <div className="min-w-0 justify-self-stretch">
          <h2
            data-gharargah-terminal-modal-title
            className="truncate text-sm font-medium tracking-tight text-foreground"
          >
            {displayTitle}
          </h2>
          {showAgentMeta ? (
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
              {agentSessionHeader.projectName ? (
                <span className="truncate">
                  {agentSessionHeader.projectName}
                </span>
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
            <p className="mt-0.5 flex min-w-0 items-center gap-2 truncate font-mono text-3xs text-muted-foreground">
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
                  className="flex min-w-0 items-center gap-1 truncate"
                >
                  <GitBranch
                    className="size-3 shrink-0 opacity-80"
                    aria-hidden
                  />
                  <span className="truncate">{gitBranch}</span>
                </span>
              ) : null}
            </p>
          ) : null}
        </div>

        <div
          data-gharargah-session-mode-switch
          role="tablist"
          aria-label="Session view"
          onKeyDown={handleModeTabKeyDown}
          className="flex shrink-0 items-center gap-0.5 justify-self-center rounded-lg bg-muted p-0.5 text-muted-foreground"
        >
          {showAgentTab ? (
            <ModeTab
              mode="agent"
              active={mode === "agent"}
              label="Agent"
              icon={<Bot aria-hidden />}
              onSelect={() => onModeChange("agent")}
            />
          ) : null}
          <ModeTab
            mode="terminal"
            active={mode === "terminal"}
            label="Terminal"
            icon={<SquareTerminal aria-hidden />}
            onSelect={() => onModeChange("terminal")}
          />
          <ModeTab
            mode="editor"
            active={mode === "editor"}
            label="Editor"
            icon={<FileCode2 aria-hidden />}
            onSelect={() => onModeChange("editor")}
          />
          <ModeTab
            mode="git"
            active={mode === "git"}
            label="Git"
            icon={<GitBranch aria-hidden />}
            onSelect={() => onModeChange("git")}
          />
          <ModeTab
            mode="todos"
            active={mode === "todos"}
            label="TODOs"
            icon={<Columns3 aria-hidden />}
            onSelect={() => onModeChange("todos")}
          />
        </div>

        <div className="flex min-w-0 shrink-0 items-center justify-self-end gap-0.5">
          {projectRootUri && onOpenInApp ? (
            <OpenInAppMenu
              rootUri={projectRootUri}
              onOpenInApp={onOpenInApp}
              data-gharargah-open-in-app="modal"
              className="text-muted-foreground hover:text-foreground"
            />
          ) : null}
          {presentation === "modal" ? (
            <DialogClose asChild>{closeButton}</DialogClose>
          ) : (
            closeButton
          )}
        </div>
      </DialogHeader>
    </>
  )

  if (presentation === "inline") {
    return (
      <section
        data-gharargah-glass=""
        data-gharargah-terminal-modal
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
        data-gharargah-glass=""
        data-gharargah-terminal-modal
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

function ModeTab(props: {
  mode: SessionDialogMode
  active: boolean
  label: string
  icon: ReactNode
  onSelect: () => void
}) {
  const { mode, active, label, icon, onSelect } = props
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      title={label}
      aria-controls={`gharargah-session-pane-${mode}`}
      id={`gharargah-session-tab-${mode}`}
      tabIndex={active ? 0 : -1}
      data-gharargah-session-mode-tab={mode}
      data-active={active ? "" : undefined}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-sm transition-[color,background-color,box-shadow]",
        "focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
      )}
      onClick={onSelect}
    >
      <span className="[&_svg]:size-3.5">{icon}</span>
    </button>
  )
}

function handleModeTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  )
  if (tabs.length === 0) return
  const current = Math.max(
    0,
    tabs.indexOf(document.activeElement as HTMLButtonElement),
  )
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
          tabs.length
  event.preventDefault()
  tabs[next]?.focus()
  tabs[next]?.click()
}
