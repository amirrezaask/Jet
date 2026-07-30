import type { ProviderAdapter, ProviderAdapterContext } from "./types.js"
import { AcpClient, ACP_CANCEL_FORCE_KILL_MS, runAcpRequest, runBootstrapAcpClient } from "@gharargah/effect-acp"
import { globalAcpPool } from "./acp-pool.js"
import { ensureMcpServers } from "./mcp-bridge.js"
import {
  parseCursorListAvailableModels,
  parseSessionModelState,
} from "./model-discovery.js"
import { spawn as spawnProc, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const ACP_PROFILES: Record<string, { command: string; args: string[] }> = {
  "cursor:acp": { command: "cursor-agent", args: ["acp"] },
  "codex:acp": { command: "codex", args: ["acp"] },
  "claude:acp": { command: "claude", args: ["--acp"] },
  "opencode:acp": { command: "opencode", args: ["acp"] },
  "grok:acp": { command: "grok", args: ["agent", "stdio"] },
}

function resolveMockBin(): string | null {
  if (process.env.GHARARGAH_MOCK_ACP_BIN) return process.env.GHARARGAH_MOCK_ACP_BIN
  const candidates = [
    path.resolve(process.cwd(), "apps/host-server/mocks/bin/gharargah-mock-acp"),
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
}

function useMock(): boolean {
  return process.env.GHARARGAH_AGENT_MOCK === "1"
}

function parseSessionMeta(raw: unknown): {
  sessionModes: import("@gharargah/agents").AgentThread["sessionModes"]
  configOptions: import("@gharargah/agents").AgentThread["configOptions"]
  discoveredModels: import("@gharargah/agents").ProviderModel[] | null
  currentModelId: string | null
} {
  if (!raw || typeof raw !== "object") {
    return {
      sessionModes: undefined,
      configOptions: undefined,
      discoveredModels: null,
      currentModelId: null,
    }
  }
  const r = raw as {
    modes?: {
      currentModeId?: string
      availableModes?: Array<{ id: string; name: string; description?: string | null }>
    } | null
    configOptions?: import("@gharargah/agents").AgentSessionConfigOption[] | null
    models?: unknown
  }
  const sessionModes =
    r.modes && r.modes.currentModeId && Array.isArray(r.modes.availableModes)
      ? {
          currentModeId: r.modes.currentModeId,
          availableModes: r.modes.availableModes,
        }
      : undefined
  const configOptions = Array.isArray(r.configOptions) ? r.configOptions : undefined
  const fromModels = parseSessionModelState(r.models)
  const currentModelId =
    r.models && typeof r.models === "object"
      ? String((r.models as { currentModelId?: string }).currentModelId ?? "") || null
      : null
  return {
    sessionModes,
    configOptions,
    discoveredModels: fromModels.length > 0 ? fromModels : null,
    currentModelId,
  }
}

type TerminalRecord = {
  command: string
  args: string[]
  output: string
  exitCode: number | null
  done: Promise<void>
  child: ChildProcess | null
  killed: boolean
}

const TERMINAL_OUTPUT_BOUND = 256 * 1024

export class AcpProviderAdapter implements ProviderAdapter {
  readonly kind = "acp" as const
  private aborts = new Map<string, AbortController>()
  /** Live turn context for pooled client onRequest handlers. */
  private liveCtx = new Map<string, ProviderAdapterContext>()
  /** Active ACP session per jet thread — used by interrupt → session/cancel. */
  private liveSessions = new Map<string, { client: AcpClient; sessionId: string }>()
  private terminals = new Map<string, TerminalRecord>()

  constructor(readonly id: string) {}

  private connectionKey(ctx: ProviderAdapterContext): string {
    const instance = ctx.thread.providerInstanceId ?? ctx.thread.agentId ?? "default"
    return `${this.id}:${instance}:${ctx.thread.workspaceRootPath}`
  }

  private profile(): { command: string; args: string[] } {
    if (useMock()) {
      const bin = resolveMockBin()
      const scenario = process.env.GHARARGAH_AGENT_MOCK_SCENARIO ?? "echo"
      if (bin) return { command: bin, args: ["--scenario", scenario] }
      return { command: "gharargah-mock-acp", args: ["--scenario", scenario] }
    }
    return ACP_PROFILES[this.id] ?? { command: "cursor-agent", args: ["acp"] }
  }

  private async handleClientRequest(
    key: string,
    method: string,
    params: unknown,
  ): Promise<unknown> {
    const ctx = this.liveCtx.get(key)
    if (!ctx) return {}

    if (method === "session/request_permission") {
      const p = params as {
        sessionId?: string
        toolCall?: { toolCallId?: string; title?: string; kind?: string }
        options?: Array<{
          optionId?: string
          id?: string
          kind?: string
          name?: string
          label?: string
        }>
      }
      const options = (p.options ?? []).map(o => ({
        id: o.optionId ?? o.id ?? "allow_once",
        kind:
          (o.kind as
            | "allow_once"
            | "allow_always"
            | "reject_once"
            | "reject_always"
            | "unknown") ?? "unknown",
        label: o.name ?? o.label ?? o.optionId ?? o.id ?? "Allow",
      }))
      const request = {
        id: crypto.randomUUID(),
        title: p.toolCall?.title ?? "Permission required",
        options,
        createdAt: new Date().toISOString(),
        sessionId: p.sessionId ?? null,
        status: "pending" as const,
        toolCall: p.toolCall ? { name: p.toolCall.title, kind: p.toolCall.kind } : null,
      }
      ctx.emit({
        type: "request.permission",
        turnId: ctx.turnId,
        threadId: ctx.thread.id,
        request,
      })
      const decision = await ctx.resolvePermission(request.id)
      const optionId =
        decision.optionId ??
        (decision.approvalDecision === "acceptForSession"
          ? options.find(o => o.kind === "allow_always")?.id
          : decision.approvalDecision === "accept"
            ? options.find(o => o.kind === "allow_once")?.id
            : options.find(o => o.kind.startsWith("reject"))?.id) ??
        options[0]?.id
      return { outcome: { outcome: "selected", optionId } }
    }

    if (method === "cursor/ask_question") {
      const p = params as {
        toolCallId?: string
        title?: string
        questions?: Array<{
          id: string
          prompt: string
          allowMultiple?: boolean
          options?: Array<{ id?: string; label: string }>
        }>
      }
      const requestId = crypto.randomUUID()
      const request = {
        id: requestId,
        kind: "ask_question" as const,
        source: "cursor/ask_question",
        title: p.title ?? "Questions",
        questions: (p.questions ?? []).map(q => ({
          id: q.id,
          prompt: q.prompt,
          allowMultiple: q.allowMultiple ?? false,
          options: (q.options ?? []).map(o => ({
            id: o.id ?? o.label,
            label: o.label,
          })),
        })),
        createdAt: new Date().toISOString(),
        status: "pending" as const,
      }
      ctx.emit({
        type: "request.userInput",
        turnId: ctx.turnId,
        threadId: ctx.thread.id,
        request,
      })
      const answer = (await ctx.resolveUserInput(requestId)) as {
        answers?: Array<{ questionId: string; selected: string[] }>
        action?: string
      }
      return {
        answers: (answer.answers ?? []).map(a => ({
          questionId: a.questionId,
          selected: a.selected,
        })),
      }
    }

    if (method === "cursor/create_plan") {
      const p = params as {
        toolCallId?: string
        name?: string
        overview?: string
        plan?: string
        todos?: Array<{ id?: string; content?: string; status?: string }>
      }
      const entries = (p.todos ?? []).map((t, i) => ({
        id: t.id ?? `todo-${i}`,
        label: t.content ?? `step-${i}`,
        status:
          t.status === "completed"
            ? ("completed" as const)
            : t.status === "in_progress"
              ? ("in_progress" as const)
              : ("pending" as const),
      }))
      if (entries.length === 0 && p.plan) {
        entries.push({ id: "plan-body", label: p.name ?? "Plan", status: "pending" })
      }
      ctx.emit({
        type: "plan.update",
        turnId: ctx.turnId,
        threadId: ctx.thread.id,
        plan: {
          id: p.toolCallId ?? `plan-${ctx.turnId}`,
          entries,
          updatedAt: new Date().toISOString(),
        },
      })
      return { accepted: true }
    }

    if (method === "elicitation/create" || method.endsWith("/elicitation/create")) {
      const p = params as { message?: string; title?: string }
      const requestId = crypto.randomUUID()
      const request = {
        id: requestId,
        kind: "elicitation" as const,
        source: "elicitation/create",
        title: p.title ?? p.message ?? "Elicitation",
        message: p.message ?? null,
        createdAt: new Date().toISOString(),
        status: "pending" as const,
      }
      ctx.emit({
        type: "request.userInput",
        turnId: ctx.turnId,
        threadId: ctx.thread.id,
        request,
      })
      await ctx.resolveUserInput(requestId)
      return { action: "accept", content: {} }
    }

    if (method === "fs/read_text_file") {
      const { path: filePath } = params as { path: string }
      const abs = path.isAbsolute(filePath)
        ? filePath
        : path.join(ctx.thread.workspaceRootPath, filePath)
      this.assertInsideRoot(ctx.thread.workspaceRootPath, abs)
      return { content: fs.readFileSync(abs, "utf8") }
    }
    if (method === "fs/write_text_file") {
      const { path: filePath, content } = params as { path: string; content: string }
      const abs = path.isAbsolute(filePath)
        ? filePath
        : path.join(ctx.thread.workspaceRootPath, filePath)
      this.assertInsideRoot(ctx.thread.workspaceRootPath, abs)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, content)
      return {}
    }

    if (method === "terminal/create" || method === "session/create_terminal") {
      const p = params as { command?: string; args?: string[]; sessionId?: string }
      const terminalId = crypto.randomUUID()
      const command = p.command ?? "/bin/echo"
      const args = p.args ?? []
      const rec: TerminalRecord = {
        command,
        args,
        output: "",
        exitCode: null,
        done: Promise.resolve(),
        child: null,
        killed: false,
      }
      rec.done = new Promise<void>(resolve => {
        const child = spawnProc(command, args, {
          cwd: ctx.thread.workspaceRootPath,
          env: process.env,
        })
        rec.child = child
        const append = (chunk: Buffer) => {
          if (rec.output.length >= TERMINAL_OUTPUT_BOUND) return
          const next = chunk.toString()
          const room = TERMINAL_OUTPUT_BOUND - rec.output.length
          rec.output += next.slice(0, room)
        }
        child.stdout?.on("data", append)
        child.stderr?.on("data", append)
        child.on("close", code => {
          rec.exitCode = code ?? 0
          resolve()
        })
        child.on("error", () => {
          rec.exitCode = 1
          resolve()
        })
      })
      this.terminals.set(terminalId, rec)
      return { terminalId }
    }

    if (
      method === "terminal/wait_for_exit" ||
      method === "terminal/waitForExit" ||
      method === "session/wait_for_terminal_exit"
    ) {
      const p = params as { terminalId?: string }
      const rec = p.terminalId ? this.terminals.get(p.terminalId) : undefined
      if (rec) await rec.done
      return { exitStatus: { exitCode: rec?.exitCode ?? 0 } }
    }

    if (method === "terminal/output" || method === "session/terminal_output") {
      const p = params as { terminalId?: string }
      const rec = p.terminalId ? this.terminals.get(p.terminalId) : undefined
      // Live output — do not require exit (t3code parity).
      return {
        output: rec?.output ?? "",
        truncated: (rec?.output.length ?? 0) >= TERMINAL_OUTPUT_BOUND,
        exitStatus:
          rec?.exitCode != null || rec?.killed
            ? { exitCode: rec.exitCode ?? (rec.killed ? 137 : 0) }
            : null,
      }
    }

    if (
      method === "terminal/kill" ||
      method === "session/kill_terminal" ||
      method === "terminal/kill_terminal"
    ) {
      const p = params as { terminalId?: string }
      const rec = p.terminalId ? this.terminals.get(p.terminalId) : undefined
      if (rec?.child && !rec.killed) {
        rec.killed = true
        try {
          rec.child.kill("SIGTERM")
          setTimeout(() => rec.child?.kill("SIGKILL"), 2_000)
        } catch {
          /* ignore */
        }
      }
      return {}
    }

    if (
      method === "terminal/release" ||
      method === "session/release_terminal"
    ) {
      const p = params as { terminalId?: string }
      if (p.terminalId) {
        const rec = this.terminals.get(p.terminalId)
        if (rec?.child && !rec.killed) {
          try {
            rec.child.kill("SIGTERM")
          } catch {
            /* ignore */
          }
        }
        this.terminals.delete(p.terminalId)
      }
      return {}
    }

    return {}
  }

  async startTurn(ctx: ProviderAdapterContext): Promise<void> {
    const key = this.connectionKey(ctx)
    this.liveCtx.set(key, ctx)
    globalAcpPool.touch(key)
    const abort = new AbortController()
    this.aborts.set(ctx.thread.id, abort)
    ctx.signal.addEventListener("abort", () => abort.abort())

    let client = globalAcpPool.get(key)
    if (!client) {
      const profile = this.profile()
      client = await runBootstrapAcpClient({
        command: profile.command,
        args: profile.args,
        cwd: ctx.thread.workspaceRootPath,
        onRequest: (method, params) => this.handleClientRequest(key, method, params),
        onNotification: (method, params) => {
          const live = this.liveCtx.get(key)
          if (!live) return
          if (method === "cursor/update_todos") {
            const p = params as {
              toolCallId?: string
              todos?: Array<{ id?: string; content?: string; status?: string }>
            }
            live.emit({
              type: "plan.update",
              turnId: live.turnId,
              threadId: live.thread.id,
              plan: {
                id: p.toolCallId ?? `todos-${live.turnId}`,
                entries: (p.todos ?? []).map((t, i) => ({
                  id: t.id ?? `todo-${i}`,
                  label: t.content ?? `todo-${i}`,
                  status:
                    t.status === "completed"
                      ? ("completed" as const)
                      : t.status === "in_progress"
                        ? ("in_progress" as const)
                        : ("pending" as const),
                })),
                updatedAt: new Date().toISOString(),
              },
            })
          }
        },
      })
      globalAcpPool.set(key, client)
      const connected = {
        status: "connected" as const,
        message: null,
        providerId: this.id,
        updatedAt: new Date().toISOString(),
      }
      globalAcpPool.setConnectionState(key, connected)
      ctx.emit({
        type: "connection.update",
        threadId: ctx.thread.id,
        connection: connected,
      })
    }

    let sessionId = ctx.thread.acpSessionId ?? null
    let sessionModes: import("@gharargah/agents").AgentThread["sessionModes"] = undefined
    let configOptions: import("@gharargah/agents").AgentThread["configOptions"] = undefined
    let discoveredModels: import("@gharargah/agents").ProviderModel[] | null = null
    let boundModel: string | null = null
    const mcpServers = ensureMcpServers(ctx.thread.workspaceRootPath)
    const preferResume =
      Boolean(sessionId) && (ctx.thread.messages?.length ?? 0) > 0

    if (sessionId && preferResume) {
      try {
        const resumed = await client.resumeSession(
          sessionId,
          ctx.thread.workspaceRootPath,
          mcpServers,
        )
        const meta = parseSessionMeta(resumed)
        sessionModes = meta.sessionModes
        configOptions = meta.configOptions
        discoveredModels = meta.discoveredModels
        boundModel = meta.currentModelId
      } catch {
        /* fall through to load / new */
        try {
          const loaded = await client.loadSession(
            sessionId,
            ctx.thread.workspaceRootPath,
            mcpServers,
          )
          const meta = parseSessionMeta(loaded)
          sessionModes = meta.sessionModes
          configOptions = meta.configOptions
          discoveredModels = meta.discoveredModels
          boundModel = meta.currentModelId
        } catch {
          sessionId = null
        }
      }
    } else if (sessionId) {
      try {
        const loaded = await client.loadSession(
          sessionId,
          ctx.thread.workspaceRootPath,
          mcpServers,
        )
        const meta = parseSessionMeta(loaded)
        sessionModes = meta.sessionModes
        configOptions = meta.configOptions
        discoveredModels = meta.discoveredModels
        boundModel = meta.currentModelId
      } catch {
        sessionId = null
      }
    }
    if (!sessionId) {
      try {
        const created = await client.createSession(
          ctx.thread.workspaceRootPath,
          mcpServers,
        )
        sessionId = created.sessionId
        const meta = parseSessionMeta(created)
        sessionModes = meta.sessionModes
        configOptions = meta.configOptions
        discoveredModels = meta.discoveredModels
        boundModel = meta.currentModelId
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (/auth/i.test(message)) {
          const authenticating = {
            status: "authenticating" as const,
            message,
            providerId: this.id,
            updatedAt: new Date().toISOString(),
          }
          globalAcpPool.setConnectionState(key, authenticating)
          ctx.emit({
            type: "connection.update",
            threadId: ctx.thread.id,
            connection: authenticating,
          })
          ctx.emit({
            type: "turn.failed",
            turnId: ctx.turnId,
            threadId: ctx.thread.id,
            error: message,
          })
          this.liveCtx.delete(key)
          this.aborts.delete(ctx.thread.id)
          return
        }
        throw err
      }
    }

    // Cursor extension: enrich models via cursor/list_available_models when catalog empty.
    if (this.id === "cursor:acp" && (!discoveredModels || discoveredModels.length === 0)) {
      try {
        const listed = await runAcpRequest(client, "cursor/list_available_models", {})
        const fromExt = parseCursorListAvailableModels(listed)
        if (fromExt.length > 0) discoveredModels = fromExt
      } catch {
        /* extension optional */
      }
    }

    const desiredModel = ctx.input.model ?? ctx.thread.model
    if (desiredModel && desiredModel !== "auto" && desiredModel !== boundModel) {
      try {
        await client.setSessionModel(sessionId, desiredModel)
        boundModel = desiredModel
      } catch {
        await client.setConfigOption(sessionId, "model", desiredModel).catch(() => undefined)
        boundModel = desiredModel
      }
    }

    if (ctx.thread.interactionMode) {
      const modeId =
        ctx.thread.interactionMode === "plan"
          ? "plan"
          : ctx.thread.interactionMode === "ask"
            ? "ask"
            : "agent"
      await client.setSessionMode(sessionId, modeId).catch(() => undefined)
    }

    ctx.emit({
      type: "session.bound",
      threadId: ctx.thread.id,
      acpSessionId: sessionId,
      providerInstanceId: ctx.thread.providerInstanceId ?? ctx.thread.agentId ?? undefined,
      providerTransport: "acp",
      ...(sessionModes !== undefined ? { sessionModes } : {}),
      ...(configOptions !== undefined ? { configOptions } : {}),
      ...(discoveredModels ? { discoveredModels } : {}),
      ...(boundModel ? { model: boundModel } : {}),
    })
    this.liveSessions.set(ctx.thread.id, { client, sessionId })

    const messageId = crypto.randomUUID()
    let assistant = ""
    const toolState = new Map<
      string,
      { name: string; summary?: string; output?: string; status: string }
    >()
    const onUpdate = (params: unknown) => {
      const root = params as {
        sessionUpdate?: string
        update?: Record<string, unknown>
        content?: { type?: string; text?: string }
        toolCallId?: string
        title?: string
        status?: string
        locations?: Array<{ path?: string }>
        rawInput?: unknown
        rawOutput?: unknown
        entries?: Array<{ content?: string; status?: string; priority?: string }>
        availableCommands?: Array<{ name?: string; description?: string; input?: string }>
        used?: number
        size?: number
        limit?: number
      }
      const update = (root.update as typeof root | undefined) ?? root
      const kind = String(update.sessionUpdate ?? root.sessionUpdate ?? "")
      const contentText =
        typeof update.content === "object" && update.content && "text" in update.content
          ? String((update.content as { text?: string }).text ?? "")
          : typeof update.content === "string"
            ? update.content
            : ""

      if (kind === "agent_thought_chunk") {
        const text = contentText || (typeof update.content === "string" ? update.content : "")
        if (!text) return
        ctx.emit({
          type: "thought.delta",
          turnId: ctx.turnId,
          threadId: ctx.thread.id,
          text,
          thoughtId: `thought-${ctx.turnId}`,
        })
      } else if (kind === "agent_message_chunk" || (!kind && update.content?.type === "text")) {
        const text = contentText || update.content?.text || ""
        if (!text) return
        assistant += text
        ctx.emit({
          type: "content.delta",
          turnId: ctx.turnId,
          threadId: ctx.thread.id,
          messageId,
          text: assistant,
        })
      }
      if (kind === "available_commands_update") {
        const commands = (update.availableCommands ?? []).map(c => ({
          name: c.name ?? c.input ?? "/cmd",
          description: c.description ?? "",
        }))
        ctx.emit({
          type: "commands.update",
          threadId: ctx.thread.id,
          commands,
        })
      }
      if (kind === "tool_call" || kind === "tool_call_update") {
        const toolCallId =
          update.toolCallId ??
          (update as { toolCall?: { toolCallId?: string } }).toolCall?.toolCallId ??
          crypto.randomUUID()
        const prev = toolState.get(toolCallId) ?? { name: "tool", status: "running" }
        const title =
          update.title ??
          (update as { toolCall?: { title?: string } }).toolCall?.title ??
          prev.name
        const pathSummary =
          update.locations?.[0]?.path ??
          (typeof update.rawInput === "object" &&
          update.rawInput &&
          "path" in (update.rawInput as object)
            ? String((update.rawInput as { path?: string }).path)
            : undefined) ??
          prev.summary
        const output =
          typeof update.rawOutput === "string"
            ? update.rawOutput
            : update.rawOutput != null
              ? JSON.stringify(update.rawOutput)
              : prev.output
        const statusRaw = String(update.status ?? prev.status)
        const status =
          statusRaw === "completed"
            ? ("completed" as const)
            : statusRaw === "failed"
              ? ("failed" as const)
              : statusRaw === "pending"
                ? ("pending" as const)
                : ("running" as const)
        toolState.set(toolCallId, {
          name: title,
          summary: pathSummary,
          output,
          status,
        })
        ctx.emit({
          type: "tool.upsert",
          turnId: ctx.turnId,
          threadId: ctx.thread.id,
          toolCallId,
          name: title,
          status,
          summary: pathSummary,
          input:
            typeof update.rawInput === "string"
              ? update.rawInput
              : update.rawInput != null
                ? JSON.stringify(update.rawInput)
                : undefined,
          output,
        })
      }
      if (kind === "plan") {
        const entries = (update.entries ?? []).map((e, i) => ({
          id: `plan-${i}`,
          label: e.content ?? `step-${i}`,
          status:
            e.status === "completed"
              ? ("completed" as const)
              : e.status === "in_progress"
                ? ("in_progress" as const)
                : e.status === "failed"
                  ? ("failed" as const)
                  : ("pending" as const),
        }))
        ctx.emit({
          type: "plan.update",
          turnId: ctx.turnId,
          threadId: ctx.thread.id,
          plan: {
            id: `plan-${ctx.turnId}`,
            entries,
            updatedAt: new Date().toISOString(),
          },
        })
      }
      if (kind === "usage_update") {
        ctx.emit({
          type: "usage.update",
          turnId: ctx.turnId,
          threadId: ctx.thread.id,
          usage: {
            used: Number(update.used ?? 0),
            limit: update.size ?? update.limit ?? null,
            unit: "tokens",
          },
        })
      }
    }
    client.on("sessionUpdate", onUpdate)
    client.on("notification", (method: string, params: unknown) => {
      if (method === "cursor/update_todos") {
        const p = params as {
          toolCallId?: string
          todos?: Array<{ id?: string; content?: string; status?: string }>
        }
        ctx.emit({
          type: "plan.update",
          turnId: ctx.turnId,
          threadId: ctx.thread.id,
          plan: {
            id: p.toolCallId ?? `todos-${ctx.turnId}`,
            entries: (p.todos ?? []).map((t, i) => ({
              id: t.id ?? `todo-${i}`,
              label: t.content ?? `todo-${i}`,
              status:
                t.status === "completed"
                  ? ("completed" as const)
                  : t.status === "in_progress"
                    ? ("in_progress" as const)
                    : ("pending" as const),
            })),
            updatedAt: new Date().toISOString(),
          },
        })
      }
    })

    try {
      if (abort.signal.aborted) throw new Error("cancelled")
      const promptBlocks: unknown[] = [{ type: "text", text: ctx.input.text }]
      for (const img of ctx.input.images ?? []) {
        promptBlocks.push({
          type: "image",
          data: img.data,
          mimeType: img.mimeType,
        })
      }
      for (const file of ctx.input.files ?? []) {
        let body = file.data
        if (!body && file.path && fs.existsSync(file.path)) {
          body = fs.readFileSync(file.path, "utf8")
        }
        if (body) {
          let textBody = body
          try {
            if (!body.includes("\n") && /^[A-Za-z0-9+/=]+$/.test(body.slice(0, 80))) {
              textBody = Buffer.from(body, "base64").toString("utf8")
            }
          } catch {
            textBody = body
          }
          promptBlocks.push({
            type: "text",
            text: `\n\nAttached file ${file.name}:\n${textBody}`,
          })
        } else {
          promptBlocks.push({
            type: "resource_link",
            name: file.name,
            uri: file.path ? `file://${file.path}` : file.name,
          })
        }
      }
      // Race prompt against abort so mid-turn interrupt actually cancels (t3 Fiber.interrupt parity).
      const promptPromise = client.prompt(sessionId, promptBlocks)
      const abortPromise = new Promise<never>((_, reject) => {
        if (abort.signal.aborted || ctx.signal.aborted) {
          reject(new Error("cancelled"))
          return
        }
        const onAbort = () => reject(new Error("cancelled"))
        abort.signal.addEventListener("abort", onAbort, { once: true })
        ctx.signal.addEventListener("abort", onAbort, { once: true })
      })
      try {
        await Promise.race([promptPromise, abortPromise])
      } catch (err) {
        if (abort.signal.aborted || ctx.signal.aborted || (err instanceof Error && err.message === "cancelled")) {
          throw new Error("cancelled")
        }
        throw err
      }
      if (abort.signal.aborted || ctx.signal.aborted) throw new Error("cancelled")
      ctx.emit({
        type: "content.done",
        turnId: ctx.turnId,
        threadId: ctx.thread.id,
        messageId,
        text: assistant,
      })
      ctx.emit({ type: "turn.completed", turnId: ctx.turnId, threadId: ctx.thread.id })
    } catch (err) {
      if (abort.signal.aborted || ctx.signal.aborted || (err instanceof Error && err.message === "cancelled")) {
        try {
          await client.cancel(sessionId)
        } catch {
          /* ignore */
        }
        // 15s grace then force-kill if process still around (t3 / matrix parity).
        setTimeout(() => {
          try {
            client.forceKill()
          } catch {
            /* ignore */
          }
        }, ACP_CANCEL_FORCE_KILL_MS)
        ctx.emit({ type: "turn.cancelled", turnId: ctx.turnId, threadId: ctx.thread.id })
      } else {
        // Keep any streamed partial assistant text before marking the turn failed.
        if (assistant) {
          ctx.emit({
            type: "content.done",
            turnId: ctx.turnId,
            threadId: ctx.thread.id,
            messageId,
            text: assistant,
          })
        }
        ctx.emit({
          type: "turn.failed",
          turnId: ctx.turnId,
          threadId: ctx.thread.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    } finally {
      client.off("sessionUpdate", onUpdate)
      this.aborts.delete(ctx.thread.id)
      this.liveCtx.delete(key)
      this.liveSessions.delete(ctx.thread.id)
      globalAcpPool.touch(key)
    }
  }

  async interrupt(threadId: string): Promise<void> {
    this.aborts.get(threadId)?.abort()
    const live = this.liveSessions.get(threadId)
    if (live) {
      try {
        await live.client.cancel(live.sessionId)
      } catch {
        /* ignore */
      }
    }
  }

  async stopSession(_threadId: string): Promise<void> {
    await this.interrupt(_threadId)
  }

  private assertInsideRoot(root: string, target: string): void {
    const resolvedRoot = path.resolve(root)
    const resolved = path.resolve(target)
    if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
      throw new Error(`path escapes workspace root: ${target}`)
    }
  }
}
