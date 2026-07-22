import type { KeyboardEvent, ReactNode } from "react"
import { GitBranch, SquareTerminal, XIcon, FileCode2 } from "lucide-react"
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

export type SessionDialogMode = "terminal" | "editor" | "git"

export type TerminalSessionModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  gitBranch?: string | null
  projectRootUri: string | null
  mode: SessionDialogMode
  onModeChange: (mode: SessionDialogMode) => void
  onOpenInApp?: (rootUri: string, appId: OpenInAppId) => void
  editor: ReactNode
  terminal: ReactNode
  git: ReactNode
}

/** @deprecated Session list removed from dialog; keep export for test migration. */
export const TERMINAL_MODAL_SESSION_LIST_ID = "gharargah:terminal-modal-sessions"

export function TerminalSessionModal(props: TerminalSessionModalProps) {
  const {
    open,
    onOpenChange,
    title,
    gitBranch,
    projectRootUri,
    mode,
    onModeChange,
    onOpenInApp,
    editor,
    terminal,
    git,
  } = props

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="stage"
        showCloseButton={false}
        onInteractOutside={event => event.preventDefault()}
        data-gharargah-glass=""
        data-gharargah-terminal-modal
        data-gharargah-session-mode={mode}
        className="flex flex-col gap-0 overflow-hidden border-0 bg-transparent p-0 shadow-none"
        aria-describedby={undefined}
        onOpenAutoFocus={event => {
          event.preventDefault()
          requestAnimationFrame(() => {
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
            document
              .querySelector<HTMLElement>(
                "[data-gharargah-terminal-modal] [data-gharargah-terminal-panel] .xterm-helper-textarea",
              )
              ?.focus()
          })
        }}
      >
        <DialogHeader
          data-gharargah-terminal-modal-header=""
          className="relative flex shrink-0 flex-row items-center gap-3 px-4 py-3 text-left sm:text-left"
        >
          <div className="z-10 min-w-0 flex-1 pr-2">
            <DialogTitle className="truncate text-sm font-medium tracking-tight text-foreground">
              {title}
            </DialogTitle>
            {gitBranch ? (
              <p
                data-gharargah-terminal-git-branch
                className="mt-0.5 flex items-center gap-1 truncate font-mono text-3xs text-muted-foreground"
              >
                <GitBranch className="size-3 shrink-0 opacity-80" aria-hidden />
                <span className="truncate">{gitBranch}</span>
              </p>
            ) : null}
          </div>

          <div
            data-gharargah-session-mode-switch
            role="tablist"
            aria-label="Session view"
            onKeyDown={handleModeTabKeyDown}
            className="pointer-events-auto absolute top-1/2 left-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-md border border-border/50 bg-card/40 p-0.5 shadow-[inset_0_1px_0_color-mix(in_srgb,white_8%,transparent)] backdrop-blur-md"
          >
            <ModeTab
              active={mode === "terminal"}
              label="Terminal"
              icon={<SquareTerminal className="size-3.5" aria-hidden />}
              onSelect={() => onModeChange("terminal")}
            />
            <ModeTab
              active={mode === "editor"}
              label="Editor"
              icon={<FileCode2 className="size-3.5" aria-hidden />}
              onSelect={() => onModeChange("editor")}
            />
            <ModeTab
              active={mode === "git"}
              label="Git"
              icon={<GitBranch className="size-3.5" aria-hidden />}
              onSelect={() => onModeChange("git")}
            />
          </div>

          <div className="z-10 flex shrink-0 items-center gap-0.5">
            {projectRootUri && onOpenInApp ? (
              <OpenInAppMenu
                rootUri={projectRootUri}
                onOpenInApp={onOpenInApp}
                data-gharargah-open-in-app="modal"
                className="text-muted-foreground hover:text-foreground"
              />
            ) : null}
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                data-gharargah-terminal-modal-close
                aria-label="Close session"
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-4" />
              </Button>
            </DialogClose>
          </div>
        </DialogHeader>

        <div
          data-gharargah-terminal-modal-body=""
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden overscroll-contain"
        >
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
              "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden",
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
              "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden",
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
              "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden",
              mode === "git" ? "z-10" : "pointer-events-none z-0",
            )}
          >
            {mode === "git" ? git : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ModeTab(props: {
  active: boolean
  label: string
  icon: ReactNode
  onSelect: () => void
}) {
  const { active, label, icon, onSelect } = props
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`gharargah-session-pane-${label.toLowerCase()}`}
      id={`gharargah-session-tab-${label.toLowerCase()}`}
      tabIndex={active ? 0 : -1}
      data-gharargah-session-mode-tab={label.toLowerCase()}
      data-active={active ? "" : undefined}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-2xs font-medium tracking-wide transition-[color,background-color,box-shadow]",
        "focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        active
          ? "bg-primary/20 text-foreground shadow-[0_0_16px_-4px_var(--glass-accent-glow)] ring-1 ring-primary/35"
          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
      onClick={onSelect}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function handleModeTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  if (tabs.length === 0) return
  const current = Math.max(0, tabs.indexOf(document.activeElement as HTMLButtonElement))
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
  event.preventDefault()
  tabs[next]?.focus()
  tabs[next]?.click()
}
