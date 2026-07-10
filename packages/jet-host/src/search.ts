import {
  fileSearch,
  isGitWorkspace,
  isSearchScanReady,
  listProjectFiles,
  projectSearch,
  trackFileAccess,
} from "@jet/node-host"
import type { HostRegistry } from "./registry.js"

export function registerSearchHandlers(registry: HostRegistry): void {
  registry.handle("search:listFiles", async args => listProjectFiles(args[0] as string))
  registry.handle("search:project", async args =>
    projectSearch(
      args[0] as string,
      args[1] as string,
      args[2] as { caseSensitive?: boolean; regex?: boolean; fuzzy?: boolean } | undefined,
    ),
  )
  registry.handle("search:fileSearch", async args =>
    fileSearch(
      args[0] as string,
      args[1] as string,
      args[2] as { pageSize?: number; currentFile?: string } | undefined,
    ),
  )
  registry.handle("search:trackFileAccess", async args => {
    await trackFileAccess(args[0] as string, args[1] as string, args[2] as string)
  })
  registry.handle("search:isScanReady", async args => isSearchScanReady(args[0] as string))
  registry.handle("search:isSupported", async args => isGitWorkspace(args[0] as string))
}
