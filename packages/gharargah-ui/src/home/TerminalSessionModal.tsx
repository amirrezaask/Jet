import { useMemo, type ReactNode } from "react"
import type { PanelId } from "@gharargah/shared"
import { GitBranch, Plus, SquareTerminal, XIcon } from "lucide-react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"
import { Button } from "@/components/ui/button.js"
import { ListRow } from "@/components/ListRow.js"
import { Lister, type ListerNode } from "@/lister/index.js"
import { gharargahScrollFadeClass } from "@/motion/tokens.js"
import { cn } from "@/lib/utils.js"
import type { TerminalCardStatus } from "./TerminalCard.js"
import { NewSessionMenu } from "./NewSessionMenu.js"
import type { TerminalAgentShortcut } from "../tabs/TerminalExplorerTab.js"

export type TerminalModalSession = {
  tabId: string
  panelId: PanelId
  label: string
  status: TerminalCardStatus
  exitCode?: number
}

export type TerminalSessionModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  gitBranch?: string | null
  sessions: TerminalModalSession[]
  activeTabId: string | null
  projectRootUri: string | null
  onSelectSession: (panelId: PanelId, tabId: string) => void
  onNewTerminal?: (rootUri: string) => void
  onLaunchAgentTerminal?: (rootUri: string, shortcut: TerminalAgentShortcut) => void
  children: ReactNode
}

export const TERMINAL_MODAL_SESSION_LIST_ID = "gharargah:terminal-modal-sessions"

export function TerminalSessionModal(props: TerminalSessionModalProps) {
  const {
    open,
    onOpenChange,
    title,
    gitBranch,
    sessions,
    activeTabId,
    projectRootUri,
    onSelectSession,
    onNewTerminal,
    onLaunchAgentTerminal,
    children,
  } = props

  const listerItems = useMemo<ListerNode<TerminalModalSession>[]>(
    () =>
      sessions.map(session => ({
        id: session.tabId,
        searchText: session.label,
        data: session,
      })),
    [sessions],
  )

  const canSpawn =
    projectRootUri != null &&
    projectRootUri.length > 0 &&
    onNewTerminal != null &&
    onLaunchAgentTerminal != null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="stage"
        showCloseButton={false}
        data-gharargah-glass=""
        data-gharargah-terminal-modal
        className="flex flex-col gap-0 overflow-hidden border-0 bg-transparent p-0 shadow-none"
        aria-describedby={undefined}
        onOpenAutoFocus={event => {
          // Prefer focusing the terminal surface, not dialog chrome.
          event.preventDefault()
          requestAnimationFrame(() => {
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
          className="flex shrink-0 flex-row items-center gap-3 px-4 py-3 text-left sm:text-left"
        >
          <div className="min-w-0 flex-1">
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
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-gharargah-terminal-modal-close
              aria-label="Close terminal"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-4" />
            </Button>
          </DialogClose>
        </DialogHeader>
        <div
          data-gharargah-terminal-modal-body=""
          className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden"
        >
          <div
            data-gharargah-terminal-modal-stage=""
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          >
            {children}
          </div>
          <aside
            data-gharargah-terminal-modal-sessions=""
            className="flex w-64 shrink-0 flex-col overflow-hidden border-l border-border/60"
          >
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/50 px-3">
              <span className="min-w-0 flex-1 truncate text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                Sessions
              </span>
              {canSpawn ? (
                <NewSessionMenu
                  rootUri={projectRootUri}
                  onNewTerminal={onNewTerminal}
                  onLaunchAgentTerminal={onLaunchAgentTerminal}
                  align="end"
                  trigger={
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      data-gharargah-terminal-modal-new-session
                      title="New session"
                      aria-label="New session"
                      className="size-6 text-muted-foreground hover:text-foreground"
                      onClick={e => e.stopPropagation()}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  }
                />
              ) : null}
            </div>
            <Lister
              listId={TERMINAL_MODAL_SESSION_LIST_ID}
              mode="flat"
              flatVariant="plain"
              filter="local"
              showInput={false}
              autoFocusInput={false}
              placeholder="Filter sessions…"
              items={listerItems}
              activeId={activeTabId}
              aria-label="Terminal sessions"
              className="min-h-0 flex-1"
              listClassName={cn(
                "m-0 min-h-0 flex-1 list-none overflow-auto bg-transparent p-1",
                gharargahScrollFadeClass,
              )}
              emptyState={
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No sessions
                </p>
              }
              onActivate={node => onSelectSession(node.data.panelId, node.data.tabId)}
              render={(node, ctx) => {
                const entry = node.data
                const dead = entry.status === "exited" || entry.status === "failed"
                return (
                  <ListRow
                    data-gharargah-list-item
                    data-gharargah-terminal-session-row={entry.tabId}
                    isActive={ctx.active || ctx.selected}
                    className="h-full w-full min-w-0 flex-row items-center gap-2 px-2 py-1"
                    onClick={() => onSelectSession(entry.panelId, entry.tabId)}
                  >
                    <span className="relative flex size-4 shrink-0 items-center justify-center" aria-hidden>
                      <SquareTerminal
                        className={dead ? "size-3.5 text-destructive/80" : "size-3.5 text-muted-foreground"}
                      />
                      <span
                        data-gharargah-terminal-status={entry.status}
                        className={
                          dead
                            ? "absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-destructive ring-1 ring-sidebar"
                            : "absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-primary ring-1 ring-sidebar"
                        }
                      />
                    </span>
                    <span
                      data-slot="row-label"
                      className="min-w-0 flex-1 truncate text-xs text-foreground"
                      title={entry.label}
                    >
                      {entry.label}
                    </span>
                  </ListRow>
                )
              }}
            />
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  )
}
