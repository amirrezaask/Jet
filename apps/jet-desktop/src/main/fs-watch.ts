import type { IpcMain, BrowserWindow } from "electron"
import fs from "node:fs"
import path from "node:path"
import { pathToFileUri } from "@jet/shared"

const watchers = new Map<string, fs.FSWatcher>()
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

function uriToPath(uri: string): string {
  if (uri.startsWith("file://")) {
    const p = decodeURIComponent(uri.slice(7))
    return process.platform === "win32" && p.startsWith("/") ? p.slice(1) : p
  }
  return uri
}

export function registerFsWatchHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null) {
  ipcMain.handle("fs:watchWorkspace", async (_e, rootUri: string) => {
    const rootPath = uriToPath(rootUri)
    if (watchers.has(rootUri)) return
    const watcher = fs.watch(rootPath, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const filePath = path.join(rootPath, filename.toString())
      const uri = pathToFileUri(filePath)
      const key = uri
      const existing = debounceTimers.get(key)
      if (existing) clearTimeout(existing)
      debounceTimers.set(
        key,
        setTimeout(() => {
          debounceTimers.delete(key)
          getWindow()?.webContents.send("fs:changed", uri)
        }, 300),
      )
    })
    watchers.set(rootUri, watcher)
  })

  ipcMain.handle("fs:unwatchWorkspace", async (_e, rootUri: string) => {
    const w = watchers.get(rootUri)
    if (w) {
      w.close()
      watchers.delete(rootUri)
    }
  })
}

export function stopAllWatchers() {
  for (const w of watchers.values()) w.close()
  watchers.clear()
  for (const t of debounceTimers.values()) clearTimeout(t)
  debounceTimers.clear()
}
