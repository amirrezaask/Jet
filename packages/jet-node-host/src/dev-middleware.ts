import type { IncomingMessage, ServerResponse } from "node:http"
import os from "node:os"
import path from "node:path"
import { assertAllowedUri, normalizeRoots } from "./sandbox.js"
import * as nodeFs from "./fs.js"
import * as nodeGit from "./git.js"
import * as nodeSearch from "./search.js"
import { pathToUri, uriToPath } from "./paths.js"
import { loadGlobalJetrcScanRoots } from "./global-jetrc.js"
import {
  buildWorkspaceSnapshot,
  newAgentThread,
  touchThread,
  type AgentThread,
  type CreateAgentThreadInput,
  type SendAgentMessageInput,
  type SetAgentThreadArchivedInput,
  type AgentProvidersState,
} from "@jet/agents"

export type JetDevHostOptions = {
  allowedRoots: string[]
}

type AgentStorePayload = {
  threads: AgentThread[]
}

function devAgentProvidersState(): AgentProvidersState {
  return {
    updatedAt: new Date().toISOString(),
    providers: [
      {
        instanceId: "codex",
        driverKind: "codex",
        displayName: "Codex",
        enabled: true,
        status: "ready",
        message: null,
        models: [
          { slug: "gpt-5", name: "GPT-5", shortName: "5" },
          { slug: "gpt-5-mini", name: "GPT-5 Mini", shortName: "5 Mini" },
        ],
      },
      {
        instanceId: "claudeAgent",
        driverKind: "claudeAgent",
        displayName: "Claude",
        enabled: true,
        status: "ready",
        message: null,
        models: [
          { slug: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", shortName: "Sonnet 4" },
        ],
      },
    ],
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString("utf8")
  return text ? JSON.parse(text) : {}
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(body))
}

function agentStorePath(rootPath: string): string {
  return path.join(rootPath, ".jet", "agents", "state.json")
}

async function readAgentStore(rootPath: string): Promise<AgentStorePayload> {
  try {
    const raw = await nodeFs.readFile(pathToUri(agentStorePath(rootPath)))
    const parsed = JSON.parse(raw) as Partial<AgentStorePayload>
    return { threads: Array.isArray(parsed.threads) ? parsed.threads : [] }
  } catch {
    return { threads: [] }
  }
}

async function writeAgentStore(rootPath: string, payload: AgentStorePayload): Promise<void> {
  await nodeFs.writeFile(pathToUri(agentStorePath(rootPath)), JSON.stringify(payload, null, 2))
}

async function guardUri(uri: string, allowedRoots: string[]): Promise<void> {
  await assertAllowedUri(uri, allowedRoots, uriToPath)
}

export function resolveWorkspacePath(input: string, allowedRoots: string[]): string {
  const roots = normalizeRoots(allowedRoots)
  if (path.isAbsolute(input)) {
    return input
  }
  for (const root of roots) {
    const candidate = path.resolve(root, input)
    const rel = path.relative(root, candidate)
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      return candidate
    }
  }
  return path.resolve(roots[0]!, input)
}

