import type { ProviderAdapter, ProviderAdapterContext } from "./types.js"

type OpenCodeClient = {
  session: {
    create: (opts?: {
      body?: { title?: string }
      query?: { directory?: string }
    }) => Promise<{ data?: { id?: string } }>
    prompt: (opts: {
      path: { id: string }
      body: { parts: Array<{ type: string; text: string }> }
      query?: { directory?: string }
    }) => Promise<{ data?: { parts?: Array<{ type?: string; text?: string }> } }>
    promptAsync: (opts: {
      path: { id: string }
      body: { parts: Array<{ type: string; text: string }> }
      query?: { directory?: string }
    }) => Promise<unknown>
    abort: (opts: { path: { id: string }; query?: { directory?: string } }) => Promise<unknown>
  }
  event: {
    subscribe: (opts?: unknown) => Promise<{
      stream: AsyncIterable<{ data?: { type?: string; properties?: Record<string, unknown> } }>
    }>
  }
  permission?: {
    reply: (opts: {
      requestID: string
      reply: "once" | "always" | "reject"
      directory?: string
    }) => Promise<unknown>
  }
}

type OpenCodeHandle = {
  client: OpenCodeClient
  server?: { close: () => void }
  directory: string
}

/**
 * OpenCode SDK session adapter with workspace directory binding + permission.asked bridge.
 */
export class OpenCodeAdapter implements ProviderAdapter {
  readonly id = "opencode:sdk"
  readonly kind = "sdk" as const
  private aborts = new Map<string, AbortController>()
  private sessions = new Map<string, { handle: OpenCodeHandle; sessionId: string }>()

