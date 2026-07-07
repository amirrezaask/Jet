import {
  applyTurnEvent,
  prepareSendMessageTurn,
  runMockTurn,
  touchThread,
  type AgentThread,
  type InterruptAgentTurnInput,
  type SendAgentMessageInput,
  type TurnEvent,
} from "@jet/agents"
import { readAgentStore, writeAgentStore } from "./dev-agent-store.js"

type ActiveDevTurn = {
  abort: AbortController
  promise: Promise<void>
}

const activeDevTurns = new Map<string, ActiveDevTurn>()
const persistQueues = new Map<string, Promise<void>>()

function turnKey(rootPath: string, threadId: string): string {
  return `${rootPath}::${threadId}`
}

async function persistTurnEvent(
  rootPath: string,
  threadId: string,
  event: TurnEvent,
): Promise<AgentThread | null> {
  const payload = await readAgentStore(rootPath)
  const index = payload.threads.findIndex(thread => thread.id === threadId)
  if (index < 0) return null
  const next = applyTurnEvent(payload.threads[index]!, event)
  payload.threads[index] = next
  await writeAgentStore(rootPath, payload)
  return next
}

function enqueuePersistTurnEvent(
  rootPath: string,
  threadId: string,
  event: TurnEvent,
): Promise<AgentThread | null> {
  const key = turnKey(rootPath, threadId)
  const previous = persistQueues.get(key) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(() => persistTurnEvent(rootPath, threadId, event))
  persistQueues.set(
    key,
    next.then(() => undefined),
  )
  return next
}

async function runDevMockTurn(params: {
  rootPath: string
  threadId: string
  prompt: string
  assistantMessageId: string
  signal: AbortSignal
}): Promise<void> {
  await runMockTurn({
    assistantMessageId: params.assistantMessageId,
    prompt: params.prompt,
    signal: params.signal,
    onEvent: event => {
      void enqueuePersistTurnEvent(params.rootPath, params.threadId, event)
    },
  })
}

export async function devSendAgentMessage(input: SendAgentMessageInput): Promise<AgentThread> {
  const rootPath =
    input.workspaceRootPath ||
    (input.workspaceRootUri.startsWith("file://")
      ? decodeURIComponent(input.workspaceRootUri.slice(7))
      : input.workspaceRootUri)
  const payload = await readAgentStore(rootPath)
  const index = payload.threads.findIndex(thread => thread.id === input.threadId)
  if (index < 0) {
    throw new Error(`Unknown agent thread: ${input.threadId}`)
  }

  const { thread: started, assistantMessageId } = prepareSendMessageTurn(
    payload.threads[index]!,
    input,
  )
  payload.threads[index] = started
  await writeAgentStore(rootPath, payload)

  const key = turnKey(rootPath, input.threadId)
  const existing = activeDevTurns.get(key)
  if (existing) {
    existing.abort.abort()
    await existing.promise.catch(() => undefined)
  }

  const abort = new AbortController()
  const promise = runDevMockTurn({
    rootPath,
    threadId: input.threadId,
    prompt: input.text,
    assistantMessageId,
    signal: abort.signal,
  }).finally(() => {
    if (activeDevTurns.get(key)?.abort === abort) {
      activeDevTurns.delete(key)
    }
  })
  activeDevTurns.set(key, { abort, promise })

  return started
}

export async function devInterruptAgentTurn(
  input: InterruptAgentTurnInput,
): Promise<AgentThread | null> {
  const rootPath =
    input.workspaceRootPath ||
    (input.workspaceRootUri.startsWith("file://")
      ? decodeURIComponent(input.workspaceRootUri.slice(7))
      : input.workspaceRootUri)
  const key = turnKey(rootPath, input.threadId)
  const active = activeDevTurns.get(key)
  if (active) {
    active.abort.abort()
    await active.promise.catch(() => undefined)
  }

  const payload = await readAgentStore(rootPath)
  const index = payload.threads.findIndex(thread => thread.id === input.threadId)
  if (index < 0) return null
  const thread = payload.threads[index]!
  if (thread.status !== "running") return thread

  const next = touchThread(
    {
      ...thread,
      messages: thread.messages.map(message =>
        message.streaming
          ? { ...message, streaming: false, updatedAt: new Date().toISOString() }
          : message,
      ),
    },
    { status: "idle", lastError: null },
  )
  payload.threads[index] = next
  await writeAgentStore(rootPath, payload)
  return next
}
