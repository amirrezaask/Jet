import type { IpcMain, BrowserWindow } from "electron"
import {
  startLspSession,
  stopLspSession,
  stopAllLspSessions,
  setLspCrashHandler,
} from "@jet/node-host"

export {
  startLspSession,
  stopLspSession,
  stopAllLspSessions,
  setLspCrashHandler,
} from "@jet/node-host"

export function registerLspHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null) {
  ipcMain.handle(
    "lsp:start",
    async (
      _e,
      rootUri: string,
      _languageId: string,
      command?: string,
      args?: string[],
    ) => {
      const result = await startLspSession({
        rootUri,
        command,
        args,
        onSpawnError: id => getWindow()?.webContents.send("lsp:crashed", id),
      })
      return result
    },
  )

  ipcMain.handle("lsp:stop", async (_e, id: string) => {
    await stopLspSession(id)
  })

  ipcMain.on("lsp:registerCrashListener", () => {
    /* handshake — renderer uses onCrashed via preload */
  })
}

export function stopAllLsp(): void {
  stopAllLspSessions()
}
