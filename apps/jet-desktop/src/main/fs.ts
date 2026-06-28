import type { IpcMain, OpenDialogOptions } from "electron"
import type { Dialog } from "electron"
import { readFile, writeFile, readDir, stat } from "@jet/node-host"

export function registerFsHandlers(ipcMain: IpcMain, dialog: Dialog) {
  ipcMain.handle("fs:readFile", async (_e, uri: string) => readFile(uri))

  ipcMain.handle("fs:writeFile", async (_e, uri: string, content: string) => {
    await writeFile(uri, content)
  })

  ipcMain.handle("fs:readDir", async (_e, uri: string) => readDir(uri))

  ipcMain.handle("fs:stat", async (_e, uri: string) => stat(uri))

  ipcMain.handle("fs:showOpenFolderDialog", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    } as OpenDialogOptions)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
}
