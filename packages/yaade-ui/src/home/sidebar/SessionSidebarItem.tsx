import { CircleAlert } from "lucide-react"
import {
  SidebarMenuAction,
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
import { formatSidebarActivityTime } from "../../notifications/group-by-time.js"
import {
  SessionContextMenu,
  type SessionSidebarActions,
} from "./SessionContextMenu.js"
import {
  AgentProviderIcon,
  sessionStatusText,
} from "./SessionStatusIndicator.js"
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
  const activityTime = formatSidebarActivityTime(session.lastActivityAt)
  const statusText = sessionStatusText(session.status)
  const showArchive = Boolean(actions.onArchive && !session.archivedAt)
  const compactLabel = `Project ${session.projectName}${
    unreadLabel ? `, ${unreadLabel}` : ""
  }`

  const button = (
    <SidebarMenuButton
      isActive={selected}
      data-yaade-sidebar-session={session.id}
      data-yaade-sidebar-session-selected={selected ? "" : undefined}
      data-yaade-list-item=""
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
        "h-auto min-h-8 items-start gap-2 py-1.5",
        compact && "size-8! min-h-8 items-center justify-center gap-0 p-0!",
        showArchive && "group-has-data-[sidebar=menu-action]/menu-item:pr-14",
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
          data-yaade-sidebar-project-monogram=""
          data-yaade-sidebar-project-name={session.projectName}
          className="flex size-[1.125rem] shrink-0 items-center justify-center rounded-[0.3rem] border border-sidebar-border bg-sidebar-accent font-mono text-[0.5625rem] font-semibold leading-none tracking-[-0.04em] text-sidebar-accent-foreground"
        >
          {projectMonogram(session.projectName)}
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-xs text-sidebar-foreground",
                session.unreadCount > 0 && "font-semibold",
              )}
            >
              {session.title}
            </span>
            {session.status === "failed" ? (
              <CircleAlert
                className="size-3 shrink-0 text-destructive"
                aria-label="Failed"
                data-yaade-session-status="failed"
              />
            ) : null}
            {showProjectMeta ? (
              <span
                className={cn(
                  "shrink-0 text-3xs text-sidebar-foreground/55",
                  showArchive &&
                    "transition-opacity group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0",
                )}
              >
                {session.projectName}
              </span>
            ) : null}
          </span>
          {session.description ? (
            <span className="truncate text-3xs text-sidebar-foreground/55">
              {session.description}
            </span>
          ) : null}
          <span className="flex min-w-0 items-center gap-1.5 text-3xs text-sidebar-foreground/65">
            <AgentProviderIcon agent={session.agent} className="size-3" />
            <span className="min-w-0 truncate">
              {session.agentLabel}
              <span className="text-sidebar-foreground/45"> · {activityTime}</span>
            </span>
            {statusText && session.status !== "failed" ? (
              <span
                className={cn(
                  "ml-auto shrink-0 font-medium",
                  statusText.className,
                  showArchive &&
                    "transition-opacity group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0",
                )}
                data-yaade-session-status={session.status}
              >
                {statusText.text}
              </span>
            ) : null}
          </span>
        </span>
      )}
      {session.unreadCount > 0 ? (
        <SidebarMenuBadge
          aria-label={unreadLabel}
          className={cn(
            "bg-primary/20 text-primary",
            showArchive &&
              "transition-opacity group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0",
          )}
          data-yaade-sidebar-unread-badge=""
        >
          {session.unreadCount}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuButton>
  )

  return (
    <SidebarMenuItem
      className={cn("group/menu-item", compact && "flex justify-center")}
      data-yaade-sidebar-session-row={session.id}
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
      {!compact && showArchive ? (
        <SidebarMenuAction
          showOnHover
          type="button"
          aria-label="Archive session"
          data-yaade-sidebar-session-archive=""
          className="aspect-auto top-1.5 right-1 h-5 w-auto px-1.5 text-3xs font-medium"
          onClick={event => {
            event.stopPropagation()
            actions.onArchive?.(session)
          }}
        >
          Archive
        </SidebarMenuAction>
      ) : null}
    </SidebarMenuItem>
  )
}
