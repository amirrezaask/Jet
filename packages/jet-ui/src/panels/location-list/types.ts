import type { ListItem, WorkspaceFolder, WorkspaceService } from "@jet/workspace"

/** Props shared by tab-mounted location list panels (search, problems, refs, …). */
export type LocationListTabProps = {
  listId: string
  workspace: WorkspaceService
  onOpenItem: (item: ListItem) => void
  getSearchFolders?: () => WorkspaceFolder[]
  autoFocus?: boolean
}
