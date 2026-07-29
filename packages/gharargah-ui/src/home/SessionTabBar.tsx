import type { KeyboardEvent, MouseEvent } from "react"
import type { PanelId } from "@gharargah/shared"
import { Bot, Plus, SquareTerminal, X } from "lucide-react"
import { Button } from "@/components/ui/button.js"
import { cn } from "@/lib/utils.js"
import type {
  SessionProvider,
  TerminalRuntimeStatus,
} from "./session-card-model.js"

export type SessionTabItem = {
  tabId: string
  panelId: PanelId
  title: string
  projectName: string
  status: TerminalRuntimeStatus
  agentId?: SessionProvider
}

export type SessionTabBarProps = {
  sessions: SessionTabItem[]
  activeTabId: string | null
  onSelect: (panelId: PanelId, tabId: string) => void
  onClose: (panelId: PanelId, tabId: string) => void
  newSessionRootUri: string
  onNewTab: (rootUri: string) => void
}

export function SessionTabBar(props: SessionTabBarProps) {
  const {
    sessions,
    activeTabId,
    onSelect,
    onClose,
    newSessionRootUri,
    onNewTab,
  } = props

  return (
    <div
      data-gharargah-session-tabs
      data-gharargah-session-tabs-position="top"
      className="flex h-10 w-full min-w-0 shrink-0 justify-start gap-0 overflow-x-auto border-b border-border bg-muted/35"
    >
      <div
        role="tablist"
        aria-label="Sessions"
        onKeyDown={handleSessionTabKeyDown}
        className="flex h-full min-w-0 flex-none"
      >
        {sessions.map(session => {
          const active = session.tabId === activeTabId
          return (
            <div
              key={session.tabId}
              data-gharargah-session-tab-shell={session.tabId}
              data-active={active ? "" : undefined}
              className="group relative h-full w-48 min-w-36 max-w-56 flex-none border-r border-border/70"
            >
              <Button
                type="button"
                role="tab"
                variant="ghost"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => onSelect(session.panelId, session.tabId)}
                onMouseDown={(event: MouseEvent<HTMLButtonElement>) => {
                  if (event.button !== 1) return
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onAuxClick={(event: MouseEvent<HTMLButtonElement>) => {
                  if (event.button !== 1) return
                  event.preventDefault()
                  event.stopPropagation()
                  onClose(session.panelId, session.tabId)
                }}
                data-gharargah-session-tab={session.tabId}
                className={cn(
                  "h-full w-full min-w-0 justify-start rounded-none border-0 bg-transparent px-2 pr-7 text-left shadow-none",
                  active &&
                    "bg-background shadow-[inset_0_-2px_0_var(--primary)] hover:bg-background",
                )}
              >
                <span className="relative flex shrink-0" aria-hidden>
                  {session.agentId ? <Bot /> : <SquareTerminal />}
                  <span
                    data-gharargah-session-tab-status={session.status}
                    className={cn(
                      "absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-2 ring-background",
                      session.status === "failed"
                        ? "bg-destructive"
                        : session.status === "exited"
                          ? "bg-muted-foreground"
                          : "bg-primary",
                    )}
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-xs leading-tight font-medium text-foreground">
                    {session.title}
                  </span>
                  <span className="truncate font-mono text-4xs leading-tight text-muted-foreground">
                    {session.projectName}
                  </span>
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`End ${session.title} session`}
                title={`End ${session.title} session`}
                data-gharargah-session-tab-close={session.tabId}
                className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground opacity-55 hover:opacity-100"
                onPointerDown={event => event.stopPropagation()}
                onClick={(event: MouseEvent<HTMLButtonElement>) => {
                  event.stopPropagation()
                  onClose(session.panelId, session.tabId)
                }}
              >
                <X aria-hidden />
              </Button>
            </div>
          )
        })}
      </div>

      <Button
        type="button"
        variant="ghost"
        aria-label="New tab"
        data-gharargah-session-tab-new
        className="h-full min-w-fit flex-none justify-start rounded-none border-0 border-r border-border/70 bg-transparent px-3 text-xs shadow-none"
        onClick={() => onNewTab(newSessionRootUri)}
      >
        <Plus aria-hidden />
        <span>New tab</span>
      </Button>
    </div>
  )
}

function handleSessionTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
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
