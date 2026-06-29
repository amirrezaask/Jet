import type { IpcMain } from "electron"
import { getGitWorker } from "./background-pool.js"

export function registerGitHandlers(ipcMain: IpcMain) {
  ipcMain.handle("git:isRepo", async (_e, rootUri: string) =>
    getGitWorker().dispatch<boolean>("isRepo", { rootUri }),
  )
  ipcMain.handle("git:status", async (_e, rootUri: string) =>
    getGitWorker().dispatch("status", { rootUri }),
  )
  ipcMain.handle(
    "git:diff",
    async (_e, rootUri: string, opts?: { path?: string; staged?: boolean }) =>
      getGitWorker().dispatch<string>("diff", { rootUri, ...opts }),
  )
  ipcMain.handle("git:branch", async (_e, rootUri: string) =>
    getGitWorker().dispatch<string | null>("branch", { rootUri }),
  )
  ipcMain.handle("git:stage", async (_e, rootUri: string, paths: string[]) => {
    await getGitWorker().dispatch<void>("stage", { rootUri, paths })
  })
  ipcMain.handle("git:unstage", async (_e, rootUri: string, paths: string[]) => {
    await getGitWorker().dispatch<void>("unstage", { rootUri, paths })
  })
  ipcMain.handle("git:commit", async (_e, rootUri: string, message: string) => {
    await getGitWorker().dispatch<void>("commit", { rootUri, message })
  })
  ipcMain.handle("git:branches", async (_e, rootUri: string) =>
    getGitWorker().dispatch<string[]>("branches", { rootUri }),
  )
  ipcMain.handle("git:checkout", async (_e, rootUri: string, branch: string) => {
    await getGitWorker().dispatch<void>("checkout", { rootUri, branch })
  })
}
