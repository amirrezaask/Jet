import type { ProviderAdapter, ProviderAdapterContext } from "./types.js"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface, type Interface } from "node:readline"
import { coerceAssistantText } from "@gharargah/agents"
import { runNativeMockTurn } from "./native-mock.js"

const TURN_IDLE_TIMEOUT_MS = 10 * 60 * 1000

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

type CodexSession = {
  child: ChildProcessWithoutNullStreams
  rl: Interface
  nextId: number
  pending: Map<number, Pending>
  /** Server→client request waiters (approvals). */
  serverRequests: Map<
    number | string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >
  ready: Promise<void>
  dead: boolean
}

/** Persistent `codex app-server` processes keyed by workspace root (t3 session pool parity). */
const sessionsByCwd = new Map<string, CodexSession>()

function isRecoverableResumeError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (!message.includes("thread")) return false
  return ["not found", "unknown", "expired", "invalid", "missing"].some(s => message.includes(s))
}

function runtimeModeConfig(mode: string | null | undefined): {
  approvalPolicy: string
  sandbox: string
  approvalsReviewer: string
  sandboxPolicy: { type: string }
} {
  switch (mode) {
    case "approval-required":
      return {
        approvalPolicy: "untrusted",
        sandbox: "read-only",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "readOnly" },
      }
    case "auto-accept-edits":
      return {
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "workspaceWrite" },
      }
    case "full-access":
    default:
      return {
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "dangerFullAccess" },
      }
  }
}

/**
 * Codex app-server adapter — persistent process, thread resume, approval RPC bridge.
 */
export class CodexAppServerAdapter implements ProviderAdapter {
  readonly id = "codex:app-server"
  readonly kind = "app-server" as const
  private aborts = new Map<string, AbortController>()
  private activeThreadIds = new Set<string>()
  private turnDone = new Map<
    string,
    (status: "completed" | "cancelled" | "failed", error?: string) => void
  >()