export async function handleJetDevRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: JetDevHostOptions,
): Promise<boolean> {
  const url = req.url ?? ""
  if (!url.startsWith("/__jet/")) return false

  try {
    const pathname = url.split("?")[0] ?? url
    const body = req.method === "POST" ? ((await readBody(req)) as Record<string, unknown>) : {}

    if (pathname === "/__jet/fs/readFile" && req.method === "POST") {
      const uri = String(body.uri ?? "")
      await guardUri(uri, opts.allowedRoots)
      sendJson(res, 200, await nodeFs.readFile(uri))
      return true
    }

    if (pathname === "/__jet/fs/writeFile" && req.method === "POST") {
      const uri = String(body.uri ?? "")
      await guardUri(uri, opts.allowedRoots)
      await nodeFs.writeFile(uri, String(body.content ?? ""))
      sendJson(res, 200, { ok: true })
      return true
    }

    if (pathname === "/__jet/fs/readDir" && req.method === "POST") {
      const uri = String(body.uri ?? "")
      await guardUri(uri, opts.allowedRoots)
      sendJson(res, 200, await nodeFs.readDir(uri))
      return true
    }

    if (pathname === "/__jet/fs/stat" && req.method === "POST") {
      const uri = String(body.uri ?? "")
      await guardUri(uri, opts.allowedRoots)
      sendJson(res, 200, await nodeFs.stat(uri))
      return true
    }

    if (pathname === "/__jet/fs/resolveWorkspace" && req.method === "POST") {
      const input = String(body.path ?? "")
      const abs = resolveWorkspacePath(input, opts.allowedRoots)
      await assertAllowedUri(pathToUri(abs), opts.allowedRoots, uriToPath)
      sendJson(res, 200, { path: abs, uri: pathToUri(abs) })
      return true
    }

    if (pathname === "/__jet/git/isRepo" && req.method === "POST") {
      const rootUri = String(body.rootUri ?? "")
      await guardUri(rootUri, opts.allowedRoots)
      sendJson(res, 200, await nodeGit.gitIsRepo(rootUri))
      return true
    }

    if (pathname === "/__jet/git/status" && req.method === "POST") {
      const rootUri = String(body.rootUri ?? "")
      await guardUri(rootUri, opts.allowedRoots)
      sendJson(res, 200, await nodeGit.gitStatus(rootUri))
      return true
    }

    if (pathname === "/__jet/git/diff" && req.method === "POST") {
      const rootUri = String(body.rootUri ?? "")
      await guardUri(rootUri, opts.allowedRoots)
      sendJson(res, 200, {
        diff: await nodeGit.gitDiff(rootUri, {
          path: body.path ? String(body.path) : undefined,
          staged: Boolean(body.staged),
        }),
      })
      return true
    }

    if (pathname === "/__jet/git/branch" && req.method === "POST") {
      const rootUri = String(body.rootUri ?? "")
      await guardUri(rootUri, opts.allowedRoots)
      sendJson(res, 200, await nodeGit.gitBranch(rootUri))
      return true
    }

    if (pathname === "/__jet/git/stage" && req.method === "POST") {
      const rootUri = String(body.rootUri ?? "")
      await guardUri(rootUri, opts.allowedRoots)
      await nodeGit.gitStage(rootUri, (body.paths as string[]) ?? [])
      sendJson(res, 200, { ok: true })
      return true
    }

    if (pathname === "/__jet/git/unstage" && req.method === "POST") {
      const rootUri = String(body.rootUri ?? "")
      await guardUri(rootUri, opts.allowedRoots)
      await nodeGit.gitUnstage(rootUri, (body.paths as string[]) ?? [])
      sendJson(res, 200, { ok: true })
      return true
    }

    if (pathname === "/__jet/git/commit" && req.method === "POST") {
      const rootUri = String(body.rootUri ?? "")
      await guardUri(rootUri, opts.allowedRoots)
      await nodeGit.gitCommit(rootUri, String(body.message ?? ""))
      sendJson(res, 200, { ok: true })
      return true
    }

    if (pathname === "/__jet/git/branches" && req.method === "POST") {
      const rootUri = String(body.rootUri ?? "")
      await guardUri(rootUri, opts.allowedRoots)
      sendJson(res, 200, await nodeGit.gitBranches(rootUri))
      return true
    }

    if (pathname === "/__jet/git/checkout" && req.method === "POST") {
      const rootUri = String(body.rootUri ?? "")
      await guardUri(rootUri, opts.allowedRoots)
      await nodeGit.gitCheckout(rootUri, String(body.branch ?? ""))
      sendJson(res, 200, { ok: true })
      return true
    }

    if (pathname === "/__jet/search/project" && req.method === "POST") {
      const rootUri = String(body.rootUri ?? "")
      await guardUri(rootUri, opts.allowedRoots)
      sendJson(res, 200, {
        results: await nodeSearch.projectSearch(rootUri, String(body.query ?? ""), {
          caseSensitive: Boolean(body.caseSensitive),
          regex: Boolean(body.regex),
          fuzzy: Boolean(body.fuzzy),
        }),
      })
      return true
    }

    if (pathname === "/__jet/search/fileSearch" && req.method === "POST") {
      const rootUri = String(body.rootUri ?? "")
      await guardUri(rootUri, opts.allowedRoots)
      sendJson(res, 200, {
        files: await nodeSearch.fileSearch(rootUri, String(body.query ?? ""), {
          pageSize: body.pageSize != null ? Number(body.pageSize) : undefined,
          currentFile: body.currentFile ? String(body.currentFile) : undefined,
        }),
      })
      return true
    }

    if (pathname === "/__jet/search/trackFileAccess" && req.method === "POST") {
      const rootUri = String(body.rootUri ?? "")
      await guardUri(rootUri, opts.allowedRoots)
      await nodeSearch.trackFileAccess(
        rootUri,
        String(body.query ?? ""),
        String(body.path ?? ""),
      )
      sendJson(res, 200, { ok: true })
      return true
    }

    if (pathname === "/__jet/search/isScanReady" && req.method === "POST") {
      const rootUri = String(body.rootUri ?? "")
      await guardUri(rootUri, opts.allowedRoots)
      sendJson(res, 200, { ready: await nodeSearch.isSearchScanReady(rootUri) })
      return true
    }

    if (pathname === "/__jet/search/isSupported" && req.method === "POST") {
      const rootUri = String(body.rootUri ?? "")
      await guardUri(rootUri, opts.allowedRoots)
      sendJson(res, 200, { supported: await nodeSearch.isGitWorkspace(rootUri) })
      return true
    }

    if (pathname === "/__jet/search/listFiles" && req.method === "POST") {
      const rootUri = String(body.rootUri ?? "")
      await guardUri(rootUri, opts.allowedRoots)
      sendJson(res, 200, { files: await nodeSearch.listProjectFiles(rootUri) })
      return true
    }

    if (pathname === "/__jet/lsp/start" && req.method === "POST") {
      const rootUri = String(body.rootUri ?? "")
      await guardUri(rootUri, opts.allowedRoots)
      const { startLspSession } = await import("./lsp-bridge.js")
      const result = await startLspSession({
        rootUri,
        command: body.command ? String(body.command) : undefined,
        args: Array.isArray(body.args) ? (body.args as string[]) : undefined,
      })
      sendJson(res, 200, result)
      return true
    }

    if (pathname === "/__jet/lsp/stop" && req.method === "POST") {
      const id = String(body.id ?? "")
      const { stopLspSession } = await import("./lsp-bridge.js")
      await stopLspSession(id)
      sendJson(res, 200, { ok: true })
      return true
    }

    if (pathname === "/__jet/globalJetrc/scanRoots" && req.method === "GET") {
      const homeDir = os.homedir()
      const scanRoots = await loadGlobalJetrcScanRoots(homeDir)
      sendJson(res, 200, { scanRoots, homeDir })
      return true
    }

    if (pathname === "/__jet/agents/listProviders" && req.method === "POST") {
      sendJson(res, 200, devAgentProvidersState())
      return true
    }

    if (pathname === "/__jet/agents/refreshProviders" && req.method === "POST") {
      sendJson(res, 200, devAgentProvidersState())
      return true
    }

    if (pathname === "/__jet/agents/listThreads" && req.method === "POST") {
      const workspaceRootUri = String(body.workspaceRootUri ?? "")
      await guardUri(workspaceRootUri, opts.allowedRoots)
      const rootPath = String(body.workspaceRootPath ?? "") || uriToPath(workspaceRootUri)
      const payload = await readAgentStore(rootPath)
      sendJson(res, 200, buildWorkspaceSnapshot(workspaceRootUri, rootPath, payload.threads))
      return true
    }

    if (pathname === "/__jet/agents/readThread" && req.method === "POST") {
      const workspaceRootUri = String(body.workspaceRootUri ?? "")
      await guardUri(workspaceRootUri, opts.allowedRoots)
      const rootPath = String(body.workspaceRootPath ?? "") || uriToPath(workspaceRootUri)
      const payload = await readAgentStore(rootPath)
      const threadId = String(body.threadId ?? "")
      sendJson(res, 200, payload.threads.find((thread) => thread.id === threadId) ?? null)
      return true
    }

    if (pathname === "/__jet/agents/createThread" && req.method === "POST") {
      const input = body as Record<string, unknown> as CreateAgentThreadInput
      await guardUri(String(input.workspaceRootUri ?? ""), opts.allowedRoots)
      const rootPath = String(input.workspaceRootPath ?? "") || uriToPath(input.workspaceRootUri)
      const payload = await readAgentStore(rootPath)
      const thread = newAgentThread({ ...input, workspaceRootPath: rootPath })
      payload.threads.unshift(thread)
      await writeAgentStore(rootPath, payload)
      sendJson(res, 200, thread)
      return true
    }

    if (pathname === "/__jet/agents/sendMessage" && req.method === "POST") {
      const input = body as Record<string, unknown> as SendAgentMessageInput
      await guardUri(String(input.workspaceRootUri ?? ""), opts.allowedRoots)
      const rootPath = String(input.workspaceRootPath ?? "") || uriToPath(input.workspaceRootUri)
      const payload = await readAgentStore(rootPath)
      const index = payload.threads.findIndex((thread) => thread.id === input.threadId)
      if (index < 0) {
        sendJson(res, 404, { error: `Unknown agent thread: ${input.threadId}` })
        return true
      }
      const thread = payload.threads[index]!
      const createdAt = new Date().toISOString()
      const next = touchThread(thread, {
        status: "idle",
        lastError: null,
        provider: input.provider ?? thread.provider ?? "codex",
        model: input.model ?? thread.model ?? "gpt-5",
        title:
          thread.messages.length === 0
            ? input.text.trim().slice(0, 64) || thread.title
            : thread.title,
        messages: [
          ...thread.messages,
          {
            id: crypto.randomUUID(),
            role: "user",
            text: input.text,
            createdAt,
            updatedAt: createdAt,
            streaming: false,
          },
        ],
      })
      payload.threads[index] = next
      await writeAgentStore(rootPath, payload)
      sendJson(res, 200, next)
      return true
    }

    if (pathname === "/__jet/agents/setArchived" && req.method === "POST") {
      const input = body as Record<string, unknown> as SetAgentThreadArchivedInput
      await guardUri(String(input.workspaceRootUri ?? ""), opts.allowedRoots)
      const rootPath = String(input.workspaceRootPath ?? "") || uriToPath(input.workspaceRootUri)
      const payload = await readAgentStore(rootPath)
      const index = payload.threads.findIndex((thread) => thread.id === input.threadId)
      if (index < 0) {
        sendJson(res, 200, null)
        return true
      }
      const next = touchThread(payload.threads[index]!, {
        archivedAt: input.archived ? new Date().toISOString() : null,
      })
      payload.threads[index] = next
      await writeAgentStore(rootPath, payload)
      sendJson(res, 200, next)
      return true
    }

    sendJson(res, 404, { error: "Not found" })
    return true
  } catch (err) {
    sendJson(res, 403, { error: err instanceof Error ? err.message : String(err) })
    return true
  }
}
