import type { IpcMain, OpenDialogOptions } from "electron"
import type { Dialog } from "electron"
import { getFsWorker } from "./background-pool.js"

export function registerFsHandlers(ipcMain: IpcMain, dialog: Dialog) {
  ipcMain.handle("fs:readFile", async (_e, uri: string) =>
    getFsWorker().dispatch<string>("readFile", { uri }),
  )

  ipcMain.handle("fs:writeFile", async (_e, uri: string, content: string) => {
    await getFsWorker().dispatch<void>("writeFile", { uri, content })
  })

  ipcMain.handle("fs:readDir", async (_e, uri: string) =>
    getFsWorker().dispatch("readDir", { uri }),
  )

  ipcMain.handle("fs:stat", async (_e, uri: string) => getFsWorker().dispatch("stat", { uri }))

  ipcMain.handle("fs:showOpenFolderDialog", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    } as OpenDialogOptions)
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle("fs:showSaveFileDialog", async (_e, defaultPath?: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath,
    })
    return result.canceled ? null : result.filePath ?? null
  })
}