  async startTurn(ctx: ProviderAdapterContext): Promise<void> {
    const abort = new AbortController()
    this.aborts.set(ctx.thread.id, abort)
    const messageId = crypto.randomUUID()
    const useMock = process.env.GHARARGAH_AGENT_MOCK === "1"
    ctx.signal.addEventListener("abort", () => abort.abort())

    if (useMock) {
      await this.mockEcho(ctx, messageId, abort.signal)
      return
    }

    try {
      const handle = await this.ensureHandle(ctx)
      let sessionId = ctx.thread.providerSessionId
      if (!sessionId) {
        const created = await handle.client.session.create({
          body: { title: ctx.thread.title ?? "Gharargah" },
          query: { directory: handle.directory },
        })
        sessionId = created.data?.id
        if (!sessionId) throw new Error("opencode session create failed")
      }
      this.sessions.set(ctx.thread.id, { handle, sessionId })
      ctx.emit({
        type: "session.bound",
        threadId: ctx.thread.id,
        providerTransport: "opencode-sdk",
        providerSessionId: sessionId,
        providerInstanceId: ctx.thread.providerInstanceId ?? undefined,
      })

      const streamed = await this.streamPrompt(handle, sessionId, ctx, messageId, abort.signal)
      if (abort.signal.aborted || ctx.signal.aborted) {
        ctx.emit({ type: "turn.cancelled", turnId: ctx.turnId, threadId: ctx.thread.id })
        return
      }
      if (!streamed) {
        ctx.emit({
          type: "turn.failed",
          turnId: ctx.turnId,
          threadId: ctx.thread.id,
          error: "opencode returned empty assistant text",
        })
        return
      }
      ctx.emit({
        type: "content.done",
        turnId: ctx.turnId,
        threadId: ctx.thread.id,
        messageId,
        text: streamed,
      })
      ctx.emit({ type: "turn.completed", turnId: ctx.turnId, threadId: ctx.thread.id })
    } catch (err) {
      if (abort.signal.aborted) {
        ctx.emit({ type: "turn.cancelled", turnId: ctx.turnId, threadId: ctx.thread.id })
      } else {
        ctx.emit({
          type: "turn.failed",
          turnId: ctx.turnId,
          threadId: ctx.thread.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    } finally {
      this.aborts.delete(ctx.thread.id)
    }
  }

  private async streamPrompt(
    handle: OpenCodeHandle,
    sessionId: string,
    ctx: ProviderAdapterContext,
    messageId: string,
    signal: AbortSignal,
  ): Promise<string> {
    let assistant = ""
    const canAsync =
      typeof handle.client.session.promptAsync === "function" &&
      typeof handle.client.event?.subscribe === "function"

    if (!canAsync) {
      const result = await handle.client.session.prompt({
        path: { id: sessionId },
        body: { parts: [{ type: "text", text: ctx.input.text }] },
        query: { directory: handle.directory },
      })
      return (
        result.data?.parts
          ?.map(p => (p.type === "text" ? (p.text ?? "") : ""))
          .join("")
          .trim() ?? ""
      )
    }

    const sub = await handle.client.event.subscribe()
    const idle = new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(new Error("cancelled"))
      signal.addEventListener("abort", onAbort, { once: true })
      void (async () => {
        try {
          for await (const ev of sub.stream) {
            if (signal.aborted) break
            const payload = ev.data
            const type = payload?.type ?? ""
            if (type === "permission.asked" || type === "permission.v2.asked") {
              await this.handlePermissionAsked(handle, ctx, payload?.properties ?? {})
              continue
            }
            if (type === "message.part.updated" || type === "MessagePartUpdated") {
              const props = payload?.properties as
                | { part?: { type?: string; text?: string; sessionID?: string } }
                | undefined
              const part = props?.part
              if (part?.type === "text" && typeof part.text === "string") {
                assistant = part.text
                ctx.emit({
                  type: "content.delta",
                  turnId: ctx.turnId,
                  threadId: ctx.thread.id,
                  messageId,
                  text: assistant,
                })
              }
            }
            if (
              type === "session.idle" ||
              type === "SessionIdle" ||
              type === "session.status"
            ) {
              const props = payload?.properties as { status?: string } | undefined
              if (!props?.status || props.status === "idle") {
                resolve()
                break
              }
            }
          }
          resolve()
        } catch (err) {
          reject(err)
        } finally {
          signal.removeEventListener("abort", onAbort)
        }
      })()
    })

    await handle.client.session.promptAsync({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text: ctx.input.text }] },
      query: { directory: handle.directory },
    })
    await idle
    return assistant
  }

  private async handlePermissionAsked(
    handle: OpenCodeHandle,
    ctx: ProviderAdapterContext,
    props: Record<string, unknown>,
  ): Promise<void> {
    const requestId = String(props.id ?? props.requestID ?? crypto.randomUUID())
    const permission = String(props.permission ?? "permission")
    const patterns = Array.isArray(props.patterns) ? (props.patterns as string[]) : []
    const title =
      patterns.length > 0 ? `${permission}: ${patterns.join(", ")}` : permission
    ctx.emit({
      type: "request.permission",
      turnId: ctx.turnId,
      threadId: ctx.thread.id,
      request: {
        id: requestId,
        title,
        options: [
          { id: "once", kind: "allow_once" as const, label: "Allow once" },
          { id: "always", kind: "allow_always" as const, label: "Allow always" },
          { id: "reject", kind: "reject_once" as const, label: "Reject" },
        ],
        createdAt: new Date().toISOString(),
        status: "pending" as const,
      },
    })
    const decision = await ctx.resolvePermission(requestId)
    const reply =
      decision.optionId === "always" ||
      decision.optionId === "allow_always" ||
      decision.approvalDecision === "acceptForSession"
        ? ("always" as const)
        : decision.optionId === "reject" ||
            decision.optionId === "reject_once" ||
            decision.approvalDecision === "decline"
          ? ("reject" as const)
          : ("once" as const)
    if (handle.client.permission?.reply) {
      await handle.client.permission.reply({
        requestID: requestId,
        reply,
        directory: handle.directory,
      })
    }
  }

  private async ensureHandle(ctx: ProviderAdapterContext): Promise<OpenCodeHandle> {
    const existing = this.sessions.get(ctx.thread.id)?.handle
    const directory = ctx.thread.workspaceRootPath
    if (existing && existing.directory === directory) return existing

    // Prefer v2 client (permission.reply + directory). Fall back to v1 createOpencode.
    try {
      const v2 = await import("@opencode-ai/sdk/v2")
      const created = await v2.createOpencode({
        // ServerOptions — bind project via config when supported
        config: { directory } as never,
      } as Parameters<typeof v2.createOpencode>[0])
      return {
        client: created.client as unknown as OpenCodeClient,
        server: created.server,
        directory,
      }
    } catch {
      const { createOpencode, createOpencodeClient } = await import("@opencode-ai/sdk")
      try {
        const created = await createOpencode({} as Parameters<typeof createOpencode>[0])
        // Re-bind directory on the client when possible.
        let client = created.client as unknown as OpenCodeClient
        try {
          client = createOpencodeClient({
            baseUrl: created.server.url,
            directory,
          }) as unknown as OpenCodeClient
        } catch {
          /* keep server-bundled client */
        }
        return { client, server: created.server, directory }
      } catch (err) {
        throw err
      }
    }
  }

  private async mockEcho(
    ctx: ProviderAdapterContext,
    messageId: string,
    signal: AbortSignal,
  ): Promise<void> {
    ctx.emit({
      type: "session.bound",
      threadId: ctx.thread.id,
      providerTransport: "opencode-sdk",
      providerSessionId: ctx.thread.providerSessionId ?? `opencode-${ctx.thread.id}`,
      providerInstanceId: ctx.thread.providerInstanceId ?? undefined,
    })
    const text = `OpenCode: ${ctx.input.text}`
    let out = ""
    for (const ch of text) {
      if (signal.aborted || ctx.signal.aborted) {
        ctx.emit({ type: "turn.cancelled", turnId: ctx.turnId, threadId: ctx.thread.id })
        this.aborts.delete(ctx.thread.id)
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
    this.aborts.delete(ctx.thread.id)
  }

  async interrupt(threadId: string): Promise<void> {
    this.aborts.get(threadId)?.abort()
    const session = this.sessions.get(threadId)
    if (session) {
      try {
        await session.handle.client.session.abort({
          path: { id: session.sessionId },
          query: { directory: session.handle.directory },
        })
      } catch {
        /* ignore */
      }
    }
  }

  async stopSession(threadId: string): Promise<void> {
    await this.interrupt(threadId)
    const session = this.sessions.get(threadId)
    if (session?.handle.server) {
      try {
        session.handle.server.close()
      } catch {
        /* ignore */
      }
    }
    this.sessions.delete(threadId)
  }
}

/** Grok via ACP profile id. */
export { AcpProviderAdapter as GrokAcpAdapter } from "./acp-adapter.js"
