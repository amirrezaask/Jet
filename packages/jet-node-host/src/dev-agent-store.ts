import path from "node:path"
import { mkdir } from "node:fs/promises"
import * as nodeFs from "./fs.js"
import { pathToUri } from "./paths.js"
import type { AgentThread } from "@jet/agents"

export type AgentStorePayload = {
  threads: AgentThread[]
}

function agentStorePath(rootPath: string): string {
  return path.join(rootPath, ".jet", "agents", "state.json")
}

export async function readAgentStore(rootPath: string): Promise<AgentStorePayload> {
  try {
    const raw = await nodeFs.readFile(pathToUri(agentStorePath(rootPath)))
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
  await mkdir(path.dirname(filePath), { recursive: true })
  await nodeFs.writeFile(pathToUri(filePath), JSON.stringify(payload, null, 2))
}
