import type { TurnEvent } from "./turn-events.js"

export type MockTurnDriverInput = {
  assistantMessageId: string
  prompt: string
  signal: AbortSignal
  onEvent: (event: TurnEvent) => void
}

const MOCK_REPLY_PREFIX = "Mock agent reply: "

export async function runMockTurn(input: MockTurnDriverInput): Promise<void> {
  const fullText = `${MOCK_REPLY_PREFIX}${input.prompt.trim() || "(empty prompt)"}`
  const chunkSize = Math.max(4, Math.ceil(fullText.length / 6))

  for (let offset = 0; offset < fullText.length; offset += chunkSize) {
    if (input.signal.aborted) {
      input.onEvent({ kind: "turn-error", message: "Turn interrupted" })
      return
    }
    const slice = fullText.slice(0, offset + chunkSize)
    input.onEvent({
      kind: "text-snapshot",
      assistantMessageId: input.assistantMessageId,
      text: slice,
    })
    await sleep(80)
  }

  if (input.signal.aborted) {
    input.onEvent({ kind: "turn-error", message: "Turn interrupted" })
    return
  }
  input.onEvent({ kind: "turn-complete" })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms)
    if (typeof timer === "object" && timer && "unref" in timer) {
      ;(timer as { unref: () => void }).unref()
    }
  })
}

export function isMockTurnReply(text: string): boolean {
  return text.startsWith(MOCK_REPLY_PREFIX)
}
