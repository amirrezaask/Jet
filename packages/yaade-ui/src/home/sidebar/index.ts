export { GharagahSidebar, sidebarWidthStyle, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_DEFAULT, type GharagahSidebarProps } from "./GharagahSidebar.js"
export {
  SidebarProjectFilter,
  type SidebarProjectFilterId,
  type SidebarProjectFilterProps,
} from "./SidebarProjectFilter.js"
export { SidebarSearch } from "./SidebarSearch.js"
export { UnreadFirstSessionList } from "./UnreadFirstSessionList.js"
export { ProjectSidebarItem, type ProjectSidebarActions } from "./ProjectSidebarItem.js"
export { SessionSidebarItem } from "./SessionSidebarItem.js"
export { SessionStatusIndicator, AgentProviderIcon } from "./SessionStatusIndicator.js"
export {
  SessionContextMenu,
  type SessionSidebarActions,
} from "./SessionContextMenu.js"
export { SidebarFooterStatus } from "./SidebarFooterStatus.js"
export {
  applyGrouping,
  applyStickyListOrder,
  applyStickySelectedOrder,
  getGroupingDefinition,
  projectGrouping,
  sortProjects,
  sortSessionsInProject,
  sortSessionsUnreadFirst,
  unreadFirstGrouping,
} from "./grouping/index.js"
export {
  filterProjectsBySessionQuery,
  filterSessionsByQuery,
  sessionMatchesQuery,
} from "./filter-sessions.js"
export { mapHomeGroupsToSidebar, mapTerminalToSidebarSession } from "./map-home-to-sidebar.js"
export type {
  SidebarGroupingDefinition,
  SidebarGroupingStrategy,
  SidebarGroupResult,
  SidebarProject,
  SidebarSession,
  SidebarSessionStatus,
} from "./types.js"
