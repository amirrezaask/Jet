import { touchThread } from "./model.js"
import type { AgentThread, SendAgentMessageInput } from "./types.js"

export type PreparedTurn = {
  thread: AgentThread
  assistantMessageId: string
}

export function prepareSendMessageTurn(
  thread: AgentThread,
  input: SendAgentMessageInput,
): PreparedTurn {
  const createdAt = new Date().toISOString()
  const userMessageId = crypto.randomUUID()
  const assistantMessageId = crypto.randomUUID()
  const provider = input.provider ?? thread.provider ?? "cursor"
  const model = input.model ?? thread.model ?? "auto"

  const next = touchThread(thread, {
    status: "running",
    lastError: null,
    provider,
    model,
    title:
      thread.messages.length === 0
        ? input.text.trim().slice(0, 64) || thread.title
        : thread.title,
    messages: [
      ...thread.messages,
      {
        id: userMessageId,
        role: "user",
        text: input.text,
        createdAt,
        updatedAt: createdAt,
        streaming: false,
      },
      {
        id: assistantMessageId,
        role: "assistant",
        text: "",
        createdAt,
        updatedAt: createdAt,
        streaming: true,
      },
    ],
  })

  return { thread: next, assistantMessageId }
}
