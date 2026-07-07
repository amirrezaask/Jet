import { promises as fs } from "node:fs"
import path from "node:path"
import type { IpcMain } from "electron"
import { uriToPath } from "@jet/node-host"
import {
  buildWorkspaceSnapshot,
  newAgentThread,
  touchThread,
  type AgentThread,
  type CreateAgentThreadInput,
  type SendAgentMessageInput,
  type SetAgentThreadArchivedInput,
} from "@jet/agents"
import { listProviders, refreshProviders } from "./agent-providers.js"

type AgentStorePayload = {
  threads: AgentThread[]
}

function agentStorePath(rootPath: string): string {
  return path.join(rootPath, ".jet", "agents", "state.json")
}

async function readAgentStore(rootPath: string): Promise<AgentStorePayload> {
  const filePath = agentStorePath(rootPath)
  try {
    const raw = await fs.readFile(filePath, "utf8")
    const parsed = JSON.parse(raw) as Partial<AgentStorePayload>
    return {
      threads: Array.isArray(parsed.threads) ? parsed.threads : [],
    }
  } catch {
    return { threads: [] }
  }
}

async function writeAgentStore(rootPath: string, payload: AgentStorePayload): Promise<void> {
  const filePath = agentStorePath(rootPath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8")
}

async function listThreads(workspaceRootUri: string, workspaceRootPath: string) {
  const rootPath = workspaceRootPath || uriToPath(workspaceRootUri)
  const payload = await readAgentStore(rootPath)
  return buildWorkspaceSnapshot(workspaceRootUri, rootPath, payload.threads)
}

async function readThread(
  workspaceRootUri: string,
  workspaceRootPath: string,
  threadId: string,
): Promise<AgentThread | null> {
  const rootPath = workspaceRootPath || uriToPath(workspaceRootUri)
  const payload = await readAgentStore(rootPath)
  return payload.threads.find(thread => thread.id === threadId) ?? null
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

async function sendMessage(input: SendAgentMessageInput): Promise<AgentThread> {
  const rootPath = input.workspaceRootPath || uriToPath(input.workspaceRootUri)
  const payload = await readAgentStore(rootPath)
  const index = payload.threads.findIndex(thread => thread.id === input.threadId)
  if (index < 0) {
    throw new Error(`Unknown agent thread: ${input.threadId}`)
  }
  const thread = payload.threads[index]!
  const createdAt = new Date().toISOString()
  const next = touchThread(thread, {
    status: "idle",
    lastError: null,
    provider: input.provider ?? thread.provider ?? "codex",
    model: input.model ?? thread.model ?? "gpt-5",
    title:
      thread.messages.length === 0
        ? input.text.trim().slice(0, 64) || thread.title
        : thread.title,
    messages: [
      ...thread.messages,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: input.text,
        createdAt,
        updatedAt: createdAt,
        streaming: false,
      },
    ],
  })
  payload.threads[index] = next
  await writeAgentStore(rootPath, payload)
  return next
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

export function registerAgentHandlers(ipcMain: IpcMain) {
  ipcMain.handle("agents:listProviders", () => listProviders())
  ipcMain.handle("agents:refreshProviders", () => refreshProviders())
  ipcMain.handle("agents:listThreads", (_e, workspaceRootUri: string, workspaceRootPath: string) =>
    listThreads(workspaceRootUri, workspaceRootPath),
  )
  ipcMain.handle(
    "agents:readThread",
    (_e, workspaceRootUri: string, workspaceRootPath: string, threadId: string) =>
      readThread(workspaceRootUri, workspaceRootPath, threadId),
  )
  ipcMain.handle("agents:createThread", (_e, input: CreateAgentThreadInput) => createThread(input))
  ipcMain.handle("agents:sendMessage", (_e, input: SendAgentMessageInput) => sendMessage(input))
  ipcMain.handle("agents:setArchived", (_e, input: SetAgentThreadArchivedInput) =>
    setArchived(input),
  )
}
