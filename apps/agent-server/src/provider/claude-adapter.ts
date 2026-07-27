import type { ProviderAdapter, ProviderAdapterContext } from "./types.js"
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { runNativeMockTurn } from "./native-mock.js"

/**
 * Claude Agent SDK primary path via `query()`.
 * Persists real session_id, wires canUseTool → UI permissions, passes model.
 */
export class ClaudeSdkAdapter implements ProviderAdapter {
  readonly id = "claude:sdk"
  readonly kind = "sdk" as const
  private aborts = new Map<string, AbortController>()
  private queries = new Map<string, { close: () => void }>()

  async startTurn(ctx: ProviderAdapterContext): Promise<void> {
    const abort = new AbortController()
    this.aborts.set(ctx.thread.id, abort)
    const messageId = crypto.randomUUID()
    const useMock = process.env.GHARARGAH_AGENT_MOCK === "1"
    ctx.signal.addEventListener("abort", () => abort.abort())

    if (useMock) {
      await runNativeMockTurn(ctx, messageId, { transport: "claude-sdk" })
      this.aborts.delete(ctx.thread.id)
      return
    }

    try {
      const { query } = await import("@anthropic-ai/claude-agent-sdk")
      const home =
        process.env.GHARARGAH_CLAUDE_HOME ??
        (ctx.thread.providerInstanceId
          ? process.env[`GHARARGAH_CLAUDE_HOME_${ctx.thread.providerInstanceId}`]
          : undefined)
      const model = ctx.input.model ?? ctx.thread.model ?? undefined
      const permissionMode = runtimeModeToPermission(ctx.thread.runtimeMode)

      ctx.emit({
        type: "session.bound",
        threadId: ctx.thread.id,
        providerTransport: "claude-sdk",
        providerSessionId: ctx.thread.providerSessionId ?? undefined,
        providerInstanceId: ctx.thread.providerInstanceId ?? undefined,
        ...(model ? { model } : {}),
      })

      const canUseTool = async (
        toolName: string,
        input: Record<string, unknown>,
        options: {
          signal: AbortSignal
          title?: string
          displayName?: string
          description?: string
          toolUseID: string
          requestId: string
        },
      ) => {
        if (abort.signal.aborted || options.signal.aborted) {
          return { behavior: "deny" as const, message: "cancelled", interrupt: true }
        }
        const requestId = options.requestId || crypto.randomUUID()
        const title =
          options.title ??
          options.displayName ??
          `${toolName}${options.description ? `: ${options.description}` : ""}`
        ctx.emit({
          type: "request.permission",
          turnId: ctx.turnId,
          threadId: ctx.thread.id,
          request: {
            id: requestId,
            title,
            options: [
              { id: "allow_once", kind: "allow_once" as const, label: "Allow once" },
              { id: "allow_always", kind: "allow_always" as const, label: "Allow always" },
              { id: "reject_once", kind: "reject_once" as const, label: "Reject" },
            ],
            createdAt: new Date().toISOString(),
            status: "pending" as const,
            detail: JSON.stringify(input).slice(0, 2_000),
            toolCall: { name: toolName, rawInput: input },
          },
        })
        const decision = await ctx.resolvePermission(requestId)
        const allow =
          decision.approvalDecision === "accept" ||
          decision.approvalDecision === "acceptForSession" ||
          decision.optionId === "allow_once" ||
          decision.optionId === "allow_always" ||
          decision.optionId === "accept" ||
          decision.optionId === "acceptForSession"
        if (allow) {
          return {
            behavior: "allow" as const,
            updatedInput: input,
            toolUseID: options.toolUseID,
          }
        }
        return {
          behavior: "deny" as const,
          message: "User rejected tool use",
          toolUseID: options.toolUseID,
        }
      }

      const q = query({
        prompt: ctx.input.text,
        options: {
          cwd: ctx.thread.workspaceRootPath,
          abortController: abort,
          resume: ctx.thread.providerSessionId ?? undefined,
          ...(model && model !== "auto" ? { model } : {}),
          ...(permissionMode ? { permissionMode } : {}),
          ...(permissionMode === "bypassPermissions"
            ? { allowDangerouslySkipPermissions: true }
            : {}),
          canUseTool,
          env: home ? { ...process.env, HOME: home } : undefined,
        },
      })
      this.queries.set(ctx.thread.id, q)

      let assistant = ""
      let boundSessionId = ctx.thread.providerSessionId ?? null
      for await (const msg of q) {
        if (abort.signal.aborted || ctx.signal.aborted) break
        const sid = extractSessionId(msg)
        if (sid && sid !== boundSessionId) {
          boundSessionId = sid
          ctx.emit({
            type: "session.bound",
            threadId: ctx.thread.id,
            providerTransport: "claude-sdk",
            providerSessionId: sid,
            providerInstanceId: ctx.thread.providerInstanceId ?? undefined,
            ...(model ? { model } : {}),
          })
        }
        const piece = extractClaudeText(msg)
        if (!piece) continue
        assistant += piece
        ctx.emit({
          type: "content.delta",
          turnId: ctx.turnId,
          threadId: ctx.thread.id,
          messageId,
          text: assistant,
        })
      }

      if (abort.signal.aborted || ctx.signal.aborted) {
        ctx.emit({ type: "turn.cancelled", turnId: ctx.turnId, threadId: ctx.thread.id })
      } else if (!assistant) {
        ctx.emit({
          type: "turn.failed",
          turnId: ctx.turnId,
          threadId: ctx.thread.id,
          error: "claude returned empty assistant text",
        })
      } else {
        ctx.emit({
          type: "content.done",
          turnId: ctx.turnId,
          threadId: ctx.thread.id,
          messageId,
          text: assistant,
        })
        ctx.emit({ type: "turn.completed", turnId: ctx.turnId, threadId: ctx.thread.id })
      }
    } catch (err) {
      if (abort.signal.aborted) {
        ctx.emit({ type: "turn.cancelled", turnId: ctx.turnId, threadId: ctx.thread.id })
      } else {
        const mockBin = process.env.GHARARGAH_MOCK_CLAUDE_SDK_BIN
        if (mockBin && process.env.GHARARGAH_AGENT_MOCK === "1") {
          await this.runCliBridge(ctx, messageId, abort, mockBin)
        } else {
          ctx.emit({
            type: "turn.failed",
            turnId: ctx.turnId,
            threadId: ctx.thread.id,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    } finally {
      this.aborts.delete(ctx.thread.id)
      this.queries.delete(ctx.thread.id)
    }
  }

  private async runCliBridge(
    ctx: ProviderAdapterContext,
    messageId: string,
    abort: AbortController,
    command: string,
  ): Promise<void> {
    const child = spawn(command, [], {
      cwd: ctx.thread.workspaceRootPath,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    })
    let assistant = ""
    const rl = createInterface({ input: child.stdout })
    rl.on("line", line => {
      try {
        const msg = JSON.parse(line) as {
          delta?: { text?: string }
          result?: string
          message?: { content?: Array<{ text?: string }> }
        }
        const piece =
          msg.delta?.text ??
          msg.result ??
          msg.message?.content?.map(c => c.text ?? "").join("") ??
          ""
        if (!piece) return
        assistant += piece
        ctx.emit({
          type: "content.delta",
          turnId: ctx.turnId,
          threadId: ctx.thread.id,
          messageId,
          text: assistant,
        })
      } catch {
        /* ignore */
      }
    })
    const onAbort = () => {
      child.kill("SIGTERM")
      setTimeout(() => child.kill("SIGKILL"), 2_000)
    }
    abort.signal.addEventListener("abort", onAbort)
    try {
      child.stdin.write(
        JSON.stringify({
          type: "user",
          message: { role: "user", content: ctx.input.text },
        }) + "\n",
      )
      child.stdin.end()
      await new Promise<void>((resolve, reject) => {
        child.on("exit", code => {
          if (abort.signal.aborted) resolve()
          else if (code === 0 || assistant) resolve()
          else reject(new Error(`claude exited ${code}`))
        })
      })
      if (abort.signal.aborted) {
        ctx.emit({ type: "turn.cancelled", turnId: ctx.turnId, threadId: ctx.thread.id })
      } else if (!assistant) {
        ctx.emit({
          type: "turn.failed",
          turnId: ctx.turnId,
          threadId: ctx.thread.id,
          error: "claude mock bridge returned empty text",
        })
      } else {
        ctx.emit({
          type: "content.done",
          turnId: ctx.turnId,
          threadId: ctx.thread.id,
          messageId,
          text: assistant,
        })
        ctx.emit({ type: "turn.completed", turnId: ctx.turnId, threadId: ctx.thread.id })
      }
    } finally {
      rl.close()
    }
  }

  async interrupt(threadId: string): Promise<void> {
    this.aborts.get(threadId)?.abort()
    try {
      this.queries.get(threadId)?.close()
    } catch {
      /* ignore */
    }
  }
}

function runtimeModeToPermission(
  mode: string | null | undefined,
): "default" | "acceptEdits" | "bypassPermissions" | undefined {
  switch (mode) {
    case "approval-required":
      return "default"
    case "auto-accept-edits":
      return "acceptEdits"
    case "full-access":
      return "bypassPermissions"
    default:
      return "default"
  }
}

function extractSessionId(msg: unknown): string | null {
  const m = msg as { session_id?: string; sessionId?: string }
  if (typeof m.session_id === "string" && m.session_id.length > 0) return m.session_id
  if (typeof m.sessionId === "string" && m.sessionId.length > 0) return m.sessionId
  return null
}

function extractClaudeText(msg: unknown): string {
  const m = msg as {
    type?: string
    message?: { content?: Array<{ type?: string; text?: string }> }
    result?: string
    delta?: { text?: string }
  }
  if (m.delta?.text) return m.delta.text
  if (typeof m.result === "string" && m.type !== "result") return m.result
  // Prefer assistant message content; ignore result subtype summaries that duplicate.
  if (m.type === "assistant" && m.message?.content) {
    return m.message.content.map(c => (c.type === "text" ? (c.text ?? "") : "")).join("")
  }
  if (m.message?.content && m.type !== "result") {
    return m.message.content.map(c => (c.type === "text" ? (c.text ?? "") : "")).join("")
  }
  return ""
}
