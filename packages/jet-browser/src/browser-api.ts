import type { JetElectronAPI } from "@jet/workspace"
import type { ProjectSearchResult } from "@jet/shared"
import { pathToFileUri } from "@jet/shared"
import type {
  AgentThread,
  AgentWorkspaceSnapshot,
  AgentProvidersState,
  CreateAgentThreadInput,
  InterruptAgentTurnInput,
  SendAgentMessageInput,
  SetAgentThreadArchivedInput,
  UpdateAgentThreadSettingsInput,
} from "@jet/agents"

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
      writeFile: (uri, content) =>
        postJson(baseUrl, "/fs/writeFile", { uri, content }).then(() => undefined),
      readDir: uri => postJson(baseUrl, "/fs/readDir", { uri }),
      stat: uri => postJson(baseUrl, "/fs/stat", { uri }),
      showOpenFolderDialog: async () => null,
      showSaveFileDialog: async () => null,
    },
    search: {
      project: (rootUri, query, opts) =>
        postJson<{ results: ProjectSearchResult[] }>(baseUrl, "/search/project", {
          rootUri,
          query,
          ...opts,
        }).then(r => r.results),
      listFiles: rootUri =>
        postJson<{ files: string[] }>(baseUrl, "/search/listFiles", { rootUri }).then(r => r.files),
      fileSearch: (rootUri, query, opts) =>
        postJson<{ files: string[] }>(baseUrl, "/search/fileSearch", {
          rootUri,
          query,
          ...opts,
        }).then(r => r.files),
      trackFileAccess: (rootUri, query, path) =>
        postJson(baseUrl, "/search/trackFileAccess", { rootUri, query, path }).then(() => undefined),
      isScanReady: rootUri =>
        postJson<{ ready: boolean }>(baseUrl, "/search/isScanReady", { rootUri }).then(r => r.ready),
      isSupported: rootUri =>
        postJson<{ supported: boolean }>(baseUrl, "/search/isSupported", { rootUri }).then(
          r => r.supported,
        ),
    },
    lsp: {
      start: (rootUri, languageId, command, args) =>
        postJson<{ transportUrl: string; id: string }>(baseUrl, "/lsp/start", {
          rootUri,
          languageId,
          command,
          args,
      }),
      stop: id => postJson(baseUrl, "/lsp/stop", { id }).then(() => undefined),
      onCrashed: () => () => {},
    },
    agents: {
      listThreads: (workspaceRootUri, workspaceRootPath) =>
        postJson<AgentWorkspaceSnapshot>(baseUrl, "/agents/listThreads", {
          workspaceRootUri,
          workspaceRootPath,
        }),
      readThread: (workspaceRootUri, workspaceRootPath, threadId) =>
        postJson<AgentThread | null>(baseUrl, "/agents/readThread", {
          workspaceRootUri,
          workspaceRootPath,
          threadId,
        }),
      createThread: (input: CreateAgentThreadInput) =>
        postJson<AgentThread>(baseUrl, "/agents/createThread", input),
      sendMessage: (input: SendAgentMessageInput) =>
        postJson<AgentThread>(baseUrl, "/agents/sendMessage", input),
      interruptTurn: (input: InterruptAgentTurnInput) =>
        postJson<AgentThread | null>(baseUrl, "/agents/interruptTurn", input),
      setArchived: (input: SetAgentThreadArchivedInput) =>
        postJson<AgentThread | null>(baseUrl, "/agents/setArchived", input),
      updateThreadSettings: (input: UpdateAgentThreadSettingsInput) =>
        postJson<AgentThread | null>(baseUrl, "/agents/updateThreadSettings", input),
      listProviders: () =>
        postJson<AgentProvidersState>(baseUrl, "/agents/listProviders", {}),
      refreshProviders: () =>
        postJson<AgentProvidersState>(baseUrl, "/agents/refreshProviders", {}),
      onThreadUpdated: undefined,
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
