import type { IpcMain, OpenDialogOptions } from "electron"
import fs from "node:fs/promises"
import path from "node:path"
import type { Dialog } from "electron"

function uriToPath(uri: string): string {
  if (uri.startsWith("file://")) {
    const p = decodeURIComponent(uri.slice(7))
    return process.platform === "win32" && p.startsWith("/") ? p.slice(1) : p
  }
  return uri
}

function pathToUri(p: string): string {
  return `file://${p.replace(/\\/g, "/")}`
}

export function registerFsHandlers(ipcMain: IpcMain, dialog: Dialog) {
  ipcMain.handle("fs:readFile", async (_e, uri: string) => {
    return fs.readFile(uriToPath(uri), "utf8")
  })

  ipcMain.handle("fs:writeFile", async (_e, uri: string, content: string) => {
    await fs.writeFile(uriToPath(uri), content, "utf8")
  })

  ipcMain.handle("fs:readDir", async (_e, uri: string) => {
    const dirPath = uriToPath(uri)
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    return entries.map(entry => ({
      uri: pathToUri(path.join(dirPath, entry.name)),
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }))
  })

  ipcMain.handle("fs:stat", async (_e, uri: string) => {
    const p = uriToPath(uri)
    const stat = await fs.stat(p)
    return {
      uri,
      isDirectory: stat.isDirectory(),
      size: stat.size,
    }
  })

  ipcMain.handle("fs:showOpenFolderDialog", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    } as OpenDialogOptions)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
}
