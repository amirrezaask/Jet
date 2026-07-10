import {
  applyTurnEvent,
  prepareSendMessageTurn,
  touchThread,
  type AgentThread,
  type InterruptAgentTurnInput,
  type SendAgentMessageInput,
  type TurnEvent,
} from "@jet/agents"
import { uriToPath } from "@jet/node-host"
import { runAgentDriverWithFallback, runMockDriver, shouldUseMockDriver } from "./agent-drivers/index.js"
import {
  agentThreadKey,
  readAgentStore,
  readAgentThread,
  updateAgentThread,
  writeAgentStore,
} from "./agent-store.js"
import { isProviderBinaryAvailable } from "./agent-providers.js"
import { sendToRenderer } from "./host-renderer.js"

type ActiveTurn = {
  abort: AbortController
  promise: Promise<void>
}

export class AgentTurnRunner {
  private readonly activeTurns = new Map<string, ActiveTurn>()

  private publishThread(thread: AgentThread): void {
    sendToRenderer("agents:threadUpdated", thread)
  }

  private async persistTurnEvent(
    rootPath: string,
    threadId: string,
    event: TurnEvent,
  ): Promise<AgentThread | null> {
    const next = await updateAgentThread(rootPath, threadId, thread => applyTurnEvent(thread, event))
    if (next) this.publishThread(next)
    return next
  }

  async sendMessage(input: SendAgentMessageInput): Promise<AgentThread> {
    const rootPath = input.workspaceRootPath || uriToPath(input.workspaceRootUri)
    const payload = await readAgentStore(rootPath)
    const index = payload.threads.findIndex(thread => thread.id === input.threadId)
    if (index < 0) {
      throw new Error(`Unknown agent thread: ${input.threadId}`)
    }

    const thread = payload.threads[index]!
    const { thread: started, assistantMessageId } = prepareSendMessageTurn(thread, input)
    payload.threads[index] = started
    await writeAgentStore(rootPath, payload)
    this.publishThread(started)

    void this.startBackgroundTurn({
      rootPath,
      threadId: input.threadId,
      provider: started.provider,
      model: started.model,
      prompt: input.text,
      assistantMessageId,
    })

    return started
  }

  private async startBackgroundTurn(params: {
    rootPath: string
    threadId: string
    provider: string | null
    model: string | null
    prompt: string
    assistantMessageId: string
  }): Promise<void> {
    const key = agentThreadKey(params.rootPath, params.threadId)
    const existing = this.activeTurns.get(key)
    if (existing) {
      existing.abort.abort()
      await existing.promise.catch(() => undefined)
    }

    const abort = new AbortController()
    const promise = this.runTurn(params, abort.signal).finally(() => {
      if (this.activeTurns.get(key)?.abort === abort) {
        this.activeTurns.delete(key)
      }
    })
    this.activeTurns.set(key, { abort, promise })
    await promise
  }

  private async runTurn(
    params: {
      rootPath: string
      threadId: string
      provider: string | null
      model: string | null
      prompt: string
      assistantMessageId: string
    },
    signal: AbortSignal,
  ): Promise<void> {
    const useMock =
      shouldUseMockDriver() ||
      !(await isProviderBinaryAvailable(params.provider ?? "cursor"))

    const driverInput = {
      workspaceRootPath: params.rootPath,
      model: params.model ?? "auto",
      prompt: params.prompt,
      assistantMessageId: params.assistantMessageId,
      signal,
      onEvent: (event: TurnEvent) => {
        void this.persistTurnEvent(params.rootPath, params.threadId, event)
      },
    }

    if (useMock) {
      await runMockDriver(driverInput)
    } else {
      await runAgentDriverWithFallback(params.provider, driverInput)
    }
  }

  async interruptTurn(input: InterruptAgentTurnInput): Promise<AgentThread | null> {
    const rootPath = input.workspaceRootPath || uriToPath(input.workspaceRootUri)
    const key = agentThreadKey(rootPath, input.threadId)
    const active = this.activeTurns.get(key)
    if (active) {
      active.abort.abort()
      await active.promise.catch(() => undefined)
    }

    const thread = await readAgentThread(rootPath, input.threadId)
    if (!thread) return null
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
    const updated = await updateAgentThread(rootPath, input.threadId, () => next)
    if (updated) this.publishThread(updated)
    return updated
  }
}
