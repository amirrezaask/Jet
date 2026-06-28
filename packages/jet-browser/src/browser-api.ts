import type { JetElectronAPI } from "@jet/workspace"
import { pathToFileUri } from "@jet/shared"

async function postJson<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function createBrowserJetAPI(baseUrl = "/__jet"): JetElectronAPI {
  return {
    fs: {
      readFile: uri => postJson<string>(baseUrl, "/fs/readFile", { uri }),
      writeFile: (uri, content) => postJson(baseUrl, "/fs/writeFile", { uri, content }).then(() => undefined),
      readDir: uri => postJson(baseUrl, "/fs/readDir", { uri }),
      stat: uri => postJson(baseUrl, "/fs/stat", { uri }),
      showOpenFolderDialog: async () => null,
    },
    git: {
      isRepo: rootUri => postJson<boolean>(baseUrl, "/git/isRepo", { rootUri }),
      status: rootUri => postJson(baseUrl, "/git/status", { rootUri }),
      diff: (rootUri, opts) =>
        postJson<{ diff: string }>(baseUrl, "/git/diff", { rootUri, ...opts }).then(r => r.diff),
    },
    lsp: {
      start: async () => {
        throw new Error("LSP is not available in browser dev mode")
      },
      stop: async () => {},
      onCrashed: () => () => {},
    },
  }
}

export async function resolveDevWorkspacePath(
  input: string,
  baseUrl = "/__jet",
): Promise<{ path: string; uri: string }> {
  return postJson(baseUrl, "/fs/resolveWorkspace", { path: input })
}

export function toWorkspaceFileUri(workspacePath: string, relativeOrUri: string): string {
  if (relativeOrUri.startsWith("file://")) return relativeOrUri
  const normalized = relativeOrUri.replace(/^\/+/, "")
  return pathToFileUri(`${workspacePath}/${normalized}`)
}
