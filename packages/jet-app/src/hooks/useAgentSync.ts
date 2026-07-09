import { useCallback, useEffect, useRef, useState } from "react"
import type { AgentProvidersState, AgentThread, AgentWorkspaceSnapshot } from "@jet/agents"
import { pathToFileUri, fileUriToPath, Emitter } from "@jet/shared"
import type { WorkspaceService, WorkspaceFolder } from "@jet/workspace"
import type { TabStore } from "@jet/ui"
import { AGENT_EXPLORER_TAB_ID } from "../tabs/agent-explorer.tab.js"
import {
  agentChatTabId,
  parseAgentChatTabId,
  type AgentChatTabState,
} from "../tabs/agent-chat.tab.js"

function normalizeAbsPath(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, "")
  return trimmed || p
}

function normalizeAgentRootUri(uri: string): string {
  if (!uri.startsWith("file://")) return uri
  return pathToFileUri(fileUriToPath(uri))
}

function agentThreadStateKey(rootUri: string, threadId: string): string {
  return `${normalizeAgentRootUri(rootUri)}\u0000${threadId}`
}

function agentThreadEmitterKey(rootUri: string, threadId: string): string {
  return agentThreadStateKey(rootUri, threadId)
}

function agentSnapshotFingerprint(snapshot: AgentWorkspaceSnapshot | null): string {
  if (!snapshot) return ""
  return snapshot.threads.map(t => `${t.id}:${t.updatedAt}:${t.messageCount}`).join("|")
}

function agentThreadsFingerprint(
  threads: Record<string, AgentThread | null>,
  rootUri: string,
): string {
  return Object.entries(threads)
    .filter(([key]) => key.startsWith(`${rootUri}\u0000`))
    .map(([key, thread]) => (thread ? `${key}:${thread.updatedAt}:${thread.messages.length}` : key))
    .join("|")
}

