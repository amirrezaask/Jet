import type { AgentThread } from "./types.js"
import { touchThread } from "./model.js"
import type { TurnEvent } from "./turn-events.js"

function patchAssistantMessage(
  thread: AgentThread,
  assistantMessageId: string,
  patch: { text?: string; streaming?: boolean },
): AgentThread {
  const messages = thread.messages.map(message => {
    if (message.id !== assistantMessageId) return message
    return {
      ...message,
      ...(patch.text !== undefined ? { text: patch.text } : {}),
      ...(patch.streaming !== undefined ? { streaming: patch.streaming } : {}),
      updatedAt: new Date().toISOString(),
    }
  })
  return { ...thread, messages }
}

export function applyTurnEvent(thread: AgentThread, event: TurnEvent): AgentThread {
  switch (event.kind) {
    case "text-delta": {
      const target = thread.messages.find(message => message.id === event.assistantMessageId)
      const nextText = `${target?.text ?? ""}${event.delta}`
      return touchThread(
        patchAssistantMessage(thread, event.assistantMessageId, { text: nextText }),
        { status: "running" },
      )
    }
    case "text-snapshot":
      return touchThread(
        patchAssistantMessage(thread, event.assistantMessageId, { text: event.text }),
        { status: "running" },
      )
    case "turn-complete":
      return touchThread(
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
    case "turn-error":
      return touchThread(
        {
          ...thread,
          messages: thread.messages.map(message =>
            message.streaming
              ? { ...message, streaming: false, updatedAt: new Date().toISOString() }
              : message,
          ),
        },
        { status: "error", lastError: event.message },
      )
  }
}
