import { pathToFileUri } from "@gharargah/shared"
import type { LaunchConfig } from "@gharargah/workspace"

export function bootstrapFromLaunch(
  openWorkspace: (path: string) => void | Promise<void>,
  openFile: (uri: string, path: string) => void,
  config: LaunchConfig | null,
): void {
  if (!config) return
  requestAnimationFrame(() => {
    void (async () => {
      await openWorkspace(config.workspacePath)
      if (config.filePath) {
        openFile(pathToFileUri(config.filePath), config.filePath)
      }
    })()
  })
}
