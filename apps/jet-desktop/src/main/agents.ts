import type { IpcMain, BrowserWindow } from "electron"
import { uriToPath } from "@jet/node-host"
import {
  buildWorkspaceSnapshot,
  newAgentThread,
  touchThread,
  type AgentThread,
  type CreateAgentThreadInput,
  type InterruptAgentTurnInput,
  type SetAgentThreadArchivedInput,
  type UpdateAgentThreadSettingsInput,
} from "@jet/agents"
import { listProviders, refreshProviders } from "./agent-providers.js"
import {
  readAgentStore,
  readAgentThread,
  writeAgentStore,
} from "./agent-store.js"
import { AgentTurnRunner } from "./agent-turn-runner.js"

function publishThreadUpdated(
  getWindow: () => BrowserWindow | null,
  thread: AgentThread,
): void {
  const wc = getWindow()?.webContents
  if (!wc || wc.isDestroyed()) return
  wc.send("agents:threadUpdated", thread)
}

async function listThreads(workspaceRootUri: string, workspaceRootPath: string) {
  const rootPath = workspaceRootPath || uriToPath(workspaceRootUri)
  const payload = await readAgentStore(rootPath)
  return buildWorkspaceSnapshot(workspaceRootUri, rootPath, payload.threads)
}

async function createThread(input: CreateAgentThreadInput): Promise<AgentThread> {
  const rootPath = input.workspaceRootPath || uriToPath(input.workspaceRootUri)
  const payload = await readAgentStore(rootPath)
  const thread = newAgentThread({
    ...input,
    workspaceRootPath: rootPath,
  })
  payload.threads.unshift(thread)
  await writeAgentStore(rootPath, payload)
  return thread
}

async function setArchived(input: SetAgentThreadArchivedInput): Promise<AgentThread | null> {
  const rootPath = input.workspaceRootPath || uriToPath(input.workspaceRootUri)
  const payload = await readAgentStore(rootPath)
  const index = payload.threads.findIndex(thread => thread.id === input.threadId)
  if (index < 0) return null
  const next = touchThread(payload.threads[index]!, {
    archivedAt: input.archived ? new Date().toISOString() : null,
  })
  payload.threads[index] = next
  await writeAgentStore(rootPath, payload)
  return next
}

async function updateThreadSettings(
  input: UpdateAgentThreadSettingsInput,
): Promise<AgentThread | null> {
  const rootPath = input.workspaceRootPath || uriToPath(input.workspaceRootUri)
  const payload = await readAgentStore(rootPath)
  const index = payload.threads.findIndex(thread => thread.id === input.threadId)
  if (index < 0) return null
  const patch: { provider?: string | null; model?: string | null } = {}
  if (input.provider !== undefined) patch.provider = input.provider
  if (input.model !== undefined) patch.model = input.model
  const next = touchThread(payload.threads[index]!, patch)
  payload.threads[index] = next
  await writeAgentStore(rootPath, payload)
  return next
}

export function registerAgentHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
) {
  const turnRunner = new AgentTurnRunner(getWindow)

  ipcMain.handle("agents:listProviders", () => listProviders())
  ipcMain.handle("agents:refreshProviders", () => refreshProviders())
  ipcMain.handle("agents:listThreads", (_e, workspaceRootUri: string, workspaceRootPath: string) =>
    listThreads(workspaceRootUri, workspaceRootPath),
  )
  ipcMain.handle(
    "agents:readThread",
    (_e, workspaceRootUri: string, workspaceRootPath: string, threadId: string) =>
      readAgentThread(workspaceRootPath || uriToPath(workspaceRootUri), threadId),
  )
  ipcMain.handle("agents:createThread", (_e, input: CreateAgentThreadInput) => createThread(input))
  ipcMain.handle("agents:sendMessage", (_e, input) => turnRunner.sendMessage(input))
  ipcMain.handle("agents:interruptTurn", (_e, input: InterruptAgentTurnInput) =>
    turnRunner.interruptTurn(input),
  )
  ipcMain.handle("agents:setArchived", (_e, input: SetAgentThreadArchivedInput) => {
    return setArchived(input).then(thread => {
      if (thread) publishThreadUpdated(getWindow, thread)
      return thread
    })
  })
  ipcMain.handle("agents:updateThreadSettings", (_e, input: UpdateAgentThreadSettingsInput) => {
    return updateThreadSettings(input).then(thread => {
      if (thread) publishThreadUpdated(getWindow, thread)
      return thread
    })
  })
}
