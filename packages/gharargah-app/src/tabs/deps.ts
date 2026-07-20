import { getThemeById } from "@gharargah/ui"
import type { WorkspaceService } from "@gharargah/workspace"
import type { PanelId } from "@gharargah/shared"

export type GharargahTheme = ReturnType<typeof getThemeById>

/**
 * Ambient dependencies threaded into contributor tab types when they are
 * registered at app boot.
 */
export type TabContributorDeps = {
  workspace: WorkspaceService
  getTheme: () => GharargahTheme
  closeTerminalTab: (panelId: PanelId, tabId: string) => void
  onTerminalTitleChange: (tabId: string, title: string) => void
}