  async startTurn(ctx: ProviderAdapterContext): Promise<void> {
    const abort = new AbortController()
    this.aborts.set(ctx.thread.id, abort)
    const messageId = crypto.randomUUID()
    const useMock = process.env.GHARARGAH_AGENT_MOCK === "1"
    ctx.signal.addEventListener("abort", () => abort.abort())

    if (useMock) {
      await runNativeMockTurn(ctx, messageId, { transport: "codex-app-server" })
      this.aborts.delete(ctx.thread.id)
      return
    }

    let assistant = ""
    const idleTimer = setTimeout(() => {
      this.turnDone.get(ctx.thread.id)?.("failed", "codex turn timed out waiting for turn/completed")
    }, TURN_IDLE_TIMEOUT_MS)

    const turnFinished = new Promise<"completed" | "cancelled" | "failed">((resolve, reject) => {
      this.turnDone.set(ctx.thread.id, (status, error) => {
        if (status === "failed") reject(new Error(error ?? "codex turn failed"))
        else resolve(status)
      })
    })
    this.activeThreadIds.add(ctx.thread.id)

    const assistantRef = { text: "" }

    try {
      const session = await this.ensureSession(ctx)
      const model = ctx.input.model ?? ctx.thread.model ?? undefined
      const cfg = runtimeModeConfig(ctx.thread.runtimeMode)

      const onLine = (line: string) => {
        this.handleLine(session, ctx, messageId, line, assistantRef)
        assistant = assistantRef.text
      }
      session.rl.on("line", onLine)

      const onAbort = () => {
        void this.request(session, "turn/interrupt", {}).catch(() => undefined)
      }
      abort.signal.addEventListener("abort", onAbort)

      try {
        const codexThreadId = await this.openThread(session, ctx, model, cfg)
        ctx.emit({
          type: "session.bound",
          threadId: ctx.thread.id,
          providerTransport: "codex-app-server",
          providerSessionId: codexThreadId,
          providerInstanceId: ctx.thread.providerInstanceId ?? undefined,
        })

        const turnInput: Array<Record<string, unknown>> = [
          { type: "text", text: ctx.input.text },
        ]
        for (const img of ctx.input.images ?? []) {
          turnInput.push({
            type: "image",
            url: `data:${img.mimeType};base64,${img.data}`,
          })
        }

        await this.request(session, "turn/start", {
          threadId: codexThreadId,
          input: turnInput,
          approvalPolicy: cfg.approvalPolicy,
          approvalsReviewer: cfg.approvalsReviewer,
          sandboxPolicy: cfg.sandboxPolicy,
          ...(model ? { model } : {}),
        })

        const status = await Promise.race([
          turnFinished,
          new Promise<"cancelled">((_, reject) => {
            if (abort.signal.aborted) {
              reject(new Error("cancelled"))
              return
            }
            abort.signal.addEventListener("abort", () => reject(new Error("cancelled")), {
              once: true,
            })
          }).catch(() => "cancelled" as const),
        ])

        if (status === "cancelled" || abort.signal.aborted) {
          ctx.emit({ type: "turn.cancelled", turnId: ctx.turnId, threadId: ctx.thread.id })
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
        abort.signal.removeEventListener("abort", onAbort)
        session.rl.off("line", onLine)
      }
    } catch (err) {
      if (abort.signal.aborted || (err instanceof Error && err.message === "cancelled")) {
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
      clearTimeout(idleTimer)
      this.turnDone.delete(ctx.thread.id)
      this.activeThreadIds.delete(ctx.thread.id)
      this.aborts.delete(ctx.thread.id)
    }
  }

  private async openThread(
    session: CodexSession,
    ctx: ProviderAdapterContext,
    model: string | undefined,
    cfg: ReturnType<typeof runtimeModeConfig>,
  ): Promise<string> {
    const startParams = {
      cwd: ctx.thread.workspaceRootPath,
      approvalPolicy: cfg.approvalPolicy,
      sandbox: cfg.sandbox,
      approvalsReviewer: cfg.approvalsReviewer,
      ...(model ? { model } : {}),
    }
    const resumeId = ctx.thread.providerSessionId
    if (resumeId) {
      try {
        const resumed = (await this.request(session, "thread/resume", {
          threadId: resumeId,
          ...startParams,
        })) as { thread?: { id?: string } }
        const id = resumed?.thread?.id ?? resumeId
        return id
      } catch (err) {
        if (!isRecoverableResumeError(err)) throw err
      }
    }
    const started = (await this.request(session, "thread/start", startParams)) as {
      thread?: { id?: string }
    }
    const id = started?.thread?.id
    if (!id) throw new Error("codex thread/start returned no thread id")
    return id
  }

  private handleLine(
    session: CodexSession,
    ctx: ProviderAdapterContext,
    messageId: string,
    line: string,
    assistantRef: { text: string },
  ): void {
    try {
      const msg = JSON.parse(line) as {
        id?: number | string
        result?: unknown
        error?: unknown
        method?: string
        params?: Record<string, unknown>
      }

      if (msg.id !== undefined && session.pending.has(msg.id as number)) {
        const p = session.pending.get(msg.id as number)!
        session.pending.delete(msg.id as number)
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
        else p.resolve(msg.result)
        return
      }

      // Server→client request (approvals) — must JSON-RPC reply or turn hangs.
      if (msg.id !== undefined && msg.method) {
        void this.handleServerRequest(session, ctx, msg.id, msg.method, msg.params ?? {})
        return
      }

      const method = msg.method ?? ""
      if (
        method === "item/agentMessage/delta" ||
        method === "item/agentMessageDelta" ||
        method.endsWith("/agentMessage/delta")
      ) {
        const delta = coerceAssistantText(msg.params?.delta ?? msg.params?.text)
        if (delta) {
          assistantRef.text += delta
          ctx.emit({
            type: "content.delta",
            turnId: ctx.turnId,
            threadId: ctx.thread.id,
            messageId,
            text: assistantRef.text,
          })
        }
        return
      }

      if (method === "item/completed") {
        const item = msg.params?.item as { text?: unknown; content?: unknown } | undefined
        const text = coerceAssistantText(item?.text ?? item?.content)
        if (text && !assistantRef.text) {
          assistantRef.text = text
          ctx.emit({
            type: "content.delta",
            turnId: ctx.turnId,
            threadId: ctx.thread.id,
            messageId,
            text: assistantRef.text,
          })
        }
        return
      }

      if (method === "turn/completed" || method === "turn/completedNotification") {
        const turn = msg.params?.turn as {
          status?: string
          error?: { message?: string } | string | null
        } | undefined
        const status = turn?.status ?? "completed"
        const done = this.turnDone.get(ctx.thread.id)
        if (status === "cancelled" || status === "interrupted") done?.("cancelled")
        else if (status === "failed" || status === "error") {
          const errMsg =
            typeof turn?.error === "string"
              ? turn.error
              : turn?.error?.message ?? `codex turn status=${status}`
          // Also pick up preceding error notification if any.
          const notified = (msg.params as { error?: { message?: string } } | undefined)?.error
            ?.message
          done?.("failed", notified ?? errMsg)
        } else done?.("completed")
        return
      }

      if (method === "error") {
        const message = String(
          (msg.params as { error?: { message?: string } } | undefined)?.error?.message ??
            (msg.params as { message?: string } | undefined)?.message ??
            "codex error",
        )
        // Stash for turn/completed; if turn never completes, fail soft later via idle timer.
        ;(ctx as unknown as { __codexLastError?: string }).__codexLastError = message
      }
    } catch {
      /* ignore malformed lines */
    }
  }

  private async handleServerRequest(
    session: CodexSession,
    ctx: ProviderAdapterContext,
    id: number | string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const reply = (result: unknown) => {
      if (!session.child.stdin.writable) return
      session.child.stdin.write(JSON.stringify({ id, result }) + "\n")
    }
    const replyError = (message: string) => {
      if (!session.child.stdin.writable) return
      session.child.stdin.write(
        JSON.stringify({ id, error: { code: -32000, message } }) + "\n",
      )
    }

    try {
      if (
        method === "item/commandExecution/requestApproval" ||
        method === "item/fileChange/requestApproval"
      ) {
        const requestId = crypto.randomUUID()
        const title =
          method === "item/commandExecution/requestApproval"
            ? String(params.command ?? params.cwd ?? "Command approval")
            : String(params.path ?? "File change approval")
        const request = {
          id: requestId,
          title,
          options: [
            { id: "accept", kind: "allow_once" as const, label: "Allow once" },
            { id: "acceptForSession", kind: "allow_always" as const, label: "Allow always" },
            { id: "decline", kind: "reject_once" as const, label: "Reject" },
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
        const decision = await ctx.resolvePermission(requestId)
        const mapped =
          decision.approvalDecision === "accept" ||
          decision.optionId === "accept" ||
          decision.optionId === "allow_once"
            ? "accept"
            : decision.approvalDecision === "acceptForSession" ||
                decision.optionId === "acceptForSession" ||
                decision.optionId === "allow_always"
              ? "acceptForSession"
              : "decline"
        reply({ decision: mapped })
        return
      }

      if (method === "item/tool/requestUserInput") {
        const requestId = crypto.randomUUID()
        ctx.emit({
          type: "request.userInput",
          turnId: ctx.turnId,
          threadId: ctx.thread.id,
          request: {
            id: requestId,
            kind: "elicitation",
            createdAt: new Date().toISOString(),
            status: "pending",
            title: String(params.question ?? params.title ?? "User input"),
            questions: [],
          },
        })
        const answers = await ctx.resolveUserInput(requestId)
        reply({ answers: answers ?? {} })
        return
      }

      // Unknown server request — decline safely so the turn does not hang.
      replyError(`unsupported server request: ${method}`)
    } catch (err) {
      replyError(err instanceof Error ? err.message : String(err))
    }
  }

  private request(session: CodexSession, method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (session.dead) {
        reject(new Error("codex app-server process dead"))
        return
      }
      const id = session.nextId++
      session.pending.set(id, { resolve, reject })
      session.child.stdin.write(JSON.stringify({ id, method, params }) + "\n")
    })
  }

  private async ensureSession(ctx: ProviderAdapterContext): Promise<CodexSession> {
    const cwd = ctx.thread.workspaceRootPath
    const existing = sessionsByCwd.get(cwd)
    if (existing && !existing.dead) {
      await existing.ready
      return existing
    }

    const mockBin = process.env.GHARARGAH_MOCK_CODEX_APP_SERVER_BIN
    const command = mockBin ?? "codex"
    const args = mockBin ? [] : ["app-server"]
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    }) as ChildProcessWithoutNullStreams

    const session: CodexSession = {
      child,
      rl: createInterface({ input: child.stdout }),
      nextId: 1,
      pending: new Map(),
      serverRequests: new Map(),
      ready: Promise.resolve(),
      dead: false,
    }

    const adapter = this
    child.on("exit", () => {
      session.dead = true
      sessionsByCwd.delete(cwd)
      for (const [, p] of session.pending) p.reject(new Error("codex app-server exited"))
      session.pending.clear()
      for (const threadId of adapter.activeThreadIds) {
        adapter.turnDone.get(threadId)?.("failed", "codex app-server exited")
        adapter.turnDone.delete(threadId)
      }
      adapter.activeThreadIds.clear()
    })

    // Bootstrap handshake once per process.
    session.ready = (async () => {
      // Temporary line handler for initialize result.
      const bootPending = session.pending
      const bootLine = (line: string) => {
        try {
          const msg = JSON.parse(line) as {
            id?: number
            result?: unknown
            error?: unknown
          }
          if (msg.id !== undefined && bootPending.has(msg.id)) {
            const p = bootPending.get(msg.id)!
            bootPending.delete(msg.id)
            if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
            else p.resolve(msg.result)
          }
        } catch {
          /* ignore */
        }
      }
      session.rl.on("line", bootLine)
      try {
        await this.request(session, "initialize", {
          clientInfo: { name: "gharargah", title: "Gharargah", version: "0.0.1" },
          capabilities: { experimentalApi: true },
        })
        child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n")
      } finally {
        session.rl.off("line", bootLine)
      }
    })()

    sessionsByCwd.set(cwd, session)
    await session.ready
    return session
  }

  async interrupt(threadId: string): Promise<void> {
    this.aborts.get(threadId)?.abort()
    this.turnDone.get(threadId)?.("cancelled")
  }

  async stopSession(_threadId: string): Promise<void> {
    await this.interrupt(_threadId)
  }
}
