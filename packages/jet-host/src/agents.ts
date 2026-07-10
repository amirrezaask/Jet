import { uriToPath } from "@jet/node-host"
import {
  buildWorkspaceSnapshot,
  newAgentThread,
  touchThread,
  type AgentThread,
  type CreateAgentThreadInput,
  type InterruptAgentTurnInput,
  type SendAgentMessageInput,
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
import { sendToRenderer } from "./host-renderer.js"
import type { HostRegistry } from "./registry.js"

function publishThreadUpdated(thread: AgentThread): void {
  sendToRenderer("agents:threadUpdated", thread)
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

export function registerAgentHandlers(registry: HostRegistry): void {
  const turnRunner = new AgentTurnRunner()

  registry.handle("agents:listProviders", async () => listProviders())
  registry.handle("agents:refreshProviders", async () => refreshProviders())
  registry.handle("agents:listThreads", async args =>
    listThreads(args[0] as string, args[1] as string),
  )
  registry.handle("agents:readThread", async args =>
    readAgentThread(
      (args[1] as string) || uriToPath(args[0] as string),
      args[2] as string,
    ),
  )
  registry.handle("agents:createThread", async args => createThread(args[0] as CreateAgentThreadInput))
  registry.handle("agents:sendMessage", async args => turnRunner.sendMessage(args[0] as SendAgentMessageInput))
  registry.handle("agents:interruptTurn", async args =>
    turnRunner.interruptTurn(args[0] as InterruptAgentTurnInput),
  )
  registry.handle("agents:setArchived", async args => {
    const thread = await setArchived(args[0] as SetAgentThreadArchivedInput)
    if (thread) publishThreadUpdated(thread)
    return thread
  })
  registry.handle("agents:updateThreadSettings", async args => {
    const thread = await updateThreadSettings(args[0] as UpdateAgentThreadSettingsInput)
    if (thread) publishThreadUpdated(thread)
    return thread
  })
}
