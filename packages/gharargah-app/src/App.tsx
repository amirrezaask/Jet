import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useDeferredValue,
} from "react"
import type { PanelId, PanelView } from "@gharargah/shared"
import { fileUriToPath, pathToFileUri } from "@gharargah/shared"
import {
  WorkspaceService,
  WorkspaceManager,
  CommandRegistry,
  KeymapService,
  keyEventMatchesBinding,
  bind,
  parseBindingKey,
  anyOverlayOpen,
  type KeymapContext,
  type JetCommandContext,
  type JetKeyBinding,
  type LaunchConfig,
  ProjectRegistry,
  GharargahPanelTree,
  type JetProject,
  type WorkspaceFolder,
  popPanelTab,
  panelTabIds,
  findPanelWithTab,
  isTerminalTabId,
  TERMINAL_TAB_ID_PREFIX,
  fileSearchAcrossFolders,
  relativePathInFolder,
  resolveQuickOpenDisplayPath,
} from "@gharargah/workspace"
import type { EditorView } from "@codemirror/view"
import { defaultAgentDriverId, type AgentCatalogState, type AgentThread } from "@gharargah/agents"
import { createAgentBridge } from "./agent-bridge.js"
import {
  TabStore,
  TabTypeRegistry,
  PanelBody,
  bundledThemeList,
  formatKeyBinding,
  WhichKeyPanel,
  type TerminalAgentShortcut,
  type WhichKeyEntry,
  TooltipProvider,
  ConfirmDialogHost,
  Toaster,
  showGharargahToast,
  requestConfirm,
  AppShell,
  GharargahHome,
  TerminalSessionModal,
  type OpenInAppId,
  type SessionDialogMode,
  ModalEditorPane,
  getEditorView,
  getEditorCursor,
  setEditorCursor,
  destroyEditorBuffer,
  FindReplacePopover,
  ProjectTodosPane,
} from "@gharargah/ui"
import { setPendingEditorNavigation, setPendingInitialContent, jumpToLine } from "@gharargah/codemirror"
import { bootstrapFromLaunch } from "./launch-bootstrap.js"
import { useFileDrop } from "./use-file-drop.js"
import { APP_COMMAND_REGISTRY, buildAppCommands, buildMacTerminalQuickSwitchBindings } from "./app-commands.js"
import { registerBuiltinTabTypes } from "./tabs/index.js"
import {
  clearTerminalSession,
  hydrateTerminalSession,
  bindAgentToSession,
  listTerminalSessions,
  subscribeTerminalSessions,
  terminalCwdForTab,
  terminalPtyIdForTab,
  terminalSessionForTab,
} from "./tabs/terminal-session.js"
import {
  readSessionRoster,
  writeSessionRoster,
  type PersistedSessionRoster,
} from "./session-roster-store.js"
import {
  getAllLeafPanels,
  resolveEditorPanel,
  getActiveTabId,
  getActiveEditorFileUri,
  closePanelIfEmpty,
} from "./panel-routing.js"
import { confirmCloseBuffer } from "./close-buffer.js"
import { openTerminalTab } from "./tab-routing.js"
import { buildTerminalExplorerGroups, nextTerminalLabel } from "./terminal-explorer.js"
import { loadGlobalJetrc } from "./load-global-gharargahrc.js"
import { WorkspaceLayoutStore } from "./workspace-layout-store.js"
import { swapWorkspaceLayout } from "./swap-workspace-layout.js"
import { readProjectCatalog, writeProjectCatalog } from "./project-catalog-store.js"
import { loadServerProjectPaths, syncServerProjectCatalog } from "./server-projects.js"
import { useAppearanceSettings } from "./hooks/useAppearanceSettings.js"
import { usePanelLayout } from "./hooks/usePanelLayout.js"
import OverlayHost from "./OverlayHost.js"
import { useTerminalLifecycle } from "./hooks/useTerminalLifecycle.js"
import { useLspLifecycle } from "./hooks/useLspLifecycle.js"
import { useOverlayState } from "./hooks/useOverlayState.js"
import { useGlobalKeymap } from "./hooks/useGlobalKeymap.js"
import { createTabContributorBridge } from "./hooks/tab-contributor-bridge.js"
import type { TabContributorDeps } from "./tabs/deps.js"
import { OverlayControllerSync } from "./hooks/OverlayControllerSync.js"
import {
  OverlayControllerProvider,
  type OverlayHandlers,
} from "./hooks/OverlayController.js"

const COMMAND_RECENTS_STORAGE_KEY = "jet-command-recents"

const GitWorkspace = lazy(() => import("@gharargah/ui/git"))
const AgentChatView = lazy(() =>
  import("@gharargah/ui/agents").then(module => ({ default: module.AgentChatView })),
)

const FN_BY_COMMAND_ID = ((): Map<string, string> => {
  const map = new Map<string, string>()
  for (const entry of APP_COMMAND_REGISTRY) map.set(entry.id, entry.fn)
  return map
})()

type OpenWorkspaceOptions = { replace?: boolean; silent?: boolean }

function normalizeAbsPath(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, "")
  return trimmed || p
}


