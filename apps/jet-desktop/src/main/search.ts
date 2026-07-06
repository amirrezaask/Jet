import type { IpcMain } from "electron"
import {
  fileSearch,
  isGitWorkspace,
  isSearchScanReady,
  listProjectFiles,
  projectSearch,
  trackFileAccess,
} from "@jet/node-host"

export function registerSearchHandlers(ipcMain: IpcMain) {
  ipcMain.handle("search:listFiles", async (_e, rootUri: string) => listProjectFiles(rootUri))
  ipcMain.handle(
    "search:project",
    async (
      _e,
      rootUri: string,
      query: string,
      opts?: { caseSensitive?: boolean; regex?: boolean; fuzzy?: boolean },
    ) => projectSearch(rootUri, query, opts),
  )
  ipcMain.handle(
    "search:fileSearch",
    async (
      _e,
      rootUri: string,
      query: string,
      opts?: { pageSize?: number; currentFile?: string },
    ) => fileSearch(rootUri, query, opts),
  )
  ipcMain.handle(
    "search:trackFileAccess",
    async (_e, rootUri: string, query: string, path: string) => {
      await trackFileAccess(rootUri, query, path)
    },
  )
  ipcMain.handle("search:isScanReady", (_e, rootUri: string) => isSearchScanReady(rootUri))
  ipcMain.handle("search:isSupported", (_e, rootUri: string) => isGitWorkspace(rootUri))
}
