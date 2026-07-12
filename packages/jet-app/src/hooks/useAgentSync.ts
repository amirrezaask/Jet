import { useCallback, useEffect, useRef, useState } from "react"
import type { AgentProvidersState, AgentThread, AgentThreadDelta, AgentWorkspaceSnapshot } from "@jet/agents"
import { pathToFileUri, fileUriToPath, Emitter } from "@jet/shared"
import type { WorkspaceService, WorkspaceFolder } from "@jet/workspace"
import type { TabStore } from "@jet/ui"
import { AGENT_EXPLORER_TAB_ID } from "../tabs/agent-explorer.tab.js"
import {
  agentChatTabId,
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

export function useAgentSync(workspace: WorkspaceService, tabStore: TabStore, enabled = true) {
  const [agentProviders, setAgentProviders] = useState<AgentProvidersState | null>(null)

  const agentSnapshotsRef = useRef<Record<string, AgentWorkspaceSnapshot | null>>({})
  const agentThreadsRef = useRef<Record<string, AgentThread | null>>({})
  const agentProvidersRef = useRef(agentProviders)
  const agentThreadEmittersRef = useRef(new Map<string, Emitter<AgentThread | null>>())
  const agentThreadAccessRef = useRef<string[]>([])
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
      const access = agentThreadAccessRef.current.filter(candidate => candidate !== key)
      access.push(key)
      while (access.length > 3) {
        const evictIndex = access.findIndex(candidate => {
          const cached = nextThreads[candidate]
          return cached != null && cached.status !== "running" && candidate !== key
        })
        if (evictIndex < 0) break
        const [evicted] = access.splice(evictIndex, 1)
        delete nextThreads[evicted]
      }
      agentThreadAccessRef.current = access
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
      bumpAgentTab(chatTabId)
      refreshAgentExplorerTab()
    },
    [workspace, bumpAgentTab, refreshAgentExplorerTab],
  )

  const loadAgentSnapshot = useCallback(
    async (rootUri: string, rootPath: string): Promise<AgentWorkspaceSnapshot | null> => {
      if (!enabled) return null
      const transport = window.jet?.agents
      if (!transport) return null
      const snapshot = await transport.listThreads(rootUri, rootPath)
      const prevSnapshot = agentSnapshotsRef.current[rootUri] ?? null
      if (agentSnapshotFingerprint(prevSnapshot) !== agentSnapshotFingerprint(snapshot)) {
        const nextSnapshots = { ...agentSnapshotsRef.current, [rootUri]: snapshot }
        agentSnapshotsRef.current = nextSnapshots
      }
      refreshAgentExplorerTab()
      return snapshot
    },
    [enabled, refreshAgentExplorerTab],
  )

  const syncAgentThreadDelta = useCallback(
    (delta: AgentThreadDelta) => {
      const key = agentThreadStateKey(delta.workspaceRootUri, delta.threadId)
      const thread = agentThreadsRef.current[key]
      if (!thread) return
      const messages = thread.messages.map(message =>
        message.id === delta.messageId
          ? {
              ...message,
              text: delta.text,
              updatedAt: delta.updatedAt,
              streaming: delta.streaming,
            }
          : message,
      )
      syncAgentThread({
        ...thread,
        messages,
        updatedAt: delta.updatedAt,
        status: delta.status,
        lastError: delta.lastError,
      })
    },
    [syncAgentThread],
  )

  const loadAgentProviders = useCallback(async (): Promise<AgentProvidersState | null> => {
    if (!enabled) return null
    const transport = window.jet?.agents
    if (!transport?.listProviders) return null
    const state = await transport.listProviders()
    agentProvidersRef.current = state
    setAgentProviders(state)
    return state
  }, [enabled])

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
    agentThreadAccessRef.current = agentThreadAccessRef.current.filter(key => nextThreads[key] != null)
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
    agentThreadAccessRef.current = agentThreadAccessRef.current.filter(key => nextThreads[key] != null)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const transport = window.jet?.agents
    if (!transport?.onThreadUpdated) return
    return transport.onThreadUpdated(thread => {
      syncAgentThread(thread)
    })
  }, [enabled, syncAgentThread])

  useEffect(() => {
    if (!enabled) return
    const transport = window.jet?.agents
    if (!transport?.onThreadDelta) return
    return transport.onThreadDelta(syncAgentThreadDelta)
  }, [enabled, syncAgentThreadDelta])

  useEffect(() => {
    if (!enabled) return
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
  }, [enabled, syncAgentThread, workspace.folders])

  useEffect(() => {
    if (!enabled) return
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
  }, [enabled, workspace, loadAgentSnapshot, pruneAgentRoots])

  useEffect(() => {
    if (!enabled) return
    void loadAgentProviders()
  }, [enabled, loadAgentProviders])

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