export function useAgentSync(workspace: WorkspaceService, tabStore: TabStore) {
  const [agentProviders, setAgentProviders] = useState<AgentProvidersState | null>(null)

  const agentSnapshotsRef = useRef<Record<string, AgentWorkspaceSnapshot | null>>({})
  const agentThreadsRef = useRef<Record<string, AgentThread | null>>({})
  const agentProvidersRef = useRef(agentProviders)
  const agentThreadEmittersRef = useRef(new Map<string, Emitter<AgentThread | null>>())
  const sendAgentInFlightRef = useRef(false)

  agentProvidersRef.current = agentProviders

  const findWorkspaceFolderByRootUri = useCallback(
    (rootUri: string) =>
      workspace.manager.folders.find(
        folder =>
          folder.root.uri === rootUri ||
          normalizeAbsPath(folder.root.uri) === normalizeAbsPath(rootUri),
      ) ?? null,
    [workspace],
  )

  const bumpAgentTab = useCallback(
    (tabId: string) => {
      if (!workspace.tabRegistry.get(tabId)) return
      tabStore.update(tabId, prev => prev)
    },
    [workspace, tabStore],
  )

  const refreshAgentExplorerTab = useCallback(() => {
    bumpAgentTab(AGENT_EXPLORER_TAB_ID)
  }, [bumpAgentTab])

  const syncAgentThread = useCallback(
    (thread: AgentThread | null) => {
      if (!thread) return
      const key = agentThreadStateKey(thread.workspaceRootUri, thread.id)
      const nextThreads = { ...agentThreadsRef.current, [key]: thread }
      agentThreadsRef.current = nextThreads
      let emitter = agentThreadEmittersRef.current.get(key)
      if (!emitter) {
        emitter = new Emitter<AgentThread | null>()
        agentThreadEmittersRef.current.set(key, emitter)
      }
      emitter.fire(thread)
      const nextSnapshot: AgentWorkspaceSnapshot = {
        workspaceRootUri: thread.workspaceRootUri,
        workspaceRootPath: thread.workspaceRootPath,
        threads: [
          {
            id: thread.id,
            title: thread.title,
            updatedAt: thread.updatedAt,
            createdAt: thread.createdAt,
            archivedAt: thread.archivedAt,
            status: thread.status,
            lastError: thread.lastError,
            latestUserMessageAt:
              [...thread.messages]
                .reverse()
                .find(message => message.role === "user")
                ?.createdAt ?? null,
            messageCount: thread.messages.length,
          },
          ...(agentSnapshotsRef.current[thread.workspaceRootUri]?.threads ?? []).filter(
            entry => entry.id !== thread.id,
          ),
        ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      }
      const nextSnapshots = {
        ...agentSnapshotsRef.current,
        [thread.workspaceRootUri]: nextSnapshot,
      }
      agentSnapshotsRef.current = nextSnapshots
      const chatTabId = agentChatTabId(thread.workspaceRootUri, thread.id)
      workspace.tabRegistry.update(chatTabId, { label: thread.title })
      const parsed = parseAgentChatTabId(chatTabId)
      if (parsed) {
        tabStore.update(chatTabId, prev => {
          const state = prev as AgentChatTabState
          return {
            ...state,
            rootUri: parsed.rootUri,
            threadId: parsed.threadId,
            rev: thread.updatedAt,
            thread,
          }
        })
      } else {
        bumpAgentTab(chatTabId)
      }
      refreshAgentExplorerTab()
    },
    [workspace, bumpAgentTab, refreshAgentExplorerTab, tabStore],
  )

  const loadAgentSnapshot = useCallback(
    async (rootUri: string, rootPath: string): Promise<AgentWorkspaceSnapshot | null> => {
      const transport = window.jet?.agents
      if (!transport) return null
      const snapshot = await transport.listThreads(rootUri, rootPath)
      const prevSnapshot = agentSnapshotsRef.current[rootUri] ?? null
      if (agentSnapshotFingerprint(prevSnapshot) !== agentSnapshotFingerprint(snapshot)) {
        const nextSnapshots = { ...agentSnapshotsRef.current, [rootUri]: snapshot }
        agentSnapshotsRef.current = nextSnapshots
      }
      const loadedThreads = await Promise.all(
        snapshot.threads.map(thread => transport.readThread(rootUri, rootPath, thread.id)),
      )
      if (loadedThreads.some(Boolean)) {
        const prevFingerprint = agentThreadsFingerprint(agentThreadsRef.current, rootUri)
        const nextThreads = { ...agentThreadsRef.current }
        for (const thread of loadedThreads) {
          if (!thread) continue
          nextThreads[agentThreadStateKey(thread.workspaceRootUri, thread.id)] = thread
        }
        if (agentThreadsFingerprint(nextThreads, rootUri) !== prevFingerprint) {
          agentThreadsRef.current = nextThreads
        }
      }
      refreshAgentExplorerTab()
      return snapshot
    },
    [refreshAgentExplorerTab],
  )

  const loadAgentProviders = useCallback(async (): Promise<AgentProvidersState | null> => {
    const transport = window.jet?.agents
    if (!transport?.listProviders) return null
    const state = await transport.listProviders()
    agentProvidersRef.current = state
    setAgentProviders(state)
    return state
  }, [])

  const refreshAgentProviders = useCallback(async (): Promise<AgentProvidersState | null> => {
    const transport = window.jet?.agents
    if (!transport?.refreshProviders) return loadAgentProviders()
    const state = await transport.refreshProviders()
    agentProvidersRef.current = state
    setAgentProviders(state)
    return state
  }, [loadAgentProviders])

  const loadAgentThread = useCallback(
    async (rootUri: string, rootPath: string, threadId: string): Promise<AgentThread | null> => {
      const transport = window.jet?.agents
      if (!transport) return null
      const thread = await transport.readThread(rootUri, rootPath, threadId)
      if (thread) syncAgentThread(thread)
      return thread
    },
    [syncAgentThread],
  )

  const getAgentProviders = useCallback(() => agentProvidersRef.current, [])
  const getAgentSnapshot = useCallback(
    (rootUri: string) => agentSnapshotsRef.current[rootUri] ?? null,
    [],
  )
  const getAgentThread = useCallback(
    (rootUri: string, threadId: string) =>
      agentThreadsRef.current[agentThreadStateKey(rootUri, threadId)] ?? null,
    [],
  )

  const subscribeAgentThread = useCallback(
    (rootUri: string, threadId: string, listener: (thread: AgentThread | null) => void) => {
      const key = agentThreadEmitterKey(rootUri, threadId)
      let emitter = agentThreadEmittersRef.current.get(key)
      if (!emitter) {
        emitter = new Emitter<AgentThread | null>()
        agentThreadEmittersRef.current.set(key, emitter)
      }
      listener(agentThreadsRef.current[key] ?? null)
      const sub = emitter.event(listener)
      return () => sub.dispose()
    },
    [],
  )

  const getAgentExplorerGroups = useCallback(() => {
    return workspace.folders.map(folder => {
      const snapshot = agentSnapshotsRef.current[folder.root.uri]
      const activeThreads = snapshot?.threads.filter(thread => thread.archivedAt == null) ?? []
      const archivedThreads = snapshot?.threads.filter(thread => thread.archivedAt != null) ?? []
      return {
        id: folder.id,
        name: folder.root.name,
        path: folder.root.path,
        rootUri: folder.root.uri,
        snapshot: snapshot ? { ...snapshot, threads: activeThreads } : null,
        archivedThreads,
      }
    })
  }, [workspace])

  const sendAgentMessage = useCallback(
    async (
      rootUri: string,
      threadId: string,
      payload: { text: string; provider: string | null; model: string | null },
    ): Promise<void> => {
      if (sendAgentInFlightRef.current) return
      const transport = window.jet?.agents
      const folder = findWorkspaceFolderByRootUri(rootUri)
      if (!transport || !folder) return
      sendAgentInFlightRef.current = true
      try {
        const thread = await transport.sendMessage({
          workspaceRootUri: rootUri,
          workspaceRootPath: folder.root.path,
          threadId,
          text: payload.text,
          provider: payload.provider,
          model: payload.model,
        })
        syncAgentThread(thread)
        const supportsThreadPush = typeof transport.onThreadUpdated === "function"
        const rootPath = thread.workspaceRootPath || folder.root.path
        if (!supportsThreadPush) {
          for (let attempt = 0; attempt < 75; attempt += 1) {
            await new Promise(resolve => window.setTimeout(resolve, 200))
            const fresh = await transport.readThread!(rootUri, rootPath, threadId)
            if (fresh) syncAgentThread(fresh)
            if (fresh && fresh.status !== "running") break
          }
        }
      } finally {
        sendAgentInFlightRef.current = false
      }
    },
    [findWorkspaceFolderByRootUri, syncAgentThread],
  )

  const interruptAgentTurn = useCallback(
    async (rootUri: string, threadId: string): Promise<void> => {
      const transport = window.jet?.agents
      const folder = findWorkspaceFolderByRootUri(rootUri)
      if (!transport?.interruptTurn || !folder) return
      const thread = await transport.interruptTurn({
        workspaceRootUri: rootUri,
        workspaceRootPath: folder.root.path,
        threadId,
      })
      if (thread) syncAgentThread(thread)
    },
    [findWorkspaceFolderByRootUri, syncAgentThread],
  )

  const updateAgentThreadSettings = useCallback(
    async (
      rootUri: string,
      threadId: string,
      settings: { provider?: string | null; model?: string | null },
    ): Promise<void> => {
      const transport = window.jet?.agents
      const folder = findWorkspaceFolderByRootUri(rootUri)
      if (!transport?.updateThreadSettings || !folder) return
      const thread = await transport.updateThreadSettings({
        workspaceRootUri: rootUri,
        workspaceRootPath: folder.root.path,
        threadId,
        provider: settings.provider,
        model: settings.model,
      })
      if (thread) syncAgentThread(thread)
    },
    [findWorkspaceFolderByRootUri, syncAgentThread],
  )

  const setAgentThreadArchived = useCallback(
    async (
      rootUri: string,
      rootPath: string,
      threadId: string,
      archived: boolean,
    ): Promise<void> => {
      const transport = window.jet?.agents
      if (!transport?.setArchived) return
      const thread = await transport.setArchived({
        workspaceRootUri: rootUri,
        workspaceRootPath: rootPath,
        threadId,
        archived,
      })
      if (thread) {
        syncAgentThread(thread)
        refreshAgentExplorerTab()
      }
    },
    [syncAgentThread, refreshAgentExplorerTab],
  )

  const archiveAgentThread = useCallback(
    (rootUri: string, rootPath: string, threadId: string) =>
      setAgentThreadArchived(rootUri, rootPath, threadId, true),
    [setAgentThreadArchived],
  )

  const unarchiveAgentThread = useCallback(
    (rootUri: string, rootPath: string, threadId: string) =>
      setAgentThreadArchived(rootUri, rootPath, threadId, false),
    [setAgentThreadArchived],
  )

  const pruneAgentRoots = useCallback((folders: WorkspaceFolder[]) => {
    const keep = new Set(folders.map(folder => folder.root.uri))
    const nextSnapshots: Record<string, AgentWorkspaceSnapshot | null> = {}
    for (const [key, value] of Object.entries(agentSnapshotsRef.current)) {
      if (keep.has(key)) nextSnapshots[key] = value
    }
    agentSnapshotsRef.current = nextSnapshots
    const nextThreads: Record<string, AgentThread | null> = {}
    for (const [key, value] of Object.entries(agentThreadsRef.current)) {
      const rootUri = key.split("\u0000", 1)[0]!
      if (keep.has(rootUri)) nextThreads[key] = value
    }
    agentThreadsRef.current = nextThreads
  }, [])

  const removeAgentRoot = useCallback((rootUri: string) => {
    const nextSnapshots = { ...agentSnapshotsRef.current }
    delete nextSnapshots[rootUri]
    agentSnapshotsRef.current = nextSnapshots
    const nextThreads = { ...agentThreadsRef.current }
    for (const key of Object.keys(nextThreads)) {
      if (key.startsWith(`${rootUri}\u0000`)) delete nextThreads[key]
    }
    agentThreadsRef.current = nextThreads
  }, [])

  useEffect(() => {
    const transport = window.jet?.agents
    if (!transport?.onThreadUpdated) return
    return transport.onThreadUpdated(thread => {
      syncAgentThread(thread)
    })
  }, [syncAgentThread])

  useEffect(() => {
    const transport = window.jet?.agents
    if (!transport?.readThread || transport.onThreadUpdated) return
    let cancelled = false
    const pollRunningThreads = async () => {
      if (cancelled) return
      const threads = Object.values(agentThreadsRef.current).filter(
        (thread): thread is AgentThread => thread != null,
      )
      const running = threads.filter(thread => thread.status === "running")
      if (running.length === 0) return
      for (const thread of running) {
        const folder = workspace.folders.find(f => f.root.uri === thread.workspaceRootUri)
        if (!folder) continue
        const fresh = await transport.readThread!(
          thread.workspaceRootUri,
          folder.root.path,
          thread.id,
        )
        if (fresh) syncAgentThread(fresh)
      }
    }
    const intervalId = window.setInterval(() => void pollRunningThreads(), 400)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [syncAgentThread, workspace.folders])

  useEffect(() => {
    const syncAgentRoots = (folders: WorkspaceFolder[]) => {
      pruneAgentRoots(folders)
      for (const folder of folders) {
        void loadAgentSnapshot(folder.root.uri, folder.root.path)
      }
    }
    syncAgentRoots(workspace.manager.folders)
    const sub = workspace.manager.onDidChangeFolders.event(folders => {
      syncAgentRoots(folders)
    })
    return () => sub.dispose()
  }, [workspace, loadAgentSnapshot, pruneAgentRoots])

  useEffect(() => {
    void loadAgentProviders()
  }, [loadAgentProviders])

  return {
    agentProviders,
    syncAgentThread,
    loadAgentSnapshot,
    loadAgentThread,
    refreshAgentProviders,
    getAgentProviders,
    getAgentSnapshot,
    getAgentThread,
    subscribeAgentThread,
    getAgentExplorerGroups,
    sendAgentMessage,
    interruptAgentTurn,
    updateAgentThreadSettings,
    archiveAgentThread,
    unarchiveAgentThread,
    refreshAgentExplorerTab,
    findWorkspaceFolderByRootUri,
    removeAgentRoot,
  }
}
