import type { IpcMain } from "electron"
import {
  gitIsRepo,
  gitStatus,
  gitDiff,
  gitBranch,
  gitStage,
  gitUnstage,
  gitCommit,
  gitBranches,
  gitCheckout,
} from "@jet/node-host"

export function registerGitHandlers(ipcMain: IpcMain) {
  ipcMain.handle("git:isRepo", async (_e, rootUri: string) => gitIsRepo(rootUri))
  ipcMain.handle("git:status", async (_e, rootUri: string) => gitStatus(rootUri))
  ipcMain.handle(
    "git:diff",
    async (_e, rootUri: string, opts?: { path?: string; staged?: boolean }) => gitDiff(rootUri, opts),
  )
  ipcMain.handle("git:branch", async (_e, rootUri: string) => gitBranch(rootUri))
  ipcMain.handle("git:stage", async (_e, rootUri: string, paths: string[]) => gitStage(rootUri, paths))
  ipcMain.handle("git:unstage", async (_e, rootUri: string, paths: string[]) =>
    gitUnstage(rootUri, paths),
  )
  ipcMain.handle("git:commit", async (_e, rootUri: string, message: string) =>
    gitCommit(rootUri, message),
  )
  ipcMain.handle("git:branches", async (_e, rootUri: string) => gitBranches(rootUri))
  ipcMain.handle("git:checkout", async (_e, rootUri: string, branch: string) =>
    gitCheckout(rootUri, branch),
  )
}
