import type { IpcMain } from "electron"
import { listProjectFiles, projectSearch } from "@jet/node-host"

export function registerSearchHandlers(ipcMain: IpcMain) {
  ipcMain.handle("search:listFiles", async (_e, rootUri: string) => listProjectFiles(rootUri))
  ipcMain.handle(
    "search:project",
    async (
      _e,
      rootUri: string,
      query: string,
      opts?: { caseSensitive?: boolean; regex?: boolean },
    ) => projectSearch(rootUri, query, opts),
  )
}
