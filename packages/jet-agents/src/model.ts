import type {
  AgentThread,
  AgentThreadSummary,
  AgentWorkspaceSnapshot,
  CreateAgentThreadInput,
} from "./types.js"

function nowIso(): string {
  return new Date().toISOString()
}

function fileUriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri
  let path = decodeURIComponent(uri.slice(7))
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1)
  return path
}

export function summarizeThread(thread: AgentThread): AgentThreadSummary {
  let latestUserMessageAt: string | null = null
  for (const message of thread.messages) {
    if (message.role !== "user") continue
    if (latestUserMessageAt === null || message.createdAt > latestUserMessageAt) {
      latestUserMessageAt = message.createdAt
    }
  }
  return {
    id: thread.id,
    title: thread.title,
    updatedAt: thread.updatedAt,
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    status: thread.status,
    lastError: thread.lastError,
    latestUserMessageAt,
    messageCount: thread.messages.length,
  }
}

export function buildWorkspaceSnapshot(
  workspaceRootUri: string,
  workspaceRootPath: string,
  threads: AgentThread[],
): AgentWorkspaceSnapshot {
  return {
    workspaceRootUri,
    workspaceRootPath,
    threads: threads.map(summarizeThread).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  }
}

export function newAgentThread(input: CreateAgentThreadInput): AgentThread {
  const createdAt = nowIso()
  const rootPath = input.workspaceRootPath || fileUriToPath(input.workspaceRootUri)
  return {
    id: crypto.randomUUID(),
    title: input.title?.trim() || "New agent",
    workspaceRootUri: input.workspaceRootUri,
    workspaceRootPath: rootPath,
    provider: input.provider ?? "cursor",
    model: input.model ?? "auto",
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    status: "idle",
    lastError: null,
    messages: [],
  }
}

export function touchThread<T extends AgentThread>(
  thread: T,
  patch: Partial<Omit<AgentThread, "id" | "workspaceRootUri" | "workspaceRootPath" | "createdAt">>,
): T {
  return {
    ...thread,
    ...patch,
    updatedAt: nowIso(),
  }
}