function loadRecentCommands(): string[] {
  try {
    const raw = localStorage.getItem(COMMAND_RECENTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []
  } catch {
    return []
  }
}

function jetPlatformFS(): import("@gharargah/workspace").FileSystemProvider {
  const jet = window.gharargah
  if (!jet?.fs) {
    throw new Error("window.gharargah.fs not available")
  }
  const fs = jet.fs
  return {
    readFile: uri => fs.readFile(uri),
    writeFile: (uri, content) => fs.writeFile(uri, content),
    readDir: uri => fs.readDir(uri),
    stat: uri => fs.stat(uri),
  }
}

export function GharargahApp() {
  const {
    appearanceSettings,
    setAppearanceSettings,
    activeTheme,
    colorScheme,
    fontSize,
    handleZoom,
    setFontSize,
    resetAppearanceSettings,
  } = useAppearanceSettings()

  const overlay = useOverlayState()
  const {
    open: overlayOpen,
    paletteOpen,
    terminalListOpen,
    cdOpen,
    addWorkspaceOpen,
    settingsOpen,
    projectSwitcherOpen,
    switchFolderOpen,
    folderPickerOpen,
    gotoLineOpen,
    quickOpenOpen,
    bufferListOpen,
    openFileOpen,
    setPaletteOpen,
    setTerminalListOpen,
    setCdOpen,
    setAddWorkspaceOpen,
    setSettingsOpen,
    setProjectSwitcherOpen,
    setSwitchFolderOpen,
    setFolderPickerOpen,
    setGotoLineOpen,
    setQuickOpenOpen,
    setBufferListOpen,
    setOpenFileOpen,
    setOpen,
  } = overlay

  const [layoutReady, setLayoutReady] = useState(false)
  const folderPickerPendingRef = useRef<{
    resolve: (folder: WorkspaceFolder | null) => void
  } | null>(null)
  const [projects, setProjects] = useState<JetProject[]>([])
  const [terminalModalTabId, setTerminalModalTabId] = useState<string | null>(null)
  const terminalModalTabIdRef = useRef(terminalModalTabId)
  terminalModalTabIdRef.current = terminalModalTabId
  const [terminalModalPanelId, setTerminalModalPanelId] = useState<PanelId | null>(null)
  const [terminalModalTitleTick, setTerminalModalTitleTick] = useState(0)
  const [terminalModalGitBranch, setTerminalModalGitBranch] = useState<string | null>(null)
  const [terminalSessionRevision, setTerminalSessionRevision] = useState(0)
  const [, setWorkspaceRevision] = useState(0)
  const [sessionMode, setSessionMode] = useState<SessionDialogMode>("terminal")
  const sessionModeRef = useRef(sessionMode)
  sessionModeRef.current = sessionMode
  const [agentCatalog, setAgentCatalog] = useState<AgentCatalogState | null>(null)
  const [activeAgentThread, setActiveAgentThread] = useState<AgentThread | null>(null)
  const [agentLoading, setAgentLoading] = useState(false)
  const [editorFocus, setEditorFocus] = useState(false)
  const [searchSupported, setSearchSupported] = useState(false)
  const [searchScanReady, setSearchScanReady] = useState(false)
  const [editorChromeTick, setEditorChromeTick] = useState(0)
  const [recentCommands, setRecentCommands] = useState<string[]>(() => loadRecentCommands())
  const [pendingChordPrefix, setPendingChordPrefix] = useState<string | null>(null)
  const fontSizeRef = useRef(fontSize)
  fontSizeRef.current = fontSize
  const initialized = useRef(false)
  const queryBootstrapDone = useRef(false)
  const projectCatalogReadyRef = useRef(false)
  const sessionRosterReadyRef = useRef(false)
  const startupRecordedRef = useRef(false)
  const openWorkspaceRef = useRef<(folderPath: string, opts?: OpenWorkspaceOptions) => void | Promise<void>>(
    () => {},
  )
  const addWorkspaceRef = useRef<(folderPath: string) => Promise<void>>(async () => {})
  const workspaceInitGen = useRef(new Map<string, number>())
  const workspaceRootPathRef = useRef<string | null>(null)
  const workspaceLayoutStoreRef = useRef(new WorkspaceLayoutStore())
  const lastActiveRootUriRef = useRef<string | null>(null)
  const homeDirRef = useRef("")
  const projectRegistry = useMemo(() => new ProjectRegistry(), [])
  const appStateRef = useRef({
    panelTree: null! as GharargahPanelTree,
    focusedPanel: null as PanelId | null,
    keymapContext: undefined as KeymapContext | undefined,
    editorPanelRef: null as React.MutableRefObject<PanelId | null> | null,
  })

  const workspaceManager = useMemo(() => new WorkspaceManager(jetPlatformFS()), [])
  const workspace = useMemo(() => new WorkspaceService(workspaceManager), [workspaceManager])
  const commands = useMemo(() => new CommandRegistry(), [])
  const keymaps = useMemo(() => new KeymapService(), [])
  const tabTypeRegistry = useMemo(() => new TabTypeRegistry(), [])
  const tabStore = useMemo(() => new TabStore(tabTypeRegistry), [tabTypeRegistry])

  const {
    panelTree,
    focusedPanel,
    setFocusedPanel,
    editorPanelRef,
    cloneTree,
    commitTree,
    handlePanelEvent,
  } = usePanelLayout(workspace, tabStore, appStateRef as never)

  const openFileInEditorRef = useRef<
    (uri: string, path: string, line?: number, column?: number) => void
  >(() => {})

  const {
    resolveLspClient,
    lspRevision,
    ensureLspForFile,
    handleLspAttachFailed,
    lspStatus,
  } = useLspLifecycle(workspace, (uri, path, line, column) => {
    openFileInEditorRef.current(uri, path, line, column)
  })

  const [keymapRevision, setKeymapRevision] = useState(0)
  const keymapBindings = useMemo(() => keymaps.allBindings(), [keymaps, keymapRevision])

  useEffect(() => {
    const sub = keymaps.onDidChange.event(() => setKeymapRevision(r => r + 1))
    return () => sub.dispose()
  }, [keymaps])

  useEffect(() => {
    const subs = [
      workspace.onDidChangeDirty.event(() => setEditorChromeTick(t => t + 1)),
      workspace.onDidChangeBuffers.event(() => setEditorChromeTick(t => t + 1)),
    ]
    return () => {
      for (const sub of subs) sub.dispose()
    }
  }, [workspace])

  useEffect(() => {
    const mirror = (id: string) => {
      const desc = workspace.tabRegistry.get(id)
      if (!desc) {
        tabStore.dispose(id)
        return
      }
      if (desc.kind === "editor") {
        tabStore.create<{ fileUri: string }>(desc.kind, { fileUri: desc.id }, desc.id)
      } else if (desc.kind === "terminal") {
        tabStore.create<{ label: string; cwdRootUri: string }>(
          desc.kind,
          { label: desc.label, cwdRootUri: terminalCwdForTab(desc.id) || workspace.root?.uri || "" },
          desc.id,
        )
      }
    }
    const sub = workspace.tabRegistry.onDidChange.event(evt => mirror(evt.id))
    return () => sub.dispose()
  }, [workspace, tabStore])

  const activeThemeRef = useRef(activeTheme)
  activeThemeRef.current = activeTheme

  const getTerminalExplorerGroups = useCallback(
    () => {
      const trees = [appStateRef.current.panelTree]
      const activeRootUri = workspace.root?.uri ?? null
      for (const folder of workspace.folders) {
        if (folder.root.uri === activeRootUri) continue
        const saved = workspaceLayoutStoreRef.current.load(folder.root.uri)
        if (saved) trees.push(saved.tree)
      }
      return buildTerminalExplorerGroups(trees, workspace)
    },
    [workspace],
  )

  const activateProject = useCallback(
    (rootUri: string) => {
      const folder = workspace.folders.find(candidate => candidate.root.uri === rootUri)
      if (folder) workspace.setActiveFolder(folder.id)
    },
    [workspace],
  )

  const getActiveTerminalTabId = useCallback((): string | null => {
    const modalTabId = terminalModalTabIdRef.current
    if (modalTabId && isTerminalTabId(modalTabId)) return modalTabId
    const focused = appStateRef.current.focusedPanel
    if (!focused) return null
    const tabId = getActiveTabId(appStateRef.current.panelTree, focused)
    if (!tabId || !isTerminalTabId(tabId)) return null
    return tabId
  }, [])

  const openTerminalModal = useCallback(
    (panelId: PanelId, tabId: string, mode: SessionDialogMode = "terminal") => {
      setTerminalModalPanelId(panelId)
      setTerminalModalTabId(tabId)
      setSessionMode(mode)
    },
    [],
  )

  const closeTerminalModal = useCallback(() => {
    setTerminalModalTabId(null)
    setTerminalModalPanelId(null)
  }, [])

  const focusTerminalTab = useCallback(
    (panelId: PanelId, tabId: string, mode: SessionDialogMode = "terminal") => {
      const focus = () => {
        const tree = cloneTree()
        const owningPanel = findPanelWithTab(tree, tabId) ?? panelId
        workspace.focusTabInPanel(tree, owningPanel, tabId)
        setFocusedPanel(owningPanel)
        commitTree(tree, owningPanel)
        openTerminalModal(owningPanel, tabId, mode)
      }
      const rootUri = terminalCwdForTab(tabId)
      if (rootUri && rootUri !== workspace.root?.uri) {
        activateProject(rootUri)
        requestAnimationFrame(focus)
      } else {
        focus()
      }
    },
    [workspace, cloneTree, commitTree, activateProject, setFocusedPanel, openTerminalModal],
  )

  const goHome = useCallback(() => {
    closeTerminalModal()
    workspace.clearActiveFolder()
  }, [workspace, closeTerminalModal])

  useEffect(() => {
    if (workspace.manager.activeFolder) {
      workspace.clearActiveFolder()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openTerminalFromHome = useCallback(
    (panelId: PanelId, tabId: string) => {
      focusTerminalTab(panelId, tabId)
    },
    [focusTerminalTab],
  )

  const openTerminalInWorkspace = useCallback(
    async (rootUri: string, opts?: { label?: string; launchCommand?: string }) => {
      if (rootUri && rootUri !== workspace.root?.uri) {
        activateProject(rootUri)
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
      const tree = cloneTree()
      const label = opts?.label ?? nextTerminalLabel(tree)
      const { panelId, tabId } = openTerminalTab(workspace, tree, appStateRef.current.focusedPanel, {
        cwdRootUri: rootUri,
        label,
        launchCommand: opts?.launchCommand,
      })
      setFocusedPanel(panelId)
      commitTree(tree, panelId)
      return { panelId, tabId }
    },
    [workspace, activateProject, cloneTree, commitTree, setFocusedPanel],
  )

  const ensureSessionModalOpen = useCallback(
    (rootUri: string | null) => {
      if (terminalModalTabIdRef.current) return
      const targetRootUri = rootUri ?? workspace.root?.uri ?? workspace.folders[0]?.root.uri ?? null
      if (!targetRootUri) return
      void openTerminalInWorkspace(targetRootUri).then(({ panelId, tabId }) => {
        openTerminalModal(panelId, tabId)
      })
    },
    [workspace, openTerminalInWorkspace, openTerminalModal],
  )

  const openFileInEditor = useCallback(
    (uri: string, path: string, line?: number, column?: number) => {
      const tree = cloneTree()
      const existing = tree.findEditorPanelForFile(uri)
      const panel =
        existing ??
        resolveEditorPanel(tree, editorPanelRef.current, appStateRef.current.focusedPanel) ??
        editorPanelRef.current
      if (!panel) return
      editorPanelRef.current = panel
      workspace.assignEditorPanel(tree, panel, uri, path)
      if (line != null) setPendingEditorNavigation(panel, line, column ?? 1)
      setFocusedPanel(panel)
      setSessionMode("editor")
      commitTree(tree, panel)
      ensureSessionModalOpen(workspace.resolveRootUriForFile(uri))
      if (line != null) {
        requestAnimationFrame(() => {
          const view = getEditorView(panel)
          if (view) jumpToLine(view, line, column ?? 1)
        })
      }
      void ensureLspForFile(uri)
    },
    [cloneTree, commitTree, workspace, editorPanelRef, setFocusedPanel, ensureSessionModalOpen, ensureLspForFile],
  )

  openFileInEditorRef.current = openFileInEditor

  const newTerminalFromHome = useCallback(
    async (rootUri: string) => {
      try {
        const { panelId, tabId } = await openTerminalInWorkspace(rootUri)
        openTerminalModal(panelId, tabId)
      } catch (err) {
        console.error("[gharargah] newTerminalFromHome failed", err)
        showGharargahToast(err instanceof Error ? err.message : String(err), { variant: "destructive" })
        closeTerminalModal()
      }
    },
    [openTerminalInWorkspace, openTerminalModal, closeTerminalModal],
  )

  const launchAgentFromHome = useCallback(
    async (rootUri: string, shortcut: TerminalAgentShortcut) => {
      try {
        const { panelId, tabId } = await openTerminalInWorkspace(rootUri, {
          label: shortcut.label,
        })
        bindAgentToSession(tabId, {
          agentId: shortcut.id,
          driverId:
            agentCatalog?.agents.find(agent => agent.id === shortcut.id)?.activeDriverId ??
            defaultAgentDriverId(shortcut.id),
        })
        openTerminalModal(panelId, tabId, "agent")
      } catch (err) {
        console.error("[gharargah] launchAgentFromHome failed", err)
        showGharargahToast(err instanceof Error ? err.message : String(err), { variant: "destructive" })
        closeTerminalModal()
      }
    },
    [agentCatalog, openTerminalInWorkspace, openTerminalModal, closeTerminalModal],
  )

  const openTodosFromHome = useCallback(
    async (rootUri: string) => {
      try {
        const group = getTerminalExplorerGroups().find(g => g.rootUri === rootUri)
        const existing = group?.terminals[0]
        if (existing) {
          focusTerminalTab(existing.panelId, existing.tabId, "todos")
          return
        }
        const { panelId, tabId } = await openTerminalInWorkspace(rootUri)
        openTerminalModal(panelId, tabId, "todos")
      } catch (err) {
        console.error("[gharargah] openTodosFromHome failed", err)
        showGharargahToast(err instanceof Error ? err.message : String(err), { variant: "destructive" })
      }
    },
    [
      getTerminalExplorerGroups,
      focusTerminalTab,
      openTerminalInWorkspace,
      openTerminalModal,
    ],
  )

  const openProjectInApp = useCallback(async (rootUri: string, appId: OpenInAppId) => {
    try {
      const shell = window.gharargah?.shell
      if (!shell?.openInApp) {
        throw new Error("Open in app is not available in this host")
      }
      await shell.openInApp(appId, rootUri)
    } catch (err) {
      console.error("[gharargah] openProjectInApp failed", err)
      showGharargahToast(err instanceof Error ? err.message : String(err), { variant: "destructive" })
    }
  }, [])

  const loadAgentCatalog = useCallback(async (refresh = false): Promise<AgentCatalogState | null> => {
    const agents = window.gharargah?.agents
    if (!agents) return null
    const catalog = refresh ? await agents.refreshAgents() : await agents.listAgents()
    setAgentCatalog(catalog)
    return catalog
  }, [])

  const ensureSessionAgentThread = useCallback(
    async (tabId: string): Promise<AgentThread | null> => {
      const agents = window.gharargah?.agents
      const session = terminalSessionForTab(tabId)
      if (!agents || !session) return null
      const folder = workspace.folders.find(candidate => candidate.root.uri === session.cwdRootUri)
      const workspaceRootPath = folder?.root.path ?? fileUriToPath(session.cwdRootUri)

      setAgentLoading(true)
      try {
        if (session.agentThreadId) {
          const existing = await agents.readThread(
            session.cwdRootUri,
            workspaceRootPath,
            session.agentThreadId,
          )
          if (existing) {
            bindAgentToSession(tabId, {
              agentId: existing.agentId ?? session.agentId ?? "codex",
              driverId:
                existing.driverId ??
                session.agentDriverId ??
                defaultAgentDriverId(existing.agentId ?? session.agentId ?? "codex"),
              threadId: existing.id,
            })
            setActiveAgentThread(existing)
            return existing
          }
        }

        const catalog = agentCatalog ?? (await loadAgentCatalog())
        const selectedAgent =
          catalog?.agents.find(agent => agent.id === session.agentId) ??
          catalog?.agents.find(agent => agent.enabled) ??
          catalog?.agents.find(agent => agent.id === "codex") ??
          catalog?.agents[0]
        const agentId = selectedAgent?.id ?? session.agentId ?? "codex"
        const driverId =
          session.agentDriverId ?? selectedAgent?.activeDriverId ?? defaultAgentDriverId(agentId)
        const thread = await agents.createThread({
          workspaceRootUri: session.cwdRootUri,
          workspaceRootPath,
          title: `${selectedAgent?.displayName ?? "Agent"} session`,
          agentId,
          driverId,
          model: "auto",
        })
        bindAgentToSession(tabId, {
          agentId: thread.agentId ?? agentId,
          driverId: thread.driverId ?? driverId,
          threadId: thread.id,
        })
        setActiveAgentThread(thread)
        return thread
      } finally {
        setAgentLoading(false)
      }
    },
    [agentCatalog, loadAgentCatalog, workspace],
  )

  useEffect(() => {
    if (sessionMode !== "agent" || !terminalModalTabId) return
    setActiveAgentThread(null)
    void ensureSessionAgentThread(terminalModalTabId).catch(error => {
      showGharargahToast(error instanceof Error ? error.message : String(error), {
        variant: "destructive",
      })
    })
  }, [sessionMode, terminalModalTabId, ensureSessionAgentThread])

  useEffect(() => {
    const agents = window.gharargah?.agents
    if (!agents || !activeAgentThread) return
    const offUpdated = agents.onThreadUpdated?.(thread => {
      if (thread.id === activeAgentThread.id) setActiveAgentThread(thread)
    })
    const offDelta = agents.onThreadDelta?.(delta => {
      if (delta.threadId !== activeAgentThread.id) return
      setActiveAgentThread(current => {
        if (!current || current.id !== delta.threadId) return current
        return {
          ...current,
          updatedAt: delta.updatedAt,
          status: delta.status,
          lastError: delta.lastError,
          messages: current.messages.map(message =>
            message.id === delta.messageId
              ? {
                  ...message,
                  text: delta.text,
                  streaming: delta.streaming,
                  updatedAt: delta.updatedAt,
                }
              : message,
          ),
        }
      })
    })
    return () => {
      offUpdated?.()
      offDelta?.()
    }
  }, [activeAgentThread?.id])

  const persistSessionRoster = useCallback(() => {
    if (!sessionRosterReadyRef.current) return
    const sessions = listTerminalSessions().map(session => ({
      tabId: session.tabId,
      cwdRootUri: session.cwdRootUri,
      label: workspace.tabRegistry.get(session.tabId)?.label ?? session.customLabel ?? "Terminal",
      launchCommand: session.launchCommand,
      ptyId: session.ptyId,
      status: session.status,
      exitCode: session.exitCode,
      customLabel: session.customLabel,
      agentId: session.agentId,
      agentDriverId: session.agentDriverId,
      agentThreadId: session.agentThreadId,
    }))
    const modalTabId = terminalModalTabIdRef.current
    const roster: PersistedSessionRoster = {
      version: 2,
      sessions,
      modal: modalTabId
        ? { tabId: modalTabId, sessionMode: sessionModeRef.current }
        : null,
    }
    writeSessionRoster(roster)
  }, [workspace])

  const closeTerminalTab = useCallback(
    (panelId: PanelId, tabId: string) => {
      const close = () => {
        if (terminalModalTabIdRef.current === tabId) {
          setTerminalModalTabId(null)
          setTerminalModalPanelId(null)
        }
        const ptyId = terminalPtyIdForTab(tabId)
        if (ptyId) void window.gharargah?.terminal?.dispose(ptyId)
        const tree = cloneTree()
        const owningPanel = findPanelWithTab(tree, tabId) ?? panelId
        const view = tree.getView(owningPanel)
        if (view?.kind !== "tabs") return
        tabStore.dispose(tabId)
        workspace.disposeTab(tabId)
        tree.setView(owningPanel, popPanelTab(view, tabId))
        closePanelIfEmpty(tree, owningPanel)
        commitTree(tree)
      }
      const rootUri = terminalCwdForTab(tabId)
      if (rootUri && rootUri !== workspace.root?.uri) {
        activateProject(rootUri)
        requestAnimationFrame(close)
      } else {
        close()
      }
    },
    [cloneTree, commitTree, workspace, tabStore, activateProject],
  )

  const onTerminalTitleChange = useCallback(
    (tabId: string, title: string) => {
      if (terminalSessionForTab(tabId)?.customLabel) return
      const existing = workspace.tabRegistry.get(tabId)
      if (!existing || existing.label === title) return
      workspace.tabRegistry.update(tabId, { label: title })
      if (terminalModalTabIdRef.current === tabId) {
        setTerminalModalTitleTick(tick => tick + 1)
      }
      persistSessionRoster()
    },
    [workspace, persistSessionRoster],
  )

  useEffect(() => {
    if (!terminalModalTabId) {
      setTerminalModalGitBranch(null)
      return
    }
    const rootUri = terminalCwdForTab(terminalModalTabId)
    if (!rootUri || !window.gharargah?.git?.branch) {
      setTerminalModalGitBranch(null)
      return
    }
    let cancelled = false
    void window.gharargah.git.branch(rootUri).then(branch => {
      if (!cancelled) setTerminalModalGitBranch(branch)
    }).catch(() => {
      if (!cancelled) setTerminalModalGitBranch(null)
    })
    return () => {
      cancelled = true
    }
  }, [terminalModalTabId, terminalModalTitleTick])

  const tabContributorRef = useRef<TabContributorDeps>(null!)
  const tabContributorBridge = useMemo(
    () => createTabContributorBridge(() => tabContributorRef.current),
    [],
  )

  useEffect(() => {
    registerBuiltinTabTypes(tabTypeRegistry, tabContributorBridge)
  }, [tabTypeRegistry, tabContributorBridge])

  const keymapContext = useMemo(
    () => ({
      editorFocus: editorFocus || sessionMode === "editor",
      paletteOpen,
      quickOpenOpen,
      bufferListOpen,
      openFileOpen,
      cdOpen,
      projectSwitcherOpen,
      gotoLineOpen,
      outlineOpen: false,
      workspaceOpen: workspace.manager.hasFolders(),
      explorerFocus: false,
      terminalExplorerFocus: false,
      outputFocus: false,
      terminalFocus: sessionMode === "terminal",
      agentChatFocus: sessionMode === "agent",
      listFocus: false,
    }),
    [
      editorFocus,
      sessionMode,
      paletteOpen,
      quickOpenOpen,
      bufferListOpen,
      openFileOpen,
      cdOpen,
      projectSwitcherOpen,
      gotoLineOpen,
      workspace.root,
      terminalModalTabId,
    ],
  )

  appStateRef.current = {
    panelTree,
    focusedPanel,
    keymapContext,
    editorPanelRef,
  }

  useTerminalLifecycle()

  const openUntitledFromDrop = useCallback(
    (name: string, content: string) => {
      const tree = cloneTree()
      const panel =
        resolveEditorPanel(tree, editorPanelRef.current, appStateRef.current.focusedPanel) ??
        editorPanelRef.current
      if (!panel) return
      editorPanelRef.current = panel
      workspace.openUntitledInPanel(tree, panel, { label: name })
      setPendingInitialContent(panel, content)
      setFocusedPanel(panel)
      setSessionMode("editor")
      commitTree(tree, panel)
      ensureSessionModalOpen(workspace.root?.uri ?? null)
    },
    [workspace, cloneTree, commitTree, editorPanelRef, setFocusedPanel, ensureSessionModalOpen],
  )

  useFileDrop({
    fs: jetPlatformFS(),
    knownWorkspacePaths: workspace.folders.map(f => f.root.path),
    normalizePath: normalizeAbsPath,
    openWorkspace: path => void openWorkspaceRef.current(path, { replace: true, silent: true }),
    addWorkspaceFolder: path => void addWorkspaceRef.current(path),
    openFile: (uri, path) => openFileInEditorRef.current(uri, path),
    bootstrapFromLaunch: config => {
      bootstrapFromLaunch(
        path => openWorkspaceRef.current(path, { replace: true, silent: true }),
        (uri, path) => openFileInEditorRef.current(uri, path),
        config,
      )
    },
    openUntitledFromDrop,
    setMessage: showGharargahToast,
  })

  useEffect(
    () =>
      subscribeTerminalSessions(tabId => {
        tabStore.update(tabId, previous => ({ ...(previous as object) }))
        setTerminalSessionRevision(revision => revision + 1)
        persistSessionRoster()
      }),
    [tabStore, persistSessionRoster],
  )

  useEffect(() => {
    persistSessionRoster()
  }, [persistSessionRoster, terminalModalTabId, sessionMode, terminalSessionRevision])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    setLayoutReady(true)
  }, [])

  useEffect(() => {
    workspace.confirmDiscardReload = fileName =>
      requestConfirm({
        title: "File changed on disk",
        description: `"${fileName}" changed on disk. Reload and discard local changes?`,
        confirmLabel: "Reload",
        cancelLabel: "Cancel",
        destructive: true,
      })
    return () => {
      workspace.confirmDiscardReload = null
    }
  }, [workspace])

  useEffect(() => {
    if (!window.gharargah?.fs.onFileChanged) return
    return window.gharargah.fs.onFileChanged(uri => {
      void workspace.handleExternalFileChange(uri)
    })
  }, [workspace])

  const refreshProjects = useCallback(async (): Promise<number> => {
    let homeDir = homeDirRef.current
    if (window.gharargah?.getHomeDir) {
      homeDir = await window.gharargah.getHomeDir()
      homeDirRef.current = homeDir
    }
    const list = await projectRegistry.refresh(jetPlatformFS(), homeDir)
    setProjects(list)
    return list.length
  }, [projectRegistry])

  const pickWorkspaceFolder = useCallback((folders: WorkspaceFolder[]) => {
    return new Promise<WorkspaceFolder | null>(resolve => {
      folderPickerPendingRef.current = { resolve }
      setFolderPickerOpen(true)
    })
  }, [setFolderPickerOpen])

  const handleFolderPickerOpenChange = useCallback((open: boolean) => {
    setFolderPickerOpen(open)
    if (!open && folderPickerPendingRef.current) {
      folderPickerPendingRef.current.resolve(null)
      folderPickerPendingRef.current = null
    }
  }, [setFolderPickerOpen])

  const handleFolderPickerSelect = useCallback((folder: WorkspaceFolder) => {
    folderPickerPendingRef.current?.resolve(folder)
    folderPickerPendingRef.current = null
    setFolderPickerOpen(false)
  }, [setFolderPickerOpen])

  const activateFolderBackground = useCallback(
    (folderId: string, folderPath: string) => {
      const gen = (workspaceInitGen.current.get(folderId) ?? 0) + 1
      workspaceInitGen.current.set(folderId, gen)

      const finishOpen = () => {
        if (workspaceInitGen.current.get(folderId) !== gen) return
        const folder = workspace.manager.folders.find(f => f.id === folderId)
        const rootUri = folder?.root.uri
        if (!rootUri) return
        if (window.gharargah?.workspace) void window.gharargah.workspace.activate(rootUri)
      }
      setTimeout(finishOpen, 0)
    },
    [workspace],
  )

  useEffect(() => {
    const sub = workspace.manager.onDidChangeFolders.event(folders => {
      setWorkspaceRevision(revision => revision + 1)
      for (const folder of folders) {
        if (!workspaceInitGen.current.has(folder.id)) {
          activateFolderBackground(folder.id, folder.root.path)
        }
      }
    })
    return () => sub.dispose()
  }, [workspace, activateFolderBackground])

  useEffect(() => {
    const sub = workspace.manager.onDidChangeActiveFolder.event(folder => {
      const incoming = folder?.root.uri ?? null
      const outgoing = lastActiveRootUriRef.current
      lastActiveRootUriRef.current = incoming

      if (!incoming || !outgoing || incoming === outgoing) return

      const currentTree = cloneTree()
      const swapped = swapWorkspaceLayout({
        store: workspaceLayoutStoreRef.current,
        outgoingRootUri: outgoing,
        incomingRootUri: incoming,
        currentTree,
        editorPanel: editorPanelRef.current,
      })
      editorPanelRef.current =
        swapped.editorPanel ?? resolveEditorPanel(swapped.tree, null, null)
      commitTree(swapped.tree)
    })
    return () => sub.dispose()
  }, [workspace, cloneTree, commitTree])

  const addWorkspaceFolder = useCallback(
    async (folderPath: string): Promise<void> => {
      const folder = await workspace.addFolder(folderPath)
      workspaceRootPathRef.current = folder.root.path
      showGharargahToast(`Added ${folder.root.name}`)
      activateFolderBackground(folder.id, folder.root.path)
    },
    [workspace, activateFolderBackground],
  )

  const openWorkspaceFolder = useCallback(
    async (folderPath: string, opts?: OpenWorkspaceOptions): Promise<void> => {
      const normalized = normalizeAbsPath(folderPath)
      const existing = workspace.folders.find(
        folder => normalizeAbsPath(folder.root.path) === normalized,
      )
      const folder = await workspace.addFolder(folderPath)
      workspaceRootPathRef.current = folder.root.path
      if (!opts?.silent) {
        if (existing || opts?.replace || workspace.folders.length === 1) {
          showGharargahToast(`Opened ${folderPath}`)
        } else {
          showGharargahToast(`Added ${folder.root.name}`)
        }
      }
      activateFolderBackground(folder.id, folder.root.path)
    },
    [workspace, activateFolderBackground],
  )

  const removeWorkspaceFolder = useCallback(
    async (folderId: string): Promise<boolean> => {
      const folder = workspace.manager.folders.find(f => f.id === folderId)
      if (!folder) return false

      const rootUri = folder.root.uri
      const terminalEntries = getTerminalExplorerGroups()
        .find(group => group.rootUri === rootUri)?.terminals ?? []
      if (terminalEntries.length > 0) {
        const confirmed = await requestConfirm({
          title: `Remove ${folder.root.name}?`,
          description: `${terminalEntries.length} live terminal${terminalEntries.length === 1 ? "" : "s"} will be closed.`,
          confirmLabel: "Remove Project",
          cancelLabel: "Cancel",
          destructive: true,
        })
        if (!confirmed) return false
        for (const entry of terminalEntries) {
          const ptyId = terminalPtyIdForTab(entry.tabId)
          if (ptyId) await window.gharargah?.terminal?.dispose(ptyId)
          workspace.disposeTab(entry.tabId)
          tabStore.dispose(entry.tabId)
          clearTerminalSession(entry.tabId)
        }
      }

      const tree = cloneTree()
      for (const panel of getAllLeafPanels(tree)) {
        const view = tree.getView(panel)
        if (view?.kind !== "tabs") continue
        for (const tabId of panelTabIds(view)) {
          if (workspace.tabRegistry.kindFor(tabId) !== "terminal") continue
          const ptyId = terminalPtyIdForTab(tabId)
          if (ptyId) await window.gharargah?.terminal?.dispose(ptyId)
          workspace.disposeTab(tabId)
          tabStore.dispose(tabId)
          clearTerminalSession(tabId)
          workspace.closeTabInPanel(tree, panel, tabId)
        }
      }
      commitTree(tree)

      if (window.gharargah?.workspace?.deactivate) {
        await window.gharargah.workspace.deactivate(rootUri)
      }
      workspaceInitGen.current.delete(folderId)
      const removed = workspace.removeFolder(folderId)
      if (removed) {
        workspaceLayoutStoreRef.current.delete(rootUri)
        showGharargahToast(`Removed ${folder.root.name}`)
      }
      return removed
    },
    [workspace, cloneTree, commitTree, tabStore, getTerminalExplorerGroups],
  )

  const removeProjectByRootUri = useCallback(
    (rootUri: string) => {
      const folder = workspace.folders.find(candidate => candidate.root.uri === rootUri)
      if (folder) void removeWorkspaceFolder(folder.id)
    },
    [workspace, removeWorkspaceFolder],
  )

  useEffect(() => {
    const sub = workspace.manager.onDidChangeFolders.event(() => {
      if (projectCatalogReadyRef.current) {
        writeProjectCatalog(
          workspace.manager.folders,
          workspace.manager.activeFolder?.id ?? null,
        )
        void syncServerProjectCatalog(workspace.manager.folders).catch(() => {
          showGharargahToast("Could not persist the project catalog", { variant: "warning" })
        })
      }
    })
    return () => sub.dispose()
  }, [workspace])

  useEffect(() => {
    const sub = workspace.manager.onDidChangeActiveFolder.event(() => {
      if (!projectCatalogReadyRef.current) return
      writeProjectCatalog(
        workspace.manager.folders,
        workspace.manager.activeFolder?.id ?? null,
      )
    })
    return () => sub.dispose()
  }, [workspace])

  useEffect(() => {
    const rootUri = workspace.root?.uri ?? null
    setSearchSupported(false)
    setSearchScanReady(false)
    if (!rootUri || !window.gharargah?.search) return
    const search = window.gharargah.search
    let cancelled = false
    let pollTimer: number | null = null

    const pollScanReady = () => {
      void search
        .isScanReady?.(rootUri)
        .then(ready => {
          if (cancelled) return
          setSearchScanReady(Boolean(ready))
          if (!ready) pollTimer = window.setTimeout(pollScanReady, 500)
        })
        .catch(() => {
          if (!cancelled) setSearchScanReady(true)
        })
    }

    void search
      .isSupported?.(rootUri)
      .then(supported => {
        if (cancelled) return
        setSearchSupported(Boolean(supported))
        if (supported) pollScanReady()
      })
      .catch(() => {
        if (!cancelled) setSearchSupported(false)
      })

    return () => {
      cancelled = true
      if (pollTimer != null) window.clearTimeout(pollTimer)
    }
  }, [workspace, workspace.root])

  openWorkspaceRef.current = openWorkspaceFolder
  addWorkspaceRef.current = addWorkspaceFolder

  const keybindingByFn = useMemo(() => {
    const map = new Map<JetKeyBinding["run"], string>()
    for (const binding of keymapBindings) {
      if (!map.has(binding.run)) map.set(binding.run, binding.key)
    }
    return map
  }, [keymapBindings])

  const fnByCommandId = FN_BY_COMMAND_ID

  const getCommandContext = useCallback((viewOverride?: EditorView): JetCommandContext => {
    return {
      workspace,
      ui: {
        showMessage: showGharargahToast,
        showCommandPalette: () => setPaletteOpen(true),
        setCommandPaletteOpen: setPaletteOpen,
      },
      getActiveEditorView: () => {
        if (viewOverride) return viewOverride
        const panel = editorPanelRef.current ?? appStateRef.current.focusedPanel
        return panel ? (getEditorView(panel) ?? null) : null
      },
    }
  }, [workspace, setPaletteOpen, editorPanelRef])

  const resetAppearanceWithToast = useCallback(() => {
    resetAppearanceSettings()
    showGharargahToast("Appearance reset")
  }, [resetAppearanceSettings])

  const appCommands = useMemo(
    () =>
      buildAppCommands({
        workspace,
        getPanelTree: () => appStateRef.current.panelTree,
        getFocusedPanel: () => appStateRef.current.focusedPanel,
        setPaletteOpen,
        setQuickOpenOpen,
        setBufferListOpen,
        setTerminalListOpen,
        setOpenFileOpen,
        setCdOpen,
        setAddWorkspaceOpen,
        setProjectSwitcherOpen,
        setSwitchFolderOpen,
        pickWorkspaceFolder,
        setGotoLineOpen,
        setMessage: showGharargahToast,
        setFocusedPanel,
        cloneTree,
        commitTree,
        openWorkspaceFolder,
        addWorkspaceFolder,
        removeWorkspaceFolder,
        setActiveWorkspaceFolder: (id: string) => {
          workspace.setActiveFolder(id)
        },
        handlePanelEvent,
        openFileInEditor,
        editorPanelRef,
        setZoomLevel: handleZoom,
        projectRegistry,
        refreshProjects,
        getActiveTerminalTabId,
        closeTerminalTab,
        getTerminalExplorerGroups,
        focusTerminalTab,
        openTerminalModal,
        setSessionMode,
        getContextFolder: () => workspace.manager.activeFolder,
        getSearchSupported: () => searchSupported,
        goHome,
      }),
    [
      workspace,
      cloneTree,
      commitTree,
      openWorkspaceFolder,
      addWorkspaceFolder,
      removeWorkspaceFolder,
      handleZoom,
      projectRegistry,
      refreshProjects,
      pickWorkspaceFolder,
      goHome,
      getActiveTerminalTabId,
      closeTerminalTab,
      getTerminalExplorerGroups,
      focusTerminalTab,
      openTerminalModal,
      handlePanelEvent,
      openFileInEditor,
      searchSupported,
      setQuickOpenOpen,
      setBufferListOpen,
      setOpenFileOpen,
      setGotoLineOpen,
    ],
  )

  const deferredPanelTree = useDeferredValue(panelTree)

  const paletteBaseCommands = useMemo(() => {
    void deferredPanelTree
    const list = commands.list(getCommandContext()).map(cmd => {
      const fnName = fnByCommandId.get(cmd.id)
      const run = fnName ? appCommands[fnName as keyof typeof appCommands] : undefined
      const key = run ? keybindingByFn.get(run) : undefined
      return {
        ...cmd,
        keybinding: key ? formatKeyBinding(key) : undefined,
        recent: false,
      }
    })
    list.sort((a, b) => a.title.localeCompare(b.title))
    return list
  }, [commands, deferredPanelTree, appCommands, keybindingByFn, fnByCommandId, getCommandContext])

  const paletteCommands = useMemo(() => {
    if (!paletteOpen) return []
    if (recentCommands.length === 0) return paletteBaseCommands
    const recentSet = new Set(recentCommands)
    const recentBucket: typeof paletteBaseCommands = []
    const restBucket: typeof paletteBaseCommands = []
    for (const cmd of paletteBaseCommands) {
      if (recentSet.has(cmd.id)) recentBucket.push({ ...cmd, recent: true })
      else restBucket.push(cmd)
    }
    return recentBucket.concat(restBucket)
  }, [paletteOpen, paletteBaseCommands, recentCommands])

  const whichKeyEntries: WhichKeyEntry[] = useMemo(() => {
    if (!pendingChordPrefix) return []
    const fnToTitle = new Map<string, string>()
    for (const entry of APP_COMMAND_REGISTRY) fnToTitle.set(entry.fn, entry.title)
    const runToFn = new Map<JetKeyBinding["run"], string>()
    for (const [fnName, run] of Object.entries(appCommands)) runToFn.set(run, fnName)
    const seen = new Set<string>()
    const entries: WhichKeyEntry[] = []
    for (const binding of keymapBindings) {
      const parts = parseBindingKey(binding.key)
      if (parts.length < 2 || parts[0] !== pendingChordPrefix) continue
      const second = parts[1]!
      if (seen.has(second)) continue
      seen.add(second)
      const fnName = runToFn.get(binding.run)
      const title = fnName ? fnToTitle.get(fnName) : undefined
      entries.push({ key: formatKeyBinding(second), desc: title ?? fnName ?? second })
    }
    return entries
  }, [keymapBindings, pendingChordPrefix, appCommands])

  const runKeyBinding = useCallback(
    (binding: JetKeyBinding, view?: EditorView) => {
      void binding.run(getCommandContext(view))
    },
    [getCommandContext],
  )

  const executeCommandRef = useRef<(name: string) => Promise<void>>(() => Promise.resolve())

  tabContributorRef.current = {
    workspace,
    getTheme: () => activeThemeRef.current,
    resolveLspClient,
    getLspRevision: () => lspRevision,
    executeCommand: name => executeCommandRef.current(name),
    runKeyBinding,
    getKeymapBindings: () => keymapBindings,
    getUserExtensions: () => [],
    getKeymapRevision: () => keymapRevision,
    getKeymapContext: () => appStateRef.current.keymapContext,
    onEditorFocusChange: setEditorFocus,
    onEditorSelectionChange: (line, column, rangeCount) =>
      setEditorCursor({ line, column, rangeCount }),
    onLspAttachFailed: handleLspAttachFailed,
    onProblemsChange: () => {},
    closeTerminalTab,
    onTerminalTitleChange,
  }

  useEffect(() => {
    const noOverlay = (ctx: KeymapContext) => !anyOverlayOpen(ctx)
    const whenWorkspace = (ctx: KeymapContext) => ctx.workspaceOpen && noOverlay(ctx)
    keymaps.registerUser([
      bind("Cmd-p", appCommands.terminalList, noOverlay),
      bind("Cmd-Shift-p", appCommands.palette, noOverlay),
      bind("Cmd-k Cmd-o", appCommands.openFolder, noOverlay),
      bind("Cmd-w", appCommands.closeTab, whenWorkspace),
      bind("Ctrl-`", appCommands.terminal, whenWorkspace),
      bind("Cmd-=", appCommands.zoomIn, noOverlay),
      bind("Cmd--", appCommands.zoomOut, noOverlay),
      bind("Cmd-o", appCommands.openFile, noOverlay),
      bind("Cmd-Shift-o", appCommands.quickOpen, whenWorkspace),
      bind("Cmd-s", appCommands.save, whenWorkspace),
      bind("Cmd-n", appCommands.newFile, whenWorkspace),
      bind("Cmd-f", appCommands.find, ctx => ctx.editorFocus && noOverlay(ctx)),
      bind("Cmd-h", appCommands.replace, ctx => ctx.editorFocus && noOverlay(ctx)),
      bind("Cmd-g", appCommands.gotoLine, ctx => ctx.editorFocus && noOverlay(ctx)),
      bind("Cmd-Shift-b", appCommands.bufferList, whenWorkspace),
      bind("Mod-Shift-e", appCommands.showEditor, whenWorkspace),
      bind("Mod-Shift-t", appCommands.showTerminal, whenWorkspace),
      ...buildMacTerminalQuickSwitchBindings({
        workspace,
        getTerminalExplorerGroups,
        focusTerminalTab,
        setMessage: showGharargahToast,
      }),
      bind("Escape", appCommands.goHome, ctx =>
        noOverlay(ctx) &&
        !ctx.paletteOpen &&
        !terminalModalTabIdRef.current,
      ),
      bind("Mod-Shift-h", appCommands.goHome, ctx => noOverlay(ctx)),
    ])
  }, [keymaps, appCommands, workspace, getTerminalExplorerGroups, focusTerminalTab])

  useEffect(() => {
    if (!layoutReady) return
    void (async () => {
      const fetchScanRoots = async (): Promise<string[]> => {
        if (window.gharargah?.loadGlobalGharargahrcScanRoots) {
          if (window.gharargah.getHomeDir) homeDirRef.current = await window.gharargah.getHomeDir()
          return window.gharargah.loadGlobalGharargahrcScanRoots()
        }
        const res = await fetch("/__gharargah/globalGharargahrc/scanRoots")
        if (!res.ok) return []
        const data = (await res.json()) as { scanRoots?: string[]; homeDir?: string }
        if (data.homeDir) homeDirRef.current = data.homeDir
        return data.scanRoots ?? []
      }
      await loadGlobalJetrc(projectRegistry, {
        homeDir: homeDirRef.current,
        fetchScanRoots,
      })
      await refreshProjects()
    })()
  }, [layoutReady, projectRegistry, refreshProjects])

  const executeCommand = useCallback(
    async (name: string) => {
      if (!commands.has(name)) return
      await commands.execute(name, getCommandContext())
      setRecentCommands(prev => {
        const next = [name, ...prev.filter(id => id !== name)].slice(0, 12)
        localStorage.setItem(COMMAND_RECENTS_STORAGE_KEY, JSON.stringify(next))
        return next
      })
    },
    [commands, getCommandContext],
  )

  executeCommandRef.current = executeCommand

  useEffect(() => {
    const disposables = APP_COMMAND_REGISTRY.map(entry => {
      const run = appCommands[entry.fn]
      if (!run) return null
      return commands.register(entry.id, run, {
        id: entry.id,
        title: entry.title,
        category: entry.category,
        aliases: "aliases" in entry ? [...entry.aliases] : undefined,
      })
    }).filter(Boolean)

    disposables.push(
      commands.register(
        "project.activate",
        () => setProjectSwitcherOpen(true),
        {
          id: "project.activate",
          title: "Activate Project…",
          category: "Projects",
          aliases: ["switch workspace", "project picker"],
        },
      ),
      commands.register(
        "project.remove",
        () => {
          const rootUri = workspace.root?.uri
          if (rootUri) removeProjectByRootUri(rootUri)
        },
        {
          id: "project.remove",
          title: "Remove Active Project",
          category: "Projects",
        },
      ),
    )
    disposables.push(
      commands.register(
        "settings.show",
        () => setSettingsOpen(true),
        {
          id: "settings.show",
          title: "Settings",
          category: "UI",
          aliases: ["preferences", "appearance", "font", "theme"],
        },
      ),
    )
    disposables.push(
      commands.register(
        "ui.showThemePicker",
        () => setSettingsOpen(true),
        {
          id: "ui.showThemePicker",
          title: "Theme Picker",
          category: "UI",
          aliases: ["themes", "colors"],
        },
      ),
    )
    for (const theme of bundledThemeList) {
      disposables.push(
        commands.register(
          `ui.setTheme.${theme.id}`,
          () => {
            setAppearanceSettings(prev => ({ ...prev, themeId: theme.id }))
            showGharargahToast(`Theme: ${theme.name}`)
          },
          {
            id: `ui.setTheme.${theme.id}`,
            title: `Theme: ${theme.name}`,
            category: "UI",
            aliases: [theme.family ?? "", theme.scheme ?? "", "theme"].filter(Boolean),
          },
        ),
      )
    }
    disposables.push(
      commands.register(
        "ui.resetAppearance",
        resetAppearanceSettings,
        {
          id: "ui.resetAppearance",
          title: "Reset Appearance",
          category: "UI",
          aliases: ["reset theme", "reset font"],
        },
      ),
    )
    return () => {
      for (const d of disposables) d?.dispose()
    }
  }, [
    commands,
    appCommands,
    resetAppearanceSettings,
    setProjectSwitcherOpen,
    setSettingsOpen,
    workspace,
    removeProjectByRootUri,
    setAppearanceSettings,
  ])

  useEffect(() => {
    window.__gharargahAgent = createAgentBridge(() => ({
      workspace,
      commands,
      panelTree: appStateRef.current.panelTree,
      focusedPanel: appStateRef.current.focusedPanel,
      paletteOpen,
      message: null,
      layoutReady,
      fontSize: fontSizeRef.current,
      executeCommand,
      openWorkspace: folderPath =>
        Promise.resolve(openWorkspaceRef.current(folderPath, { silent: true })),
      addWorkspace: folderPath => Promise.resolve(addWorkspaceRef.current(folderPath)),
      listWorkspaces: () => workspace.manager.folders.map(f => ({ id: f.id, path: f.root.path, name: f.root.name })),
      setFontSize,
      openFile: (uri, path) => openFileInEditor(uri, path),
      getEditorText: () => {
        const panel = editorPanelRef.current ?? appStateRef.current.focusedPanel
        const view = panel ? getEditorView(panel) : null
        return view ? view.state.doc.toString() : null
      },
      setEditorSelection: (line, column) => {
        const panel = editorPanelRef.current ?? appStateRef.current.focusedPanel
        const view = panel ? getEditorView(panel) : null
        if (view) jumpToLine(view, line, column)
      },
      getCursorPosition: () => {
        const pos = getEditorCursor()
        return pos ? { line: pos.line, column: pos.column } : null
      },
      getSelectionRangeCount: () => getEditorCursor()?.rangeCount ?? null,
      activeEditorDirty: (() => {
        const panel = editorPanelRef.current ?? appStateRef.current.focusedPanel
        const fileUri = panel ? getActiveEditorFileUri(appStateRef.current.panelTree, panel) : null
        return fileUri ? (workspace.fileForUri(fileUri)?.isDirty ?? false) : false
      })(),
      searchReady: searchScanReady,
      sessionMode: terminalModalTabId ? sessionMode : null,
    }))
    return () => {
      delete window.__gharargahAgent
    }
  }, [
    workspace,
    commands,
    paletteOpen,
    layoutReady,
    executeCommand,
    setFontSize,
    openFileInEditor,
    editorPanelRef,
    searchScanReady,
    sessionMode,
    terminalModalTabId,
  ])

  useEffect(() => {
    if (!layoutReady || queryBootstrapDone.current) return
    queryBootstrapDone.current = true
    void (async () => {
      const cfg = window.gharargah?.getLaunchConfig ? await window.gharargah.getLaunchConfig() : null
      const catalog = readProjectCatalog()
      const serverPaths = await loadServerProjectPaths().catch(() => [] as string[])
      const paths = [...serverPaths]
      for (const project of catalog.projects) {
        if (!paths.some(path => normalizeAbsPath(path) === normalizeAbsPath(project.path))) {
          paths.push(project.path)
        }
      }
      const explicitLaunch = cfg?.source === "explicit" || cfg?.source === "external" || !!cfg?.filePath

      if (cfg && (explicitLaunch || paths.length === 0)) {
        const launchPath = normalizeAbsPath(cfg.workspacePath)
        if (!paths.some(path => normalizeAbsPath(path) === launchPath)) paths.push(launchPath)
      }

      for (const path of paths) {
        try {
          await workspace.addFolder(path)
        } catch {
          showGharargahToast(`Could not restore ${path}`, { variant: "warning" })
        }
      }

      const activePath = explicitLaunch
        ? cfg?.workspacePath ?? null
        : catalog.activePath ?? cfg?.workspacePath ?? null
      if (activePath) {
        const normalized = normalizeAbsPath(activePath)
        const active = workspace.folders.find(
          folder => normalizeAbsPath(folder.root.path) === normalized,
        )
        if (active) workspace.setActiveFolder(active.id)
      }

      projectCatalogReadyRef.current = true
      writeProjectCatalog(
        workspace.manager.folders,
        workspace.manager.activeFolder?.id ?? null,
      )
      await syncServerProjectCatalog(workspace.manager.folders).catch(() => {})

      const roster = readSessionRoster()
      if (roster.sessions.length > 0) {
        const tree = cloneTree()
        for (const entry of roster.sessions) {
          if (findPanelWithTab(tree, entry.tabId)) continue
          const sessionKey = entry.tabId.startsWith(TERMINAL_TAB_ID_PREFIX)
            ? entry.tabId.slice(TERMINAL_TAB_ID_PREFIX.length)
            : entry.tabId
          openTerminalTab(workspace, tree, appStateRef.current.focusedPanel, {
            sessionKey,
            label: entry.label,
            cwdRootUri: entry.cwdRootUri,
            launchCommand: entry.launchCommand,
          })
          hydrateTerminalSession({
            tabId: entry.tabId,
            cwdRootUri: entry.cwdRootUri,
            launchCommand: entry.launchCommand,
            ptyId: entry.ptyId,
            status: entry.status,
            exitCode: entry.exitCode,
            customLabel: entry.customLabel,
            agentId: entry.agentId,
            agentDriverId: entry.agentDriverId,
            agentThreadId: entry.agentThreadId,
          })
        }
        commitTree(tree)
        setTerminalSessionRevision(revision => revision + 1)

        if (roster.modal) {
          const panelId = findPanelWithTab(tree, roster.modal.tabId)
          if (panelId) {
            setTerminalModalPanelId(panelId)
            setTerminalModalTabId(roster.modal.tabId)
            setSessionMode(roster.modal.sessionMode)
          }
        }
      }

      sessionRosterReadyRef.current = true
      persistSessionRoster()
    })()
  }, [layoutReady, workspace, cloneTree, commitTree, persistSessionRoster])

  useEffect(() => {
    if (
      startupRecordedRef.current ||
      !layoutReady ||
      !projectCatalogReadyRef.current ||
      !workspace.manager.hasFolders() ||
      !window.gharargah?.recordStartup
    ) {
      return
    }
    startupRecordedRef.current = true
    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined
    const bootstrapAt =
      (window as Window & { __gharargahStartupBootstrapAt?: number }).__gharargahStartupBootstrapAt ?? 0
    void window.gharargah.recordStartup({
      shell: "web",
      buildMode: import.meta.env.DEV ? "debug" : "release",
      rendererBootstrapMs: bootstrapAt,
      rendererReadyMs: performance.now(),
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      loadEventMs: navigation?.loadEventEnd ?? null,
      workspaceRootCount: workspace.folders.length,
    }).catch(() => {
      startupRecordedRef.current = false
    })
  }, [layoutReady, workspace, workspace.folders.length])

  useGlobalKeymap({
    keymapBindings,
    keymapContext,
    workspace,
    getFocusedPanel: () => appStateRef.current.focusedPanel,
    getEditorPanel: () => editorPanelRef.current,
    executeCommand,
    runKeyBinding,
    setPendingChordPrefix,
  })

  const overlayHandlers = useMemo(
    (): OverlayHandlers => ({
      setOverlayOpen: setOpen,
      onAppearanceSettingsChange: setAppearanceSettings,
      onTerminalSelect: entry => focusTerminalTab(entry.panelId, entry.tabId),
      onRequestOpenFolder: () => {
        void executeCommand("workspace.openFolder")
      },
      onFolderPickerSelect: handleFolderPickerSelect,
      onSelectFolder: path => openWorkspaceFolder(path, { replace: true }),
      onAddWorkspaceSelect: path => openWorkspaceFolder(path),
      onResetAppearanceSettings: resetAppearanceWithToast,
      onSelectProject: path => openWorkspaceFolder(path),
      onRunCommand: id => {
        void executeCommand(id)
      },
      onFolderPickerOpenChange: handleFolderPickerOpenChange,
      resolveHomeDir: async () => {
        if (!window.gharargah?.getHomeDir) {
          throw new Error("window.gharargah.getHomeDir not available")
        }
        return window.gharargah.getHomeDir()
      },
      onGotoLineSubmit: (line, column) => {
        setGotoLineOpen(false)
        const panel = editorPanelRef.current
        const view = panel ? getEditorView(panel) : null
        if (view) jumpToLine(view, line, column ?? 1)
      },
      onQuickOpenSearch: async (query, workspaceId) => {
        if (!window.gharargah?.search) return []
        const folders = workspaceId
          ? workspace.folders.filter(f => f.id === workspaceId)
          : workspace.folders
        const activeFileUri = editorPanelRef.current
          ? getActiveEditorFileUri(appStateRef.current.panelTree, editorPanelRef.current)
          : null
        const currentFile = (() => {
          if (!activeFileUri) return undefined
          const folder = workspaceId
            ? workspace.folders.find(f => f.id === workspaceId)
            : workspace.manager.activeFolder
          if (!folder) return undefined
          const rel = relativePathInFolder(folder.root.path, fileUriToPath(activeFileUri))
          return rel != null ? { folderId: folder.id, relativePath: rel } : undefined
        })()
        return fileSearchAcrossFolders(folders, window.gharargah.search, query, { currentFile })
      },
      onQuickOpenSelect: (path, _query, workspaceId) => {
        const searchFolders = workspaceId
          ? workspace.folders.filter(folder => folder.id === workspaceId)
          : workspace.folders
        const resolved = resolveQuickOpenDisplayPath(path, searchFolders)
        if (!resolved) return
        openFileInEditor(resolved.fileUri, resolved.fullPath)
        setQuickOpenOpen(false)
      },
      onBufferSelect: uri => {
        const file = workspace.fileForUri(uri)
        openFileInEditor(uri, file?.path ?? fileUriToPath(uri))
        setBufferListOpen(false)
      },
      onOpenFile: (uri, path) => {
        openFileInEditor(uri, path)
        setOpenFileOpen(false)
      },
      searchSupported,
      searchScanReady,
    }),
    [
      setOpen,
      setAppearanceSettings,
      focusTerminalTab,
      executeCommand,
      handleFolderPickerSelect,
      openWorkspaceFolder,
      resetAppearanceWithToast,
      handleFolderPickerOpenChange,
      editorPanelRef,
      workspace,
      openFileInEditor,
      searchSupported,
      searchScanReady,
      setGotoLineOpen,
      setQuickOpenOpen,
      setBufferListOpen,
      setOpenFileOpen,
    ],
  )

  const showOverlayHost =
    terminalListOpen ||
    folderPickerOpen ||
    switchFolderOpen ||
    cdOpen ||
    addWorkspaceOpen ||
    settingsOpen ||
    projectSwitcherOpen ||
    paletteOpen ||
    gotoLineOpen ||
    quickOpenOpen ||
    bufferListOpen ||
    openFileOpen

  void editorChromeTick
  const editorPanelId = editorPanelRef.current
  const editorPanelView = editorPanelId ? panelTree.getView(editorPanelId) : null
  const editorTabIds =
    editorPanelView?.kind === "tabs"
      ? panelTabIds(editorPanelView).filter(id => id.startsWith("file:") || id.startsWith("untitled:"))
      : []
  const editorBuffers =
    editorPanelView?.kind === "tabs"
      ? editorTabIds.map(id => ({
            tabId: id,
            label: tabStore.title(id, workspace.fileForUri(id)?.name ?? id),
            dirty: workspace.fileForUri(id)?.isDirty ?? false,
          }))
      : []
  const editorActiveTabId =
    editorPanelView?.kind === "tabs" && editorTabIds.includes(editorPanelView.activeTabId)
      ? editorPanelView.activeTabId
      : editorTabIds.at(-1) ?? null
  const modalEditorView: PanelView | null = editorPanelId && editorActiveTabId
    ? { kind: "tabs", activeTabId: editorActiveTabId, tabIds: editorTabIds }
    : null

  return (
    <OverlayControllerProvider
      initialAppearanceSettings={appearanceSettings}
      workspace={workspace}
      handlers={overlayHandlers}
    >
      <OverlayControllerSync
        open={overlayOpen}
        appearanceSettings={appearanceSettings}
        projects={projects}
        paletteCommands={paletteCommands}
        terminalGroups={getTerminalExplorerGroups()}
      />
      <TooltipProvider>
        <AppShell
          footer={
            pendingChordPrefix ? (
              <WhichKeyPanel prefix={formatKeyBinding(pendingChordPrefix)} entries={whichKeyEntries} />
            ) : undefined
          }
        >
          <div className="flex h-full min-h-0 w-full flex-col" data-gharargah-shell="home">
            <div className="min-h-0 flex-1 overflow-hidden">
              <GharargahHome
                groups={getTerminalExplorerGroups().map(g => ({
                  id: g.id,
                  name: g.name,
                  path: g.path,
                  rootUri: g.rootUri,
                  terminals: g.terminals.map(t => ({
                    tabId: t.tabId,
                    panelId: t.panelId,
                    label: t.label,
                    status: t.status,
                    exitCode: t.exitCode,
                    launchCommand: t.launchCommand,
                    agentId: t.agentId,
                  })),
                }))}
                onOpenTerminal={openTerminalFromHome}
                onNewTerminal={rootUri => void newTerminalFromHome(rootUri)}
                onLaunchAgentTerminal={(rootUri, shortcut) => void launchAgentFromHome(rootUri, shortcut)}
                onOpenInApp={(rootUri, appId) => void openProjectInApp(rootUri, appId)}
                onAddProject={() => setAddWorkspaceOpen(true)}
                onRemoveProject={removeProjectByRootUri}
                onKillTerminal={closeTerminalTab}
                onOpenTodos={rootUri => void openTodosFromHome(rootUri)}
              />
            </div>

            {terminalModalTabId && terminalModalPanelId ? (
              <TerminalSessionModal
                open
                onOpenChange={open => {
                  if (!open) closeTerminalModal()
                }}
                title={(() => {
                  void terminalModalTitleTick
                  void editorChromeTick
                  const rootUri = terminalCwdForTab(terminalModalTabId)
                  const project = workspace.folders.find(f => f.root.uri === rootUri)?.root.name
                  if (sessionMode === "editor") {
                    const fileLabel = editorActiveTabId
                      ? workspace.fileForUri(editorActiveTabId)?.name ?? tabStore.title(editorActiveTabId)
                      : "Editor"
                    return project ? `${project} / ${fileLabel}` : fileLabel
                  }
                  if (sessionMode === "agent") {
                    const agentName = agentCatalog?.agents.find(
                      agent => agent.id === activeAgentThread?.agentId,
                    )?.displayName ?? "Agent"
                    return project ? `${project} / ${agentName}` : agentName
                  }
                  if (sessionMode === "git") return project ? `${project} / Git` : "Git"
                  if (sessionMode === "todos") return project ? `${project} / TODOs` : "TODOs"
                  const label = workspace.tabRegistry.get(terminalModalTabId)?.label ?? "Terminal"
                  return project ? `${project} / ${label}` : label
                })()}
                gitBranch={terminalModalGitBranch}
                projectRootUri={terminalCwdForTab(terminalModalTabId) || null}
                mode={sessionMode}
                onModeChange={setSessionMode}
                onOpenInApp={(rootUri, appId) => void openProjectInApp(rootUri, appId)}
                agent={
                  agentLoading && !activeAgentThread ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Loading agent…
                    </div>
                  ) : (
                    <Suspense
                      fallback={
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                          Loading conversation…
                        </div>
                      }
                    >
                      <AgentChatView
                        thread={activeAgentThread}
                        agents={agentCatalog}
                        theme={colorScheme}
                        onSend={async payload => {
                          if (!activeAgentThread) return
                          const next = await window.gharargah?.agents?.sendMessage({
                            workspaceRootUri: activeAgentThread.workspaceRootUri,
                            workspaceRootPath: activeAgentThread.workspaceRootPath,
                            threadId: activeAgentThread.id,
                            text: payload.text,
                            agentId: payload.agentId,
                            driverId: payload.driverId,
                            model: payload.model,
                          })
                          if (next) setActiveAgentThread(next)
                        }}
                        onInterrupt={() => {
                          if (!activeAgentThread) return
                          void window.gharargah?.agents?.interruptTurn({
                            workspaceRootUri: activeAgentThread.workspaceRootUri,
                            workspaceRootPath: activeAgentThread.workspaceRootPath,
                            threadId: activeAgentThread.id,
                          })
                        }}
                        onSelectionChange={(agentId, model) => {
                          if (!activeAgentThread) return
                          const driverId = agentCatalog?.agents.find(
                            agent => agent.id === agentId,
                          )?.activeDriverId ?? defaultAgentDriverId(agentId)
                          void window.gharargah?.agents?.updateThreadSettings({
                            workspaceRootUri: activeAgentThread.workspaceRootUri,
                            workspaceRootPath: activeAgentThread.workspaceRootPath,
                            threadId: activeAgentThread.id,
                            agentId,
                            driverId,
                            model,
                          })
                        }}
                        onAgentsRefresh={() => void loadAgentCatalog(true)}
                      />
                    </Suspense>
                  )
                }
                editor={
                  <ModalEditorPane
                    buffers={editorBuffers}
                    activeTabId={editorActiveTabId}
                    workspace={workspace}
                    lspStatus={lspStatus}
                    onActivateBuffer={tabId => {
                      if (!editorPanelId) return
                      handlePanelEvent({ type: "tabActivate", panelId: editorPanelId, tabId })
                    }}
                    onCloseBuffer={tabId => {
                      void (async () => {
                        if (!(await confirmCloseBuffer(workspace, tabId))) return
                        const panel = editorPanelRef.current
                        if (!panel) return
                        workspace.clearDirtyState(tabId)
                        destroyEditorBuffer(panel, tabId)
                        workspace.closeBuffer(tabId)
                        workspace.disposeTab(tabId)
                        const tree = cloneTree()
                        workspace.popPanelBuffer(tree, panel, tabId)
                        closePanelIfEmpty(tree, panel)
                        commitTree(tree)
                      })()
                    }}
                    onQuickOpen={() => void executeCommand("workspace.quickOpen")}
                    onCommandPalette={() => void executeCommand("ui.showCommandPalette")}
                  >
                    {editorPanelId && modalEditorView ? (
                      <PanelBody
                        panelId={editorPanelId}
                        view={modalEditorView}
                        store={tabStore}
                        registry={tabTypeRegistry}
                        focused={sessionMode === "editor"}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        Open a file to start editing
                      </div>
                    )}
                  </ModalEditorPane>
                }
                terminal={
                  <PanelBody
                    panelId={terminalModalPanelId}
                    view={{
                      kind: "tabs",
                      activeTabId: terminalModalTabId,
                      tabIds: [terminalModalTabId],
                    } as PanelView}
                    store={tabStore}
                    registry={tabTypeRegistry}
                    focused={sessionMode === "terminal"}
                  />
                }
                git={
                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        Loading Git…
                      </div>
                    }
                  >
                    <GitWorkspace
                      rootUri={terminalCwdForTab(terminalModalTabId) || null}
                      repositoryName={
                        workspace.folders.find(
                          folder => folder.root.uri === terminalCwdForTab(terminalModalTabId),
                        )?.root.name ?? "Repository"
                      }
                      onBranchChange={setTerminalModalGitBranch}
                      onOpenFile={relativePath => {
                        const rootUri = terminalCwdForTab(terminalModalTabId)
                        if (!rootUri) return
                        const rootPath = fileUriToPath(rootUri).replace(/[/\\]+$/, "")
                        const fullPath = `${rootPath}/${relativePath.replace(/^[/\\]+/, "")}`
                        openFileInEditor(pathToFileUri(fullPath), fullPath)
                      }}
                    />
                  </Suspense>
                }
                todos={(() => {
                  const rootUri = terminalCwdForTab(terminalModalTabId)
                  const folder = workspace.folders.find(f => f.root.uri === rootUri)
                  const projectId = folder?.root.path ?? rootUri ?? ""
                  const projectName = folder?.root.name ?? "Project"
                  return (
                    <ProjectTodosPane projectId={projectId} projectName={projectName} />
                  )
                })()}
              />
            ) : null}
            {editorPanelId ? <FindReplacePopover panelId={editorPanelId} /> : null}
          </div>

          <Suspense fallback={null}>
            {showOverlayHost && <OverlayHost />}
          </Suspense>
          <ConfirmDialogHost />
          <Toaster position="bottom-right" />
        </AppShell>
      </TooltipProvider>
    </OverlayControllerProvider>
  )
}
