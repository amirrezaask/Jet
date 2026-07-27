import type { ProviderAdapterContext } from "./types.js"

const turnCounts = new Map<string, number>()

/**
 * Deterministic native-driver mock used when GHARARGAH_AGENT_MOCK=1.
 * Matches gharargah-mock-line-rpc / mock-claude-sdk reply shapes used by E2E.
 */
export async function runNativeMockTurn(
  ctx: ProviderAdapterContext,
  messageId: string,
  opts: { transport: string; prefix?: string },
): Promise<void> {
  const signal = ctx.signal
  const count = (turnCounts.get(ctx.thread.id) ?? 0) + 1
  turnCounts.set(ctx.thread.id, count)

  ctx.emit({
    type: "session.bound",
    threadId: ctx.thread.id,
    providerTransport: opts.transport,
    providerSessionId: ctx.thread.providerSessionId ?? `${opts.transport}-${ctx.thread.id}`,
    providerInstanceId: ctx.thread.providerInstanceId ?? undefined,
  })

  const lower = ctx.input.text.toLowerCase()
  if (lower.includes("permission") || lower.includes("request permission")) {
    const request = {
      id: crypto.randomUUID(),
      title: "Mock protected operation",
      options: [
        { id: "allow_once", kind: "allow_once" as const, label: "Allow once" },
        { id: "reject_once", kind: "reject_once" as const, label: "Reject once" },
      ],
      createdAt: new Date().toISOString(),
      status: "pending" as const,
    }
    ctx.emit({
      type: "request.permission",
      turnId: ctx.turnId,
      threadId: ctx.thread.id,
      request,
    })
    const decision = await ctx.resolvePermission(request.id)
    if (signal.aborted) {
      ctx.emit({ type: "turn.cancelled", turnId: ctx.turnId, threadId: ctx.thread.id })
      return
    }
    const reply = `permission ${decision.approvalDecision ?? decision.optionId ?? "accept"}`
    await streamText(ctx, messageId, reply, signal)
    return
  }

  if (lower === "wait" || lower.startsWith("wait ")) {
    // Slow stream so the UI can cancel mid-turn.
    const reply = `mock:waiting`
    let out = ""
    for (const ch of reply) {
      if (signal.aborted) {
        ctx.emit({ type: "turn.cancelled", turnId: ctx.turnId, threadId: ctx.thread.id })
        return
      }
      out += ch
      ctx.emit({
        type: "content.delta",
        turnId: ctx.turnId,
        threadId: ctx.thread.id,
        messageId,
        text: out,
      })
      await new Promise(r => setTimeout(r, 120))
    }
    ctx.emit({
      type: "content.done",
      turnId: ctx.turnId,
      threadId: ctx.thread.id,
      messageId,
      text: out,
    })
    ctx.emit({ type: "turn.completed", turnId: ctx.turnId, threadId: ctx.thread.id })
    return
  }

  let reply: string
  if (lower.includes("process-count") || lower === "process-count") {
    reply = count > 1 ? `process-turn:${count}` : `mock:${ctx.input.text}`
  } else if (count > 1 && (lower.includes("process") || lower.includes("recovered"))) {
    reply =
      lower.includes("recovered")
        ? `mock:${ctx.input.text}`
        : `process-turn:${count}`
  } else {
    reply = `mock:${ctx.input.text}`
  }

  if (signal.aborted) {
    ctx.emit({ type: "turn.cancelled", turnId: ctx.turnId, threadId: ctx.thread.id })
    return
  }
  await streamText(ctx, messageId, reply, signal)
}

async function streamText(
  ctx: ProviderAdapterContext,
  messageId: string,
  text: string,
  signal: AbortSignal,
): Promise<void> {
  let out = ""
  for (const ch of text) {
    if (signal.aborted) {
      ctx.emit({ type: "turn.cancelled", turnId: ctx.turnId, threadId: ctx.thread.id })
      return
    }
    out += ch
    ctx.emit({
      type: "content.delta",
      turnId: ctx.turnId,
      threadId: ctx.thread.id,
      messageId,
      text: out,
    })
    await new Promise(r => setTimeout(r, 4))
  }
  ctx.emit({
    type: "content.done",
    turnId: ctx.turnId,
    threadId: ctx.thread.id,
    messageId,
    text: out,
  })
  ctx.emit({ type: "turn.completed", turnId: ctx.turnId, threadId: ctx.thread.id })
}
