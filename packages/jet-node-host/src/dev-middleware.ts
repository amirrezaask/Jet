import type { IncomingMessage, ServerResponse } from "node:http"
import os from "node:os"
import path from "node:path"
import { assertAllowedUri, normalizeRoots } from "./sandbox.js"
import * as nodeFs from "./fs.js"
import * as nodeGit from "./git.js"
import * as nodeSearch from "./search.js"
import { pathToUri, uriToPath } from "./paths.js"
import { loadGlobalJetrcScanRoots } from "./global-jetrc.js"

export type JetDevHostOptions = {
  allowedRoots: string[]
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
      sendJson(res, 200, { ready: nodeSearch.isFffScanReady(rootUri) })
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

    sendJson(res, 404, { error: "Not found" })
    return true
  } catch (err) {
    sendJson(res, 403, { error: err instanceof Error ? err.message : String(err) })
    return true
  }
}
