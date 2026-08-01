import { ChevronRight, Folder, MoreHorizontal, Plus } from "lucide-react"
import { Button } from "@/components/ui/button.js"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible.js"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js"
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar.js"
import { cn } from "@/lib/utils.js"
import type { SessionSidebarActions } from "./SessionContextMenu.js"
import { SessionSidebarItem } from "./SessionSidebarItem.js"
import type { SidebarProject, SidebarSession } from "./types.js"

export type ProjectSidebarActions = {
  onNewSession: (project: SidebarProject) => void
  onOpenProject?: (project: SidebarProject) => void
  onRevealFolder?: (project: SidebarProject) => void
  onRemoveProject?: (project: SidebarProject) => void
  onCollapseProject?: (project: SidebarProject) => void
  onCollapseAll?: () => void
}

export type ProjectSidebarItemProps = {
  project: SidebarProject
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  selectedSessionId: string | null
  sessionActions: SessionSidebarActions
  projectActions: ProjectSidebarActions
  onSelectSession: (session: SidebarSession) => void
  compact?: boolean
}

export function ProjectSidebarItem({
  project,
  expanded,
  onExpandedChange,
  selectedSessionId,
  sessionActions,
  projectActions,
  onSelectSession,
  compact = false,
}: ProjectSidebarItemProps) {
  const unreadLabel =
    project.unreadCount > 0
      ? `${project.unreadCount} unread message${project.unreadCount === 1 ? "" : "s"}`
      : undefined

  const activeSessions = project.sessions.filter(session => !session.archivedAt)
  const archivedSessions = project.sessions.filter(session =>
    Boolean(session.archivedAt),
  )

  const renderSessionList = (
    sessions: SidebarSession[],
    section: "active" | "archived",
  ) => (
    <SidebarMenu
      className="gap-0.5"
      data-gharargah-sidebar-session-section={section}
    >
      {sessions.map(session => (
        <SessionSidebarItem
          key={session.id}
          session={session}
          selected={selectedSessionId === session.id}
          compact={compact}
          actions={sessionActions}
          onSelect={onSelectSession}
        />
      ))}
    </SidebarMenu>
  )

  const menuItems = (
    <>
      <ContextMenuItem onSelect={() => projectActions.onNewSession(project)}>
        New session
      </ContextMenuItem>
      {projectActions.onOpenProject ? (
        <ContextMenuItem onSelect={() => projectActions.onOpenProject?.(project)}>
          Open project
        </ContextMenuItem>
      ) : null}
      {projectActions.onRevealFolder ? (
        <ContextMenuItem onSelect={() => projectActions.onRevealFolder?.(project)}>
          Reveal project folder
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem
        onSelect={() => {
          onExpandedChange(false)
          projectActions.onCollapseProject?.(project)
        }}
      >
        Collapse project
      </ContextMenuItem>
      {projectActions.onCollapseAll ? (
        <ContextMenuItem onSelect={() => projectActions.onCollapseAll?.()}>
          Collapse all projects
        </ContextMenuItem>
      ) : null}
      {projectActions.onRemoveProject ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => projectActions.onRemoveProject?.(project)}
          >
            Remove project
          </ContextMenuItem>
        </>
      ) : null}
    </>
  )

  return (
    <Collapsible
      open={expanded}
      onOpenChange={onExpandedChange}
      className="group/collapsible"
      data-gharargah-sidebar-project={project.id}
    >
      <SidebarMenuItem>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <CollapsibleTrigger asChild>
              <SidebarMenuButton
                tooltip={project.name}
                className="h-8"
                data-gharargah-sidebar-project-row={project.id}
                aria-expanded={expanded}
                aria-label={`${project.name}, ${project.sessions.length} sessions${
                  unreadLabel ? `, ${unreadLabel}` : ""
                }`}
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 transition-transform duration-[var(--gharargah-motion-fast)]",
                    expanded && "rotate-90",
                  )}
                  aria-hidden
                />
                <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {project.name}
                </span>
                {!compact && project.path ? (
                  <span className="hidden max-w-[5rem] truncate text-3xs text-muted-foreground xl:inline">
                    {project.path.split("/").pop()}
                  </span>
                ) : null}
                {project.unreadCount > 0 ? (
                  <SidebarMenuBadge aria-label={unreadLabel}>
                    {project.unreadCount}
                  </SidebarMenuBadge>
                ) : (
                  <span className="text-3xs tabular-nums text-muted-foreground">
                    {project.sessions.length}
                  </span>
                )}
              </SidebarMenuButton>
            </CollapsibleTrigger>
          </ContextMenuTrigger>
          <ContextMenuContent data-gharargah-project-context-menu="">
            {menuItems}
          </ContextMenuContent>
        </ContextMenu>

        <SidebarMenuAction
          showOnHover
          aria-label={`New session in ${project.name}`}
          onClick={() => projectActions.onNewSession(project)}
          data-gharargah-sidebar-project-new={project.id}
        >
          <Plus className="size-3.5" />
        </SidebarMenuAction>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction
              showOnHover
              aria-label={`Project actions for ${project.name}`}
              className="right-7"
            >
              <MoreHorizontal className="size-3.5" />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => projectActions.onNewSession(project)}>
              New session
            </DropdownMenuItem>
            {projectActions.onRevealFolder ? (
              <DropdownMenuItem
                onSelect={() => projectActions.onRevealFolder?.(project)}
              >
                Reveal project folder
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            {projectActions.onRemoveProject ? (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => projectActions.onRemoveProject?.(project)}
              >
                Remove project
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        <CollapsibleContent>
          <SidebarMenuSub data-gharargah-sidebar-project-sessions={project.id}>
            {project.sessions.length === 0 ? (
              <SidebarMenuSubItem>
                <div className="flex flex-col gap-2 px-2 py-3 text-3xs text-muted-foreground">
                  <span>No sessions in this project</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-3xs"
                    onClick={() => projectActions.onNewSession(project)}
                  >
                    New Session
                  </Button>
                </div>
              </SidebarMenuSubItem>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-0.5">
                  <div
                    className="px-2 pt-1 text-3xs font-medium uppercase tracking-wide text-muted-foreground"
                    data-gharargah-sidebar-section-label="active"
                  >
                    Active
                  </div>
                  {activeSessions.length === 0 ? (
                    <div className="px-2 py-1.5 text-3xs text-muted-foreground">
                      No active sessions
                    </div>
                  ) : (
                    renderSessionList(activeSessions, "active")
                  )}
                </div>
                {archivedSessions.length > 0 ? (
                  <div className="flex flex-col gap-0.5">
                    <div
                      className="px-2 pt-1 text-3xs font-medium uppercase tracking-wide text-muted-foreground"
                      data-gharargah-sidebar-section-label="archived"
                    >
                      Archived
                    </div>
                    {renderSessionList(archivedSessions, "archived")}
                  </div>
                ) : null}
              </div>
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}
