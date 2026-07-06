import type { IpcMain, BrowserWindow } from "electron"
import { AgentHost } from "@jet/node-host"
import type {
  AgentEvent,
  AgentRespondApprovalRequest,
  AgentSendTurnRequest,
  AgentStartSessionRequest,
} from "@jet/agents"

let host: AgentHost | null = null

function getHost(getWindow: () => BrowserWindow | null): AgentHost {
  if (!host) {
    host = new AgentHost({
      onEvent: (event: AgentEvent) => {
        getWindow()?.webContents.send("agents:event", event)
      },
    })
  }
  return host
}

export function registerAgentHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle("agents:listProviders", () => getHost(getWindow).listProviders())

  ipcMain.handle("agents:listSessions", (_e, folderId?: string) => {
    return getHost(getWindow).listSessions(folderId)
  })

  ipcMain.handle("agents:startSession", (_e, req: AgentStartSessionRequest) =>
    getHost(getWindow).startSession(req),
  )

  ipcMain.handle("agents:stopSession", (_e, sessionId: string) =>
    getHost(getWindow).stopSession(sessionId),
  )

  ipcMain.handle("agents:stopAllForFolder", (_e, folderId: string) =>
    getHost(getWindow).stopAllForFolder(folderId),
  )

  ipcMain.handle("agents:sendTurn", (_e, req: AgentSendTurnRequest) =>
    getHost(getWindow).sendTurn(req),
  )

  ipcMain.handle("agents:interrupt", (_e, sessionId: string) =>
    getHost(getWindow).interrupt(sessionId),
  )

  ipcMain.handle("agents:respondApproval", (_e, req: AgentRespondApprovalRequest) =>
    getHost(getWindow).respondApproval(req),
  )
}

export async function stopAllAgents(): Promise<void> {
  await host?.stopAll()
}
