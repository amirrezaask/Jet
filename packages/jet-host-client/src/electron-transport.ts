import type { JetHostTransport } from "./transport.js"

type IpcRendererLike = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void
}

export function createElectronTransport(ipcRenderer: IpcRendererLike): JetHostTransport {
  return {
    invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
      return ipcRenderer.invoke(channel, ...args) as Promise<T>
    },
    on(channel: string, listener: (...args: unknown[]) => void) {
      const handler = (_event: unknown, ...args: unknown[]) => listener(...args)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
  }
}
