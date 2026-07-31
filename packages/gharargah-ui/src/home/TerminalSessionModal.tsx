import { useEffect, type CSSProperties, type ReactNode } from "react"
import {
  Bot,
  Check,
  Code2,
  GitBranch,
  SquareTerminal,
  XIcon,
  type LucideIcon,
} from "lucide-react"
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
import { distinctSessionHeaderLabel } from "./session-header-labels.js"
import type { DesktopWindowPlatform } from "./GharargahWindowTitlebar.js"

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
  /** Mark session done — keeps history, stops live PTY. */
  onMarkDone?: () => void
  isDone?: boolean
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
    windowChrome = null,
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
    onMarkDone,
    isDone = false,
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
  const displayLaunchCommand = mode === "agent" ? null : launchCommand
  const displayProjectName = showAgentMeta
    ? distinctSessionHeaderLabel(
        displayTitle,
        agentSessionHeader.projectName,
      )
    : null

  const sessionHeader = (
    <DialogHeader
      data-gharargah-terminal-modal-header=""
      {...(showAgentMeta ? { "data-chat-header": "true" } : {})}
      data-gharargah-window-drag-region={ownsWindowChrome ? "" : undefined}
      className={cn(
        "flex flex-row shrink-0 items-center gap-2 border-b bg-background px-2 py-0 text-left sm:text-left",
        !ownsWindowChrome && "h-10",
      )}
      style={headerStyle}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {windowChrome?.trafficLights && ownsWindowChrome ? (
          <div
            aria-hidden
            data-gharargah-traffic-light-spacer=""
            style={dragRegion}
          />
        ) : null}
        <h2
          data-gharargah-terminal-modal-title
          className="shrink truncate text-sm font-semibold tracking-tight text-foreground"
        >
          {displayTitle}
        </h2>
        {showAgentMeta ? (
          <div className="flex min-w-0 items-center gap-1 truncate font-mono text-3xs text-muted-foreground">
            {displayProjectName || agentSessionHeader.modelLabel ? (
              <span aria-hidden="true" className="text-muted-foreground/50">
                ·
              </span>
            ) : null}
            {displayProjectName ? (
              <span
                className="truncate"
                data-gharargah-session-project-name
              >
                {displayProjectName}
              </span>
            ) : null}
            {displayProjectName && agentSessionHeader.modelLabel ? (
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
        ) : displayLaunchCommand || gitBranch ? (
          <p className="flex min-w-0 items-center gap-1.5 truncate font-mono text-3xs text-muted-foreground">
            <span aria-hidden="true" className="text-muted-foreground/50">
              ·
            </span>
            {displayLaunchCommand ? (
              <span
                data-gharargah-terminal-launch-command
                className="truncate"
              >
                {displayLaunchCommand}
              </span>
            ) : null}
            {displayLaunchCommand && gitBranch ? (
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

      <div
        className="flex shrink-0 items-center gap-0.5"
        style={noDragRegion}
      >
        <Tabs
          data-gharargah-session-mode-switch
          value={mode}
          onValueChange={value => onModeChange(value as SessionDialogMode)}
          className="block min-w-0"
        >
          <TabsList
            variant="line"
            aria-label="Session tools"
            className="h-8 gap-0"
          >
            <SessionToolTab
              mode="agent"
              label="Agent"
              icon={Bot}
              disabled={!showAgentTab}
              active={mode === "agent"}
            />
            <SessionToolTab
              mode="editor"
              active={mode === "editor"}
              label="Editor"
              icon={Code2}
              shortcut="Mod-Shift-e"
            />
            <SessionToolTab
              mode="git"
              active={mode === "git"}
              label="Git"
              icon={GitBranch}
              shortcut="Mod-Shift-g"
            />
            <SessionToolTab
              mode="terminal"
              active={mode === "terminal"}
              label="Terminal"
              icon={SquareTerminal}
              shortcut="Mod-Shift-t"
            />
          </TabsList>
        </Tabs>
        {projectRootUri && onOpenInApp ? (
          <OpenInAppMenu
            rootUri={projectRootUri}
            onOpenInApp={onOpenInApp}
            data-gharargah-open-in-app="modal"
            className="h-6 gap-0.5 px-1 text-muted-foreground hover:text-foreground"
          />
        ) : null}
        {headerEnd}
        {onMarkDone && !isDone ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 gap-1 px-2 text-3xs"
            data-gharargah-session-mark-done
            onClick={onMarkDone}
            style={noDragRegion}
          >
            <Check className="size-3" aria-hidden />
            Done
          </Button>
        ) : null}
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
  icon: LucideIcon
  shortcut?: string
  disabled?: boolean
}) {
  const { mode, active, label, icon: Icon, shortcut, disabled = false } = props
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
      className="size-8 min-w-8 flex-none px-0"
    >
      <Icon className="size-4" aria-hidden />
    </TabsTrigger>
  )
}
