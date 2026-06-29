import type { IpcMain } from "electron"
import { getSearchWorker } from "./background-pool.js"

export function registerSearchHandlers(ipcMain: IpcMain) {
  ipcMain.handle("search:listFiles", async (_e, rootUri: string) =>
    getSearchWorker().dispatch<string[]>("listFiles", { rootUri }),
  )
  ipcMain.handle(
    "search:project",
    async (
      _e,
      rootUri: string,
      query: string,
      opts?: { caseSensitive?: boolean; regex?: boolean },
    ) => getSearchWorker().dispatch("project", { rootUri, query, ...opts }),
  )
}
