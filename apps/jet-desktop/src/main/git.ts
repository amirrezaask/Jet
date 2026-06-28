import type { IpcMain } from "electron"
import { gitIsRepo, gitStatus, gitDiff } from "@jet/node-host"

export function registerGitHandlers(ipcMain: IpcMain) {
  ipcMain.handle("git:isRepo", async (_e, rootUri: string) => gitIsRepo(rootUri))

  ipcMain.handle("git:status", async (_e, rootUri: string) => gitStatus(rootUri))

  ipcMain.handle(
    "git:diff",
    async (_e, rootUri: string, opts?: { path?: string; staged?: boolean }) => gitDiff(rootUri, opts),
  )
}
