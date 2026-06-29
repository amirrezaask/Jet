import { pathToFileUri } from "@jet/shared"
import type { LaunchConfig } from "@jet/workspace"

export function bootstrapFromLaunch(
  openWorkspace: (path: string) => void,
  openFile: (uri: string, path: string) => void,
  config: LaunchConfig | null,
): void {
  if (!config) return
  // Paint shell before folder open (VS Code pattern).
  requestAnimationFrame(() => {
    openWorkspace(config.workspacePath)
    if (config.filePath) {
      requestAnimationFrame(() => {
        openFile(pathToFileUri(config.filePath!), config.filePath!)
      })
    }
  })
}
