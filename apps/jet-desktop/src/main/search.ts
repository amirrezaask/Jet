import type { IpcMain } from "electron"
import { projectSearch } from "@jet/node-host"

export function registerSearchHandlers(ipcMain: IpcMain) {
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
