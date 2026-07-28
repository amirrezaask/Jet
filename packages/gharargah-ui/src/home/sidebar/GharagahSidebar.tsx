import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react"
import { FolderPlus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button.js"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenuSkeleton,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar.js"
import { cn } from "@/lib/utils.js"
import {
  applyStickySelectedOrder,
  sortSessionsUnreadFirst,
} from "./grouping/index.js"
import { filterSessionsByQuery } from "./filter-sessions.js"
import type { ProjectSidebarActions } from "./ProjectSidebarItem.js"
import type { SessionSidebarActions } from "./SessionContextMenu.js"
import { SidebarFooterStatus } from "./SidebarFooterStatus.js"
import {
  SidebarProjectFilter,
  type SidebarProjectFilterId,
} from "./SidebarProjectFilter.js"
import { SidebarSearch } from "./SidebarSearch.js"
import { UnreadFirstSessionList } from "./UnreadFirstSessionList.js"
import type { SidebarProject, SidebarSession } from "./types.js"

export const SIDEBAR_WIDTH_MIN = 240
export const SIDEBAR_WIDTH_MAX = 480
export const SIDEBAR_WIDTH_DEFAULT = 300

export type GharagahSidebarProps = {
  projects: SidebarProject[]
  sessions: SidebarSession[]
  /** `null` = All projects. */
  projectFilterId: SidebarProjectFilterId
  onProjectFilterIdChange: (id: SidebarProjectFilterId) => void
  selectedSessionId: string | null
  onSelectSession: (session: SidebarSession) => void
  onNewSession: (projectRootUri?: string) => void
  onAddProject?: () => void
  sessionActions: SessionSidebarActions
  projectActions: ProjectSidebarActions
  onOpenSettings?: () => void
  /** Persist expanded sidebar width (px) after a drag resize. */
  onSidebarWidthChange?: (widthPx: number) => void
  serverLabel?: string
  connected?: boolean
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  className?: string
}

export function GharagahSidebar({
  projects,
  sessions,
  projectFilterId,
  onProjectFilterIdChange,
  selectedSessionId,
  onSelectSession,
  onNewSession,
  onAddProject,
  sessionActions,
  projectActions,
  onOpenSettings,
  onSidebarWidthChange,
  serverLabel,
  connected = true,
  loading = false,
  error = null,
  onRetry,
  className,
}: GharagahSidebarProps) {
  const { state, isMobile, setOpenMobile } = useSidebar()
  const compact = state === "collapsed" && !isMobile
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [stickyOrder, setStickyOrder] = useState<string[]>([])
  const prevSelectedRef = useRef<string | null>(null)

  const filteredSessions = useMemo(() => {
    let list = sessions
    if (projectFilterId != null) {
      const project = projects.find(p => p.path === projectFilterId)
      if (project) {
        list = list.filter(s => s.projectId === project.id)
      } else {
        list = []
      }
    }
    return filterSessionsByQuery(list, searchQuery)
  }, [sessions, projects, projectFilterId, searchQuery])

  // Sticky order: capture order when selection changes; hold while selected.
  useEffect(() => {
    if (selectedSessionId !== prevSelectedRef.current) {
      prevSelectedRef.current = selectedSessionId
      const sorted = sortSessionsUnreadFirst(filteredSessions)
      setStickyOrder(sorted.map(s => s.id))
    }
  }, [selectedSessionId, filteredSessions])

  const visibleSessions = useMemo(() => {
    const sorted = sortSessionsUnreadFirst(filteredSessions)
    return applyStickySelectedOrder(sorted, stickyOrder, selectedSessionId)
  }, [filteredSessions, stickyOrder, selectedSessionId])

  const handleSelectSession = useCallback(
    (session: SidebarSession) => {
      onSelectSession(session)
      if (isMobile) setOpenMobile(false)
    },
    [onSelectSession, isMobile, setOpenMobile],
  )

  const handleNewSession = useCallback(() => {
    if (projectFilterId != null) {
      const project = projects.find(p => p.path === projectFilterId)
      if (project) {
        onNewSession(project.rootUri)
        return
      }
    }
    onNewSession()
  }, [projectFilterId, projects, onNewSession])

  const focusSearch = useCallback(() => {
    searchRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (document.documentElement.dataset.gharargahSessionLayout !== "sidebar") {
          return
        }
        e.preventDefault()
        focusSearch()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [focusSearch])

  const onListKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (searchQuery) {
        setSearchQuery("")
        e.preventDefault()
        return
      }
      if (isMobile) setOpenMobile(false)
      return
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return
    if (visibleSessions.length === 0) return
    const idx = visibleSessions.findIndex(s => s.id === selectedSessionId)
    if (e.key === "Enter" && idx >= 0) {
      handleSelectSession(visibleSessions[idx]!)
      e.preventDefault()
      return
    }
    let next = idx
    if (e.key === "ArrowDown") next = Math.min(visibleSessions.length - 1, idx + 1)
    if (e.key === "ArrowUp") next = Math.max(0, idx < 0 ? 0 : idx - 1)
    if (next !== idx && visibleSessions[next]) {
      handleSelectSession(visibleSessions[next]!)
      e.preventDefault()
    }
  }

  return (
    <Sidebar
      collapsible="icon"
      className={cn("border-r border-sidebar-border", className)}
      data-gharargah-mission-sidebar=""
      data-gharargah-sidebar-state={state}
      data-gharargah-sidebar-project-filter-active={projectFilterId ?? "all"}
    >
      <SidebarHeader className="gap-1.5 border-b border-sidebar-border p-2">
        {!compact ? (
          <>
            <div className="flex items-center gap-1.5 px-1">
              <SidebarTrigger className="size-7 shrink-0" aria-label="Toggle sidebar" />
              <SidebarSearch
                value={searchQuery}
                onChange={setSearchQuery}
                inputRef={searchRef}
                className="min-w-0 flex-1 px-0"
              />
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                className="size-8 shrink-0 rounded-lg"
                aria-label="New Session"
                data-gharargah-sidebar-new-session=""
                onClick={handleNewSession}
              >
                <Plus className="size-3.5" aria-hidden />
              </Button>
            </div>
            <div className="flex items-center gap-1.5 px-1">
              <SidebarProjectFilter
                projects={projects}
                value={projectFilterId}
                onChange={onProjectFilterIdChange}
                projectActions={projectActions}
              />
              {onAddProject ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  className="size-8 shrink-0 rounded-lg"
                  aria-label="Add Project"
                  data-gharargah-sidebar-add-project=""
                  onClick={onAddProject}
                >
                  <FolderPlus className="size-3.5" aria-hidden />
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1 px-0.5">
            <SidebarTrigger className="size-7" aria-label="Toggle sidebar" />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="size-7"
              aria-label="New Session"
              data-gharargah-sidebar-new-session=""
              onClick={handleNewSession}
            >
              <Plus className="size-3.5" aria-hidden />
            </Button>
            {onAddProject ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="size-7"
                aria-label="Add Project"
                data-gharargah-sidebar-add-project=""
                onClick={onAddProject}
              >
                <FolderPlus className="size-3.5" aria-hidden />
              </Button>
            ) : null}
          </div>
        )}
      </SidebarHeader>

      <SidebarContent
        className="gap-0"
        onKeyDown={onListKeyDown}
        data-gharargah-sidebar-content=""
      >
        {loading ? (
          <SidebarGroup>
            <SidebarGroupContent className="flex flex-col gap-1 px-2 py-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <SidebarMenuSkeleton key={i} showIcon />
              ))}
            </SidebarGroupContent>
          </SidebarGroup>
        ) : error ? (
          <div className="flex flex-col gap-2 px-3 py-6 text-center text-xs">
            <p className="text-destructive">{error}</p>
            {onRetry ? (
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : projects.length === 0 ? (
          <div
            className="flex flex-col items-center gap-3 px-3 py-8 text-center"
            data-gharargah-sidebar-empty="no-projects"
          >
            <p className="text-xs font-medium">No projects yet</p>
            <p className="text-3xs text-muted-foreground">
              Add a project to start a session.
            </p>
            {onAddProject ? (
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                onClick={onAddProject}
              >
                <FolderPlus className="size-3.5" aria-hidden />
                Add Project
              </Button>
            ) : null}
          </div>
        ) : (
          <SidebarGroup className="flex min-h-0 flex-1 flex-col p-0">
            <SidebarGroupContent className="flex min-h-0 flex-1 flex-col">
              <UnreadFirstSessionList
                sessions={visibleSessions}
                selectedSessionId={selectedSessionId}
                actions={sessionActions}
                onSelectSession={handleSelectSession}
                compact={compact}
                showProjectMeta={projectFilterId == null}
              />
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {!compact ? (
        <SidebarFooterStatus
          connected={connected}
          serverLabel={serverLabel}
          onOpenSettings={onOpenSettings}
        />
      ) : null}
      <SidebarRail
        onResize={onSidebarWidthChange}
        minWidth={SIDEBAR_WIDTH_MIN}
        maxWidth={SIDEBAR_WIDTH_MAX}
      />
    </Sidebar>
  )
}

/** Controlled width style helper for SidebarProvider. */
export function sidebarWidthStyle(widthPx: number): CSSProperties {
  const clamped = Math.max(
    SIDEBAR_WIDTH_MIN,
    Math.min(SIDEBAR_WIDTH_MAX, widthPx),
  )
  return { "--sidebar-width": `${clamped}px` } as CSSProperties
}
