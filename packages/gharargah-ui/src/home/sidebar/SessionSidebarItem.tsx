import { MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button.js"
import {
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar.js"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip.js"
import { cn } from "@/lib/utils.js"
import { formatRelativeTime } from "../../notifications/group-by-time.js"
import {
  SessionContextMenu,
  SessionDropdownMenu,
  type SessionSidebarActions,
} from "./SessionContextMenu.js"
import { AgentProviderIcon, SessionStatusIndicator } from "./SessionStatusIndicator.js"
import { projectMonogram } from "./project-monogram.js"
import type { SidebarSession } from "./types.js"

export type SessionSidebarItemProps = {
  session: SidebarSession
  selected: boolean
  compact?: boolean
  showProjectMeta?: boolean
  actions: SessionSidebarActions
  onSelect: (session: SidebarSession) => void
}

export function SessionSidebarItem({
  session,
  selected,
  compact = false,
  showProjectMeta = false,
  actions,
  onSelect,
}: SessionSidebarItemProps) {
  const unreadLabel =
    session.unreadCount > 0
      ? `${session.unreadCount} unread message${session.unreadCount === 1 ? "" : "s"}`
      : undefined
  const relative = formatRelativeTime(session.lastActivityAt)
  const compactLabel = `Project ${session.projectName}${
    unreadLabel ? `, ${unreadLabel}` : ""
  }`

  const button = (
    <SidebarMenuButton
      isActive={selected}
      data-gharargah-sidebar-session={session.id}
      data-gharargah-sidebar-session-selected={selected ? "" : undefined}
      data-gharargah-list-item=""
      aria-current={selected ? "true" : undefined}
      aria-label={
        compact
          ? compactLabel
          : `${session.title}, ${session.agentLabel}${
              showProjectMeta ? `, ${session.projectName}` : ""
            }${unreadLabel ? `, ${unreadLabel}` : ""}`
      }
      onClick={() => onSelect(session)}
      className={cn(
        "h-auto min-h-8 items-center gap-2 py-1.5",
        compact && "size-8! min-h-8 justify-center gap-0 p-0!",
        selected && !compact &&
          "border-l-2 border-l-primary bg-primary/10 data-[active=true]:bg-primary/10",
        selected && compact && "bg-primary/10 data-[active=true]:bg-primary/10",
        session.unreadCount > 0 && "font-medium",
      )}
    >
      {compact ? (
        <span
          role="img"
          aria-label={`Project ${session.projectName}`}
          data-gharargah-sidebar-project-monogram=""
          data-gharargah-sidebar-project-name={session.projectName}
          className="flex size-[1.125rem] shrink-0 items-center justify-center rounded-[0.3rem] border border-sidebar-border bg-sidebar-accent font-mono text-[0.5625rem] font-semibold leading-none tracking-[-0.04em] text-sidebar-accent-foreground"
        >
          {projectMonogram(session.projectName)}
        </span>
      ) : (
        <>
          <AgentProviderIcon agent={session.agent} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-xs",
                  session.unreadCount > 0
                    ? "font-semibold text-foreground"
                    : "text-foreground",
                )}
              >
                {session.title}
              </span>
              <span className="shrink-0 text-3xs text-muted-foreground tabular-nums">
                {relative}
              </span>
            </span>
            <span className="flex items-center gap-1.5 text-3xs text-muted-foreground">
              <span className="truncate">
                {showProjectMeta
                  ? `${session.agentLabel} · ${session.projectName}`
                  : session.agentLabel}
              </span>
              <SessionStatusIndicator status={session.status} />
            </span>
          </span>
        </>
      )}
      {session.unreadCount > 0 ? (
        <SidebarMenuBadge
          aria-label={unreadLabel}
          className="bg-primary/20 text-primary"
          data-gharargah-sidebar-unread-badge=""
        >
          {session.unreadCount}
        </SidebarMenuBadge>
      ) : null}
      {!compact ? (
        <SessionDropdownMenu
          session={session}
          actions={actions}
          trigger={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="size-5 shrink-0 opacity-0 group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100"
              aria-label="Session actions"
              onClick={e => e.stopPropagation()}
              onPointerDown={e => e.stopPropagation()}
            >
              <MoreHorizontal className="size-3" />
            </Button>
          }
        />
      ) : null}
    </SidebarMenuButton>
  )

  return (
    <SidebarMenuItem
      className={cn("group/menu-item", compact && "flex justify-center")}
    >
      <SessionContextMenu session={session} actions={actions}>
        {compact ? (
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="right" align="center">
              {session.projectName}
            </TooltipContent>
          </Tooltip>
        ) : (
          button
        )}
      </SessionContextMenu>
    </SidebarMenuItem>
  )
}
