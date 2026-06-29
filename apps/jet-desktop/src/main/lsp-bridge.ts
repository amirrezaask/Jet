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
    ) =>
      new Promise((resolve, reject) => {
        setImmediate(() => {
          void startLspSession({
            rootUri,
            command,
            args,
            onSpawnError: id => getWindow()?.webContents.send("lsp:crashed", id),
          })
            .then(resolve)
            .catch(reject)
        })
      }),
  )

  ipcMain.handle("lsp:stop", async (_e, id: string) => {
    await new Promise<void>((resolve, reject) => {
      setImmediate(() => {
        void stopLspSession(id).then(resolve).catch(reject)
      })
    })
  })

  ipcMain.on("lsp:registerCrashListener", () => {
    /* handshake — renderer uses onCrashed via preload */
  })
}

export function stopAllLsp(): void {
  stopAllLspSessions()
}
