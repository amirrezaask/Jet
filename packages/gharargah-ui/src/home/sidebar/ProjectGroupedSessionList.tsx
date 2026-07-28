import { SidebarMenu } from "@/components/ui/sidebar.js"
import type { SessionSidebarActions } from "./SessionContextMenu.js"
import {
  ProjectSidebarItem,
  type ProjectSidebarActions,
} from "./ProjectSidebarItem.js"
import type { SidebarGroupResult, SidebarSession } from "./types.js"

export type ProjectGroupedSessionListProps = {
  groups: SidebarGroupResult[]
  expandedProjectIds: Set<string>
  onExpandedChange: (projectId: string, expanded: boolean) => void
  selectedSessionId: string | null
  sessionActions: SessionSidebarActions
  projectActions: ProjectSidebarActions
  onSelectSession: (session: SidebarSession) => void
  compact?: boolean
}

export function ProjectGroupedSessionList({
  groups,
  expandedProjectIds,
  onExpandedChange,
  selectedSessionId,
  sessionActions,
  projectActions,
  onSelectSession,
  compact = false,
}: ProjectGroupedSessionListProps) {
  if (groups.length === 0) {
    return (
      <div
        className="px-3 py-6 text-center text-xs text-muted-foreground"
        data-gharargah-sidebar-empty="no-projects"
      >
        No matching sessions
        <p className="mt-1 text-3xs">Try another title, project, or agent name.</p>
      </div>
    )
  }

  return (
    <SidebarMenu
      className="gap-0.5 px-1"
      data-gharargah-sidebar-project-list=""
      data-gharargah-list-panel="sidebar-projects"
    >
      {groups.map(group => {
        const project = group.project
        if (!project) return null
        return (
          <ProjectSidebarItem
            key={project.id}
            project={project}
            expanded={expandedProjectIds.has(project.id)}
            onExpandedChange={next => onExpandedChange(project.id, next)}
            selectedSessionId={selectedSessionId}
            sessionActions={sessionActions}
            projectActions={projectActions}
            onSelectSession={onSelectSession}
            compact={compact}
          />
        )
      })}
    </SidebarMenu>
  )
}
