import { promises as fs } from "node:fs"
import path from "node:path"
import type { AgentThread } from "@jet/agents"

export type AgentStorePayload = {
  threads: AgentThread[]
}

export function agentStorePath(rootPath: string): string {
  return path.join(rootPath, ".jet", "agents", "state.json")
}

export function agentThreadKey(rootPath: string, threadId: string): string {
  return `${rootPath}::${threadId}`
}

export async function readAgentStore(rootPath: string): Promise<AgentStorePayload> {
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

export async function writeAgentStore(rootPath: string, payload: AgentStorePayload): Promise<void> {
  const filePath = agentStorePath(rootPath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8")
}

export async function updateAgentThread(
  rootPath: string,
  threadId: string,
  updater: (thread: AgentThread) => AgentThread,
): Promise<AgentThread | null> {
  const payload = await readAgentStore(rootPath)
  const index = payload.threads.findIndex(thread => thread.id === threadId)
  if (index < 0) return null
  const next = updater(payload.threads[index]!)
  payload.threads[index] = next
  await writeAgentStore(rootPath, payload)
  return next
}

export async function readAgentThread(
  rootPath: string,
  threadId: string,
): Promise<AgentThread | null> {
  const payload = await readAgentStore(rootPath)
  return payload.threads.find(thread => thread.id === threadId) ?? null
}
