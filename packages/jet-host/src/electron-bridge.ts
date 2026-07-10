import type { IpcMain, WebContents } from "electron"
import {
  registerHostRenderer,
  unregisterHostRenderer,
  type HostRenderer,
} from "./host-renderer.js"
import type { HostRegistry } from "./registry.js"

function rendererFromWebContents(webContents: WebContents): HostRenderer {
  return {
    send(channel: string, ...args: unknown[]) {
      if (webContents.isDestroyed()) return
      webContents.send(channel, ...args)
    },
    isDestroyed() {
      return webContents.isDestroyed()
    },
  }
}

export function wireRegistryToElectron(ipcMain: IpcMain, registry: HostRegistry): void {
  for (const channel of registry.channels()) {
    ipcMain.handle(channel, async (event, ...args) =>
      registry.invoke(channel, args, String(event.sender.id)),
    )
  }
}

export function bindElectronRenderer(webContents: WebContents): void {
  const clientId = String(webContents.id)
  registerHostRenderer(clientId, rendererFromWebContents(webContents))
  webContents.once("destroyed", () => unregisterHostRenderer(clientId))
}
