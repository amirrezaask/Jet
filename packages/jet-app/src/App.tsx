import {
  Suspense,
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  startTransition,
  useDeferredValue,
} from "react"
import type { AgentProvidersState, AgentThread, AgentWorkspaceSnapshot } from "@jet/agents"
import type { PanelEvent } from "@jet/panels"
import type { PanelId, PanelView, DropAction } from "@jet/shared"
import { pathToFileUri, isUntitledUri, fileUriToPath, Emitter } from "@jet/shared"
import {
  WorkspaceService,
  WorkspaceManager,
  CommandRegistry,
  KeymapService,
  keyEventMatchesBinding,
  isChordBinding,
  resolveKeydownBinding,
  createChordState,
  anyOverlayOpen,
  createDefaultKeybindings,
  isEditorKeyBinding,
  bind,
  parseBindingKey,
  CHORD_TIMEOUT_MS,
  type KeymapContext,
  type JetCommandContext,
  type JetKeyBinding,
  type LaunchConfig,
  type ListItem,
  ProjectRegistry,
  JetPanelTree,
  type JetProject,
  type WorkspaceFolder,
  activatePanelTab,
  reorderPanelTab,
  popPanelTab,
  PROBLEMS_TAB_ID,
  panelTabIds,
  isTerminalTabId,
  fileSearchAcrossFolders,
  relativePathInFolder,
  resolveQuickOpenDisplayPath,
} from "@jet/workspace"
import { LanguageServerManager, LspClientPool } from "@jet/lsp"
import type { LSPClient } from "@jet/codemirror"
import { createAgentBridge, openWorkspaceFromQuery, resolveDevWorkspacePath } from "@jet/browser"
import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import {
  applyColorScheme,
  jumpToLine,
  collectProblemsFromViews,
  problemsFingerprint,
  setPendingEditorNavigation,
  setPendingInitialContent,
  type ColorScheme,
} from "@jet/codemirror"
import {
  TabStore,
  TabTypeRegistry,
  PanelDock,
  PanelBody,
  PanelTabBar,
  StatusBar,
  themeForScheme,
  syncNativeChromeFromTheme,
  getEditorView,
  getAllEditorViews,
  syncAllEditorThemes,
  destroyEditorBuffer,
  setEditorCursor,
  getEditorCursor,
  formatKeyBinding,
  problemsToListItems,
  WhichKeyPanel,
  type AgentExplorerWorkspaceGroup,
  type TerminalExplorerGroup,
  type OutlineEntry,
  type WhichKeyEntry,
  TooltipProvider,
  ConfirmDialogHost,
  Toaster,
  showJetToast,
  requestConfirm,
  AppShell,
  SidebarProvider,
  SidebarInset,
  JetWorkspaceSidebar,
  type JetSidebarView,
  focusExplorerPanel,
  focusTerminalExplorerPanel,
  getListPanel,
  JetTitleBar,
  type JetTitleBarMenu,
  WelcomeView,
  FindReplacePopover,
  animateLayoutMorph,
  capturePanelLeafRects,
  type PanelRect,
} from "@jet/ui"
import { getJetSearchState } from "@jet/codemirror"
import type { JetProblem } from "@jet/shared"
import { APP_COMMAND_REGISTRY, buildAppCommands } from "./app-commands.js"
import { registerBuiltinTabTypes } from "./tabs/index.js"
import { agentChatTabId, parseAgentChatTabId, type AgentChatTabState } from "./tabs/agent-chat.tab.js"
import { AGENT_EXPLORER_TAB_ID } from "./tabs/agent-explorer.tab.js"
import { terminalCwdForTab } from "./tabs/terminal-session.js"
import {
  panelViewKind,
  getAllLeafPanels,
  resolveEditorPanel,
  getActiveEditorFileUri,
  getActiveListTabId,
  activeTabKind,
  getActiveTabId,
  closePanelIfEmpty,
  reconcileFocusedPanel,
} from "./panel-routing.js"
import { openAgentChatTab, openAgentExplorerTab, openTerminalTab } from "./tab-routing.js"
import { stripSidebarTabsFromTree } from "./sidebar-tree.js"
import { buildTerminalExplorerGroups, nextTerminalLabel } from "./terminal-explorer.js"
import {
  isContextualTabKind,
  resolveContextWorkspaceFolder,
  resolveFolderForActiveTab,
} from "./resolve-tab-workspace.js"
import { loadWorkspaceInit, type JetInitContext } from "./load-workspace-init.js"
import { loadGlobalJetrc } from "./load-global-jetrc.js"
import { bootstrapFromLaunch } from "./launch-bootstrap.js"
import { useFileDrop } from "./use-file-drop.js"

const COLOR_SCHEME_KEY = "jet-color-scheme"
const COMMAND_RECENTS_STORAGE_KEY = "jet-command-recents"
const FONT_SIZE_STORAGE_KEY = "jet-font-size"
const DEFAULT_FONT_SIZE = 13
const FONT_SIZE_STEP = 2
const OverlayHost = lazy(() => import("./OverlayHost.js"))

type OpenWorkspaceOptions = { replace?: boolean; silent?: boolean }

function loadStoredFontSize(): number {
  try {
    const raw = localStorage.getItem(FONT_SIZE_STORAGE_KEY)
    if (!raw) return DEFAULT_FONT_SIZE
    const n = parseFloat(raw)
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_FONT_SIZE
    return n
  } catch {
    return DEFAULT_FONT_SIZE
  }
}

function applyRootFontSize(px: number): void {
  document.documentElement.style.fontSize = `${px}px`
}

const isWebMode = Boolean(import.meta.env.VITE_JET_WEB)
const hasWorkspaceQuery =
  isWebMode && new URLSearchParams(window.location.search).has("workspace")

const SIDEBAR_VIEW_STORAGE_KEY = "jet-sidebar-view"

function loadSidebarView(): JetSidebarView {
  if (typeof localStorage === "undefined") return "explorer"
  const stored = localStorage.getItem(SIDEBAR_VIEW_STORAGE_KEY)
  return stored === "terminal-explorer" ? "terminal-explorer" : "explorer"
}

function initialEditorLayout() {
  return JetPanelTree.editorOnlyLayout()
}

function loadStoredColorScheme(): ColorScheme {
  try {
    const raw = localStorage.getItem(COLOR_SCHEME_KEY)
    if (raw === "light" || raw === "dark") return raw
    const legacy = localStorage.getItem("jet-theme-id")
    if (legacy?.includes("light")) return "light"
  } catch {
    /* ignore */
  }
  return "dark"
}

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

function jetPlatformFS(): import("@jet/workspace").FileSystemProvider {
  const fs = window.jet!.fs
  return {
    readFile: uri => fs.readFile(uri),
    writeFile: (uri, content) => fs.writeFile(uri, content),
    readDir: uri => fs.readDir(uri),
    stat: uri => fs.stat(uri),
  }
}

export function JetApp() {
  const initialLayout = useMemo(() => initialEditorLayout(), [])
  const [panelTree, setPanelTree] = useState(() => initialLayout.tree)
  const [focusedPanel, setFocusedPanel] = useState<PanelId | null>(() => initialLayout.editorPanel)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [lspRevision, setLspRevision] = useState(0)
  const [userExtensions, setUserExtensions] = useState<Extension[]>([])
  const [keymapRevision, setKeymapRevision] = useState(0)
  const [editorFocused, setEditorFocused] = useState(false)
  const [layoutReady, setLayoutReady] = useState(false)
  const [colorScheme, setColorScheme] = useState<ColorScheme>(() => loadStoredColorScheme())
  const activeTheme = useMemo(() => themeForScheme(colorScheme), [colorScheme])
  const [gotoLineOpen, setGotoLineOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [outlineSymbols, setOutlineSymbols] = useState<OutlineEntry[]>([])
  const [quickOpenOpen, setQuickOpenOpen] = useState(false)
  const [bufferListOpen, setBufferListOpen] = useState(false)
  const [openFileOpen, setOpenFileOpen] = useState(false)
  const [cdOpen, setCdOpen] = useState(false)
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false)
  const [switchFolderOpen, setSwitchFolderOpen] = useState(false)
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const folderPickerPendingRef = useRef<{
    resolve: (folder: WorkspaceFolder | null) => void
  } | null>(null)
  const [projects, setProjects] = useState<JetProject[]>([])
  const [agentSnapshots, setAgentSnapshots] = useState<Record<string, AgentWorkspaceSnapshot | null>>({})
  const [agentThreads, setAgentThreads] = useState<Record<string, AgentThread | null>>({})
  const [agentProviders, setAgentProviders] = useState<AgentProvidersState | null>(null)
  const folderSearchStateRef = useRef(
    new Map<string, { supported: boolean; scanReady: boolean }>(),
  )
  const lastContextFolderRef = useRef<WorkspaceFolder | null>(null)
  const [folderSearchRev, setFolderSearchRev] = useState(0)
  const [problems, setProblems] = useState<JetProblem[]>([])
  const [panelRev, setPanelRev] = useState(0)
  const [lspCrashed, setLspCrashed] = useState(false)
  const [fileDragOver, setFileDragOver] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarView, setSidebarView] = useState<JetSidebarView>(loadSidebarView)
  const [sidebarFocused, setSidebarFocused] = useState(false)
  const sidebarViewRef = useRef<JetSidebarView>(sidebarView)
  sidebarViewRef.current = sidebarView
  const [recentCommands, setRecentCommands] = useState<string[]>(() => loadRecentCommands())
  const [pendingChordPrefix, setPendingChordPrefix] = useState<string | null>(null)
  const fontSizeRef = useRef(loadStoredFontSize())
  const initialized = useRef(false)
  const queryBootstrapDone = useRef(false)
  const openWorkspaceRef = useRef<(folderPath: string, opts?: OpenWorkspaceOptions) => void | Promise<void>>(
    () => {},
  )
  const addWorkspaceRef = useRef<(folderPath: string) => void>(() => {})
  const handleOpenFileRef = useRef<(uri: string, path: string) => void>(() => {})
  const editorPanelRef = useRef<PanelId | null>(initialLayout.editorPanel)
  const workspaceInitGen = useRef(new Map<string, number>())
  const workspaceRootPathRef = useRef<string | null>(null)
  const homeDirRef = useRef("")
  const workspaceInitCtxRef = useRef<JetInitContext | null>(null)
  const projectRegistry = useMemo(() => new ProjectRegistry(), [])
  const appStateRef = useRef({
    panelTree,
    focusedPanel,
    keymapContext: undefined as KeymapContext | undefined,
    activePanelKind: undefined as string | undefined,
  })

  const workspaceManager = useMemo(() => new WorkspaceManager(jetPlatformFS()), [])
  const workspace = useMemo(() => new WorkspaceService(workspaceManager), [workspaceManager])
  const commands = useMemo(() => new CommandRegistry(), [])
  const keymaps = useMemo(() => new KeymapService(), [])
  const tabTypeRegistry = useMemo(() => new TabTypeRegistry(), [])
  const tabStore = useMemo(() => new TabStore(tabTypeRegistry), [tabTypeRegistry])

  const keymapBindings = useMemo(() => keymaps.allBindings(), [keymaps, keymapRevision])

  useEffect(() => {
    const sub = keymaps.onDidChange.event(() => setKeymapRevision(r => r + 1))
    return () => sub.dispose()
  }, [keymaps])

  // Keep tabStore in sync with workspace.tabRegistry: mirror label + typeId so
  // TabTypeRegistry.render() and PanelTabBar can look up title/dirty per tab id
  // without knowing tab-kind semantics.
  useEffect(() => {
    const mirror = (id: string) => {
      const desc = workspace.tabRegistry.get(id)
      if (!desc) {
        tabStore.dispose(id)
        return
      }
      const kind = desc.kind
      if (kind === "editor") {
        tabStore.create<{ fileUri: string }>(kind, { fileUri: desc.id }, desc.id)
      } else if (kind === "explorer" || kind === "output" || kind === "agent-explorer" || kind === "terminal-explorer") {
        tabStore.create<Record<string, never>>(kind, {}, desc.id)
      } else if (kind === "agent-chat") {
        const parsed = parseAgentChatTabId(desc.id)
        if (!parsed) {
          tabStore.dispose(desc.id)
          return
        }
        const existing = tabStore.get(desc.id) as { state?: AgentChatTabState } | undefined
        const prevState = existing?.state
        tabStore.create<AgentChatTabState>(
          kind,
          prevState
            ? {
                ...prevState,
                rootUri: parsed.rootUri,
                threadId: parsed.threadId,
              }
            : parsed,
          desc.id,
        )
      } else if (kind === "terminal") {
        tabStore.create<{ label: string; cwdRootUri: string }>(
          kind,
          { label: desc.label, cwdRootUri: terminalCwdForTab(desc.id) || workspace.root?.uri || "" },
          desc.id,
        )
      } else {
        tabStore.create<{ listId: string }>(kind, { listId: desc.id }, desc.id)
      }
    }
    const sub = workspace.tabRegistry.onDidChange.event(evt => mirror(evt.id))
    return () => sub.dispose()
  }, [workspace, tabStore])

  // Dirty flips are per-keystroke. Do NOT put them in React state: PanelTabBar
  // subscribes to tabStore directly; problems are refreshed via a RAF-guarded
  // ref. Keeping dirty out of state prevents palette/appCommands invalidation.
  useEffect(() => {
    const sub = workspace.onDidChangeDirty.event(() => {
      refreshProblemsRef.current()
    })
    return () => sub.dispose()
  }, [workspace])

  const activeThemeRef = useRef(activeTheme)
  activeThemeRef.current = activeTheme
  const lspRevisionRef = useRef(lspRevision)
  lspRevisionRef.current = lspRevision
  const keymapBindingsRef = useRef<JetKeyBinding[]>([])
  const userExtensionsRef = useRef<Extension[]>([])
  const keymapRevisionRef = useRef(0)
  const keymapContextRef = useRef<KeymapContext | undefined>(undefined)
  const agentSnapshotsRef = useRef<Record<string, AgentWorkspaceSnapshot | null>>({})
  const agentThreadsRef = useRef<Record<string, AgentThread | null>>({})
  const agentThreadEmittersRef = useRef(new Map<string, Emitter<AgentThread | null>>())
  const agentProvidersRef = useRef<AgentProvidersState | null>(null)
  const sendAgentInFlightRef = useRef(false)
  const openAgentThreadRef = useRef<(rootUri: string, threadId: string) => Promise<void>>(
    () => Promise.resolve(),
  )
  const createAgentThreadRef = useRef<(rootUri: string, rootPath: string) => Promise<void>>(
    () => Promise.resolve(),
  )
  const sendAgentMessageRef = useRef<
    (
      rootUri: string,
      threadId: string,
      payload: { text: string; provider: string | null; model: string | null },
    ) => Promise<void>
  >(() => Promise.resolve())
  const updateAgentThreadSettingsRef = useRef<
    (
      rootUri: string,
      threadId: string,
      settings: { provider?: string | null; model?: string | null },
    ) => Promise<void>
  >(() => Promise.resolve())
  const refreshAgentProvidersRef = useRef<() => Promise<AgentProvidersState | null>>(
    () => Promise.resolve(null),
  )
  const archiveAgentThreadRef = useRef<
    (rootUri: string, rootPath: string, threadId: string) => Promise<void>
  >(() => Promise.resolve())
  const getTerminalExplorerGroupsRef = useRef<() => TerminalExplorerGroup[]>(() => [])
  const getActiveTerminalTabIdRef = useRef<() => string | null>(() => null)
  const focusTerminalTabRef = useRef<(panelId: PanelId, tabId: string) => void>(() => {})
  const newTerminalInWorkspaceRef = useRef<(rootUri: string) => Promise<void>>(async () => {})
  const closeTerminalTabRef = useRef<(panelId: PanelId, tabId: string) => void>(() => {})
  const onTerminalTitleChangeRef = useRef<(tabId: string, title: string) => void>(() => {})
  const unarchiveAgentThreadRef = useRef<
    (rootUri: string, rootPath: string, threadId: string) => Promise<void>
  >(() => Promise.resolve())
  const interruptAgentTurnRef = useRef<
    (rootUri: string, threadId: string) => Promise<void>
  >(() => Promise.resolve())
  const archiveActiveAgentThreadRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const unarchiveActiveAgentThreadRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const handleOpenFileForTabs = useRef<(uri: string, path: string) => void>(() => {})
  const openListItemForTabs = useRef<(item: ListItem) => void>(() => {})
  const setEditorFocusedRef = useRef<(f: boolean) => void>(() => {})
  const setEditorSelectionRef = useRef<(l: number, c: number, r: number) => void>(() => {})
  const handleLspAttachFailedRef = useRef<(uri: string) => void>(() => {})
  const refreshProblemsRef = useRef<() => void>(() => {})
  const executeCommandRef = useRef<(name: string) => Promise<void>>(() => Promise.resolve())
  const runKeyBindingRef = useRef<(binding: JetKeyBinding, view?: EditorView) => void>(() => {})
  const resolveLspClientRef = useRef<(fileUri: string) => Promise<LSPClient | null>>(() => Promise.resolve(null))

  keymapBindingsRef.current = keymapBindings
  userExtensionsRef.current = userExtensions
  keymapRevisionRef.current = keymapRevision
  agentSnapshotsRef.current = agentSnapshots
  agentThreadsRef.current = agentThreads
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

  const refreshTerminalExplorerTab = useCallback(() => {
    setPanelRev(r => r + 1)
  }, [])

  const onTerminalTitleChange = useCallback(
    (tabId: string, title: string) => {
      const existing = workspace.tabRegistry.get(tabId)
      if (!existing || existing.label === title) return
      workspace.tabRegistry.update(tabId, { label: title })
      refreshTerminalExplorerTab()
    },
    [workspace, refreshTerminalExplorerTab],
  )

  const syncAgentThread = useCallback(
    (thread: AgentThread | null) => {
      if (!thread) return
      const key = agentThreadStateKey(thread.workspaceRootUri, thread.id)
      const nextThreads = { ...agentThreadsRef.current, [key]: thread }
      agentThreadsRef.current = nextThreads
      setAgentThreads(nextThreads)
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
      setAgentSnapshots(nextSnapshots)
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
        setAgentSnapshots(nextSnapshots)
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
          setAgentThreads(nextThreads)
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

  const getAgentExplorerGroups = useCallback((): AgentExplorerWorkspaceGroup[] => {
    return workspace.folders.map(folder => {
      const snapshot = agentSnapshotsRef.current[folder.root.uri]
      const activeThreads = snapshot?.threads.filter(thread => thread.archivedAt == null) ?? []
      const archivedThreads = snapshot?.threads.filter(thread => thread.archivedAt != null) ?? []
      return {
        id: folder.id,
        name: folder.root.name,
        path: folder.root.path,
        rootUri: folder.root.uri,
        snapshot: snapshot
          ? {
              ...snapshot,
              threads: activeThreads,
            }
          : null,
        archivedThreads,
      }
    })
  }, [workspace])

  const resolveContextFolder = useCallback((): WorkspaceFolder | null => {
    return resolveContextWorkspaceFolder(
      panelTree,
      focusedPanel,
      workspace.tabRegistry,
      workspace,
      lastContextFolderRef.current,
    )
  }, [panelTree, focusedPanel, workspace, panelRev])

  const getContextSearchState = useCallback(() => {
    void folderSearchRev
    const folder = resolveContextFolder()
    if (!folder) return { supported: false, scanReady: false }
    const state = folderSearchStateRef.current.get(folder.id)
    return { supported: state?.supported ?? false, scanReady: state?.scanReady ?? false }
  }, [resolveContextFolder, folderSearchRev])

  useEffect(() => {
    const folder = resolveFolderForActiveTab(
      panelTree,
      focusedPanel,
      workspace.tabRegistry,
      workspace,
    )
    const kind = activeTabKind(panelTree, focusedPanel, workspace.tabRegistry)
    if (folder && isContextualTabKind(kind)) {
      lastContextFolderRef.current = folder
    }
  }, [panelTree, focusedPanel, workspace, panelRev])

  useEffect(() => {
    registerBuiltinTabTypes(tabTypeRegistry, {
      workspace,
      getTheme: () => activeThemeRef.current,
      resolveLspClient: uri => resolveLspClientRef.current(uri),
      getLspRevision: () => lspRevisionRef.current,
      executeCommand: name => executeCommandRef.current(name),
      runKeyBinding: (binding, view) => runKeyBindingRef.current(binding, view),
      getKeymapBindings: () => keymapBindingsRef.current,
      getUserExtensions: () => userExtensionsRef.current,
      getKeymapRevision: () => keymapRevisionRef.current,
      getKeymapContext: () => keymapContextRef.current,
      onEditorFocusChange: f => setEditorFocusedRef.current(f),
      onEditorSelectionChange: (l, c, r) => setEditorSelectionRef.current(l, c, r),
      onLspAttachFailed: uri => handleLspAttachFailedRef.current(uri),
      onProblemsChange: () => refreshProblemsRef.current(),
      onOpenFile: (uri, path) => handleOpenFileForTabs.current(uri, path),
      onOpenListItem: item => openListItemForTabs.current(item),
      getAgentExplorerGroups,
      getAgentSnapshot,
      getAgentThread,
      subscribeAgentThread,
      getAgentProviders,
      refreshAgentProviders: () => refreshAgentProvidersRef.current(),
      updateAgentThreadSettings: (rootUri, threadId, settings) =>
        updateAgentThreadSettingsRef.current(rootUri, threadId, settings),
      openAgentThread: (rootUri, threadId) => openAgentThreadRef.current(rootUri, threadId),
      createAgentThread: (rootUri, rootPath) =>
        createAgentThreadRef.current(rootUri, rootPath),
      sendAgentMessage: (rootUri, threadId, payload) =>
        sendAgentMessageRef.current(rootUri, threadId, payload),
      interruptAgentTurn: (rootUri, threadId) =>
        interruptAgentTurnRef.current(rootUri, threadId),
      archiveAgentThread: (rootUri, rootPath, threadId) =>
        archiveAgentThreadRef.current(rootUri, rootPath, threadId),
      unarchiveAgentThread: (rootUri, rootPath, threadId) =>
        unarchiveAgentThreadRef.current(rootUri, rootPath, threadId),
      getTerminalExplorerGroups: () => getTerminalExplorerGroupsRef.current(),
      getActiveTerminalTabId: () => getActiveTerminalTabIdRef.current(),
      focusTerminalTab: (panelId, tabId) => focusTerminalTabRef.current(panelId, tabId),
      newTerminalInWorkspace: rootUri => newTerminalInWorkspaceRef.current(rootUri),
      closeTerminalTab: (panelId, tabId) => closeTerminalTabRef.current(panelId, tabId),
      onTerminalTitleChange: (tabId, title) => onTerminalTitleChangeRef.current(tabId, title),
      getSearchFolders: () => {
        const folder = resolveContextFolder()
        return folder ? [folder] : workspace.folders
      },
    })
  }, [
    tabTypeRegistry,
    workspace,
    getAgentExplorerGroups,
    getAgentSnapshot,
    getAgentThread,
    subscribeAgentThread,
    getAgentProviders,
    resolveContextFolder,
  ])

  const keybindingByFn = useMemo(() => {
    const map = new Map<JetKeyBinding["run"], string>()
    for (const binding of keymapBindings) {
      if (!map.has(binding.run)) map.set(binding.run, binding.key)
    }
    return map
  }, [keymapBindings])

  const fnByCommandId = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of APP_COMMAND_REGISTRY) {
      map.set(entry.id, entry.fn)
    }
    return map
  }, [])

  const activePanelKind = useMemo(
    () => (focusedPanel ? panelViewKind(panelTree, focusedPanel) : undefined),
    [focusedPanel, panelTree],
  )

  const activeTabKindName = useMemo(
    () => activeTabKind(panelTree, focusedPanel, workspace.tabRegistry),
    [focusedPanel, panelTree, workspace, panelRev],
  )

  const activeEditorFile = useMemo(() => {
    if (!focusedPanel) return null
    const uri = getActiveEditorFileUri(panelTree, focusedPanel)
    if (!uri) return null
    const file = workspace.fileForUri(uri)
    if (!file) return null
    return { name: file.name, languageId: file.languageId, isDirty: file.isDirty }
  }, [focusedPanel, panelTree, workspace, panelRev])

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        setSidebarFocused(false)
        return
      }
      const sidebar = document.querySelector("[data-jet-workspace-sidebar]")
      setSidebarFocused(Boolean(sidebar?.contains(target)))
    }
    document.addEventListener("focusin", onFocusIn)
    return () => document.removeEventListener("focusin", onFocusIn)
  }, [])

  const keymapContext = useMemo(
    () => ({
      editorFocus: editorFocused,
      paletteOpen,
      quickOpenOpen,
      bufferListOpen,
      openFileOpen,
      cdOpen,
      projectSwitcherOpen,
      gotoLineOpen,
      outlineOpen,
      workspaceOpen: workspace.manager.hasFolders(),
      explorerFocus: sidebarFocused && sidebarView === "explorer",
      terminalExplorerFocus: sidebarFocused && sidebarView === "terminal-explorer",
      outputFocus: activeTabKindName === "output",
      terminalFocus: activeTabKindName === "terminal",
      agentChatFocus: activeTabKindName === "agent-chat",
      listFocus:
        (sidebarFocused &&
          (sidebarView === "explorer" || sidebarView === "terminal-explorer")) ||
        activeTabKindName === "agent-explorer" ||
        activeTabKindName === "search" ||
        activeTabKindName === "problems" ||
        activeTabKindName === "references" ||
        activeTabKindName === "definitions" ||
        activeTabKindName === "task-errors",
    }),
    [
      editorFocused,
      paletteOpen,
      quickOpenOpen,
      bufferListOpen,
      openFileOpen,
      cdOpen,
      projectSwitcherOpen,
      gotoLineOpen,
      outlineOpen,
      workspace.root,
      activePanelKind,
      activeTabKindName,
      sidebarFocused,
      sidebarView,
    ],
  )

  appStateRef.current = {
    panelTree,
    focusedPanel,
    keymapContext,
    activePanelKind,
  }

  const lspManager = useMemo(
    () => (window.jet ? new LanguageServerManager(window.jet.lsp) : null),
    [],
  )

  const lspClientPool = useMemo(() => new LspClientPool(), [])

  const bumpLspRevision = useCallback(() => setLspRevision(r => r + 1), [])

  const resolveLspClient = useCallback(
    async (fileUri: string) => {
      if (!lspManager) return null
      const rootUri = workspace.resolveRootUriForFile(fileUri)
      if (!rootUri) return null
      const path = isUntitledUri(fileUri) ? "" : fileUriToPath(fileUri)
      const file = workspace.fileForUri(fileUri) ?? workspace.createWorkspaceFile(fileUri, path)
      const conn = await lspManager.ensureServerForFile(file, rootUri)
      if (!conn) return null
      return lspClientPool.getOrCreateClient(conn)
    },
    [lspManager, workspace, lspClientPool],
  )

  const cloneTree = useCallback(
    () => appStateRef.current.panelTree.clone(),
    [],
  )

  const commitTree = useCallback(
    (
      tree: JetPanelTree,
      preferFocus?: PanelId | null,
      morph?: { animate?: boolean; beforeRects?: Map<number, PanelRect>; spawnFrom?: Map<number, PanelRect> },
    ) => {
      stripSidebarTabsFromTree(tree)
      const beforeRects =
        morph?.animate ? (morph.beforeRects ?? capturePanelLeafRects()) : null
      const prevFocused = appStateRef.current.focusedPanel
      const preferred =
        preferFocus && getAllLeafPanels(tree).some(l => l.id === preferFocus.id)
          ? preferFocus
          : null
      const nextFocused =
        preferred ?? reconcileFocusedPanel(tree, prevFocused, editorPanelRef.current)
      setPanelTree(tree)
      setPanelRev(r => r + 1)
      setFocusedPanel(nextFocused)
      if (beforeRects) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            void animateLayoutMorph(beforeRects, { spawnFrom: morph?.spawnFrom })
          })
        })
      }
      if (nextFocused && nextFocused.id !== prevFocused?.id) {
        requestAnimationFrame(() => {
          if (getJetSearchState()?.open) return
          getEditorView(nextFocused)?.focus()
        })
      }
    },
    [],
  )

  const ensureLspForFile = useCallback(
    async (fileUri: string) => {
      if (!lspManager || isUntitledUri(fileUri)) return
      const rootUri = workspace.resolveRootUriForFile(fileUri)
      if (!rootUri) return
      const path = fileUriToPath(fileUri)
      const file = workspace.fileForUri(fileUri) ?? workspace.createWorkspaceFile(fileUri, path)
      const conn = await lspManager.ensureServerForFile(file, rootUri)
      if (!conn) {
        const spawnErr = lspManager.consumeLastSpawnError()
        if (spawnErr && lspManager.isLanguageSupported(file.languageId)) {
          showJetToast(
            `Language server unavailable for ${file.name} — is ${file.languageId === "rust" ? "rust-analyzer" : "typescript-language-server"} on PATH?`,
          )
        }
      }
    },
    [lspManager, workspace],
  )

  useEffect(() => {
    applyColorScheme(colorScheme, activeTheme)
    syncAllEditorThemes(activeTheme)
    syncNativeChromeFromTheme()
  }, [colorScheme, activeTheme])

  useEffect(() => {
    applyRootFontSize(fontSizeRef.current)
  }, [])

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
    if (!window.jet?.fs.onFileChanged) return
    return window.jet.fs.onFileChanged(uri => {
      void workspace.handleExternalFileChange(uri)
    })
  }, [workspace])

  useEffect(() => {
    if (window.jet?.tasks) {
      workspace.taskRunner.setHandlers({
        spawn: req => window.jet!.tasks!.spawn(req),
      })
    }
  }, [workspace])

  const pushJumpFromActiveEditor = useCallback(
    (label?: string) => {
      const panel = appStateRef.current.focusedPanel
      const tree = appStateRef.current.panelTree
      const fileUri = panel && getActiveEditorFileUri(tree, panel)
      if (!fileUri || !panel) return
      const view = getEditorView(panel)
      if (!view) return
      const pos = view.state.selection.main.head
      const line = view.state.doc.lineAt(pos)
      workspace.jumpStack.push({
        fileUri,
        line: line.number,
        column: pos - line.from + 1,
        panelId: panel,
        label,
      })
    },
    [workspace],
  )

  const openFileInEditor = useCallback(
    (uri: string, path: string, line?: number, column?: number, pushJump = true) => {
      if (pushJump) pushJumpFromActiveEditor("navigation")
      const tree = cloneTree()
      const existing = tree.findEditorPanelForFile(uri)
      const panel =
        existing ?? resolveEditorPanel(tree, editorPanelRef.current, focusedPanel)
      if (!panel) return
      editorPanelRef.current = panel
      workspace.assignEditorPanel(tree, panel, uri, path)
      if (line != null) setPendingEditorNavigation(panel, line, column ?? 1)
      setFocusedPanel(panel)
      commitTree(tree)
      if (line != null) {
        requestAnimationFrame(() => {
          const view = getEditorView(panel)
          if (view) jumpToLine(view, line, column ?? 1)
        })
      }
      void ensureLspForFile(uri)
    },
    [workspace, focusedPanel, cloneTree, commitTree, pushJumpFromActiveEditor, ensureLspForFile],
  )

  const handleOpenFile = useCallback(
    (uri: string, path: string, line?: number, column?: number) => {
      openFileInEditor(uri, path, line, column, true)
    },
    [openFileInEditor],
  )

  const handleOpenFileAt = useCallback(
    (uri: string, path: string, line: number, column: number) => {
      handleOpenFile(uri, path, line, column)
    },
    [handleOpenFile],
  )

  const openAgentThread = useCallback(
    async (rootUri: string, threadId: string): Promise<void> => {
      const folder = findWorkspaceFolderByRootUri(rootUri)
      if (!folder) return
      const snapshot = agentSnapshotsRef.current[rootUri]
      const existingThread = agentThreadsRef.current[agentThreadStateKey(rootUri, threadId)]
      const title =
        existingThread?.title ??
        snapshot?.threads.find(thread => thread.id === threadId)?.title ??
        "Agent"
      const tree = cloneTree()
      const { panelId } = openAgentChatTab(
        workspace,
        tree,
        appStateRef.current.focusedPanel,
        rootUri,
        threadId,
        title,
      )
      commitTree(tree, panelId)
      if (!existingThread) {
        await loadAgentThread(rootUri, folder.root.path, threadId)
      } else {
        const chatTabId = agentChatTabId(rootUri, threadId)
        tabStore.update(chatTabId, prev => {
          const state = prev as AgentChatTabState
          return {
            ...state,
            rev: existingThread.updatedAt,
            thread: existingThread,
          }
        })
      }
    },
    [workspace, findWorkspaceFolderByRootUri, cloneTree, commitTree, loadAgentThread, tabStore],
  )

  const openAgentsExplorer = useCallback(async (): Promise<void> => {
    const tree = cloneTree()
    const { panelId } = openAgentExplorerTab(workspace, tree, appStateRef.current.focusedPanel)
    commitTree(tree, panelId)
    requestAnimationFrame(() => {
      const list = getListPanel("jet:agent-explorer")
      const first = list?.querySelector<HTMLElement>("[data-jet-list-item]")
      ;(first ?? list)?.focus()
    })
  }, [workspace, cloneTree, commitTree])

  const openTerminalExplorer = useCallback((): void => {
    setSidebarOpen(true)
    setSidebarView("terminal-explorer")
    try {
      localStorage.setItem(SIDEBAR_VIEW_STORAGE_KEY, "terminal-explorer")
    } catch {
      /* ignore */
    }
    requestAnimationFrame(() => focusTerminalExplorerPanel())
  }, [])

  const handleSidebarViewChange = useCallback((view: JetSidebarView) => {
    setSidebarView(view)
    try {
      localStorage.setItem(SIDEBAR_VIEW_STORAGE_KEY, view)
    } catch {
      /* ignore */
    }
  }, [])

  const getTerminalExplorerGroups = useCallback(
    () => buildTerminalExplorerGroups(appStateRef.current.panelTree, workspace),
    [workspace],
  )

  const getActiveTerminalTabId = useCallback((): string | null => {
    const focused = appStateRef.current.focusedPanel
    if (!focused) return null
    const tabId = getActiveTabId(appStateRef.current.panelTree, focused)
    if (!tabId || !isTerminalTabId(tabId)) return null
    return tabId
  }, [])

  const focusTerminalTab = useCallback(
    (panelId: PanelId, tabId: string) => {
      const tree = cloneTree()
      workspace.focusTabInPanel(tree, panelId, tabId)
      setFocusedPanel(panelId)
      commitTree(tree, panelId)
    },
    [workspace, cloneTree, commitTree],
  )

  const newTerminalInWorkspace = useCallback(
    async (rootUri: string) => {
      const tree = cloneTree()
      const label = nextTerminalLabel(tree)
      const { panelId } = openTerminalTab(workspace, tree, appStateRef.current.focusedPanel, {
        cwdRootUri: rootUri,
        label,
      })
      setFocusedPanel(panelId)
      commitTree(tree, panelId)
    },
    [workspace, cloneTree, commitTree],
  )

  const closeTerminalTab = useCallback(
    (panelId: PanelId, tabId: string) => {
      const tree = cloneTree()
      const view = tree.getView(panelId)
      if (view?.kind !== "tabs") return
      workspace.disposeTab(tabId)
      tabStore.dispose(tabId)
      tree.setView(panelId, popPanelTab(view, tabId))
      closePanelIfEmpty(tree, panelId)
      commitTree(tree)
    },
    [cloneTree, commitTree, workspace, tabStore],
  )

  const createAgentThread = useCallback(
    async (rootUri: string, rootPath: string): Promise<void> => {
      const transport = window.jet?.agents
      if (!transport) {
        showJetToast("Agents transport unavailable", { variant: "destructive" })
        return
      }
      const thread = await transport.createThread({
        workspaceRootUri: rootUri,
        workspaceRootPath: rootPath,
      })
      syncAgentThread(thread)
      await openAgentThread(rootUri, thread.id)
    },
    [syncAgentThread, openAgentThread],
  )

  const sendAgentMessage = useCallback(
    async (
      rootUri: string,
      threadId: string,
      payload: { text: string; provider: string | null; model: string | null },
    ): Promise<void> => {
      if (sendAgentInFlightRef.current) return
      const transport = window.jet?.agents
      const folder = findWorkspaceFolderByRootUri(rootUri)
      if (!transport || !folder) {
        showJetToast("Agents transport unavailable", { variant: "destructive" })
        return
      }
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
            if (fresh && fresh.status !== "running") {
              break
            }
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

  const closeAgentChatTabIfOpen = useCallback(
    (rootUri: string, threadId: string) => {
      const tabId = agentChatTabId(rootUri, threadId)
      const tree = cloneTree()
      for (const panel of getAllLeafPanels(tree)) {
        const view = tree.getView(panel)
        if (view?.kind !== "tabs" || !view.tabIds.includes(tabId)) continue
        workspace.disposeTab(tabId)
        tabStore.dispose(tabId)
        tree.setView(panel, popPanelTab(view, tabId))
        closePanelIfEmpty(tree, panel)
        commitTree(tree, panel)
        return
      }
    },
    [cloneTree, commitTree, workspace, tabStore],
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
        if (archived) closeAgentChatTabIfOpen(rootUri, threadId)
      }
    },
    [syncAgentThread, refreshAgentExplorerTab, closeAgentChatTabIfOpen],
  )

  const archiveAgentThread = useCallback(
    async (rootUri: string, rootPath: string, threadId: string): Promise<void> => {
      await setAgentThreadArchived(rootUri, rootPath, threadId, true)
    },
    [setAgentThreadArchived],
  )

  const unarchiveAgentThread = useCallback(
    async (rootUri: string, rootPath: string, threadId: string): Promise<void> => {
      await setAgentThreadArchived(rootUri, rootPath, threadId, false)
    },
    [setAgentThreadArchived],
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

  const archiveActiveAgentThread = useCallback(async (): Promise<void> => {
    const tabId = getActiveTabId(appStateRef.current.panelTree, appStateRef.current.focusedPanel)
    if (!tabId) return
    const parsed = parseAgentChatTabId(tabId)
    if (!parsed) return
    const folder = findWorkspaceFolderByRootUri(parsed.rootUri)
    if (!folder) return
    await setAgentThreadArchived(parsed.rootUri, folder.root.path, parsed.threadId, true)
  }, [findWorkspaceFolderByRootUri, setAgentThreadArchived])

  const unarchiveActiveAgentThread = useCallback(async (): Promise<void> => {
    const tabId = getActiveTabId(appStateRef.current.panelTree, appStateRef.current.focusedPanel)
    if (!tabId) return
    const parsed = parseAgentChatTabId(tabId)
    if (!parsed) return
    const folder = findWorkspaceFolderByRootUri(parsed.rootUri)
    if (!folder) return
    await setAgentThreadArchived(parsed.rootUri, folder.root.path, parsed.threadId, false)
  }, [findWorkspaceFolderByRootUri, setAgentThreadArchived])

  openAgentThreadRef.current = openAgentThread
  createAgentThreadRef.current = createAgentThread
  sendAgentMessageRef.current = sendAgentMessage
  updateAgentThreadSettingsRef.current = updateAgentThreadSettings
  refreshAgentProvidersRef.current = refreshAgentProviders
  archiveAgentThreadRef.current = archiveAgentThread
  unarchiveAgentThreadRef.current = unarchiveAgentThread
  archiveActiveAgentThreadRef.current = archiveActiveAgentThread
  unarchiveActiveAgentThreadRef.current = unarchiveActiveAgentThread
  interruptAgentTurnRef.current = interruptAgentTurn
  getTerminalExplorerGroupsRef.current = getTerminalExplorerGroups
  getActiveTerminalTabIdRef.current = getActiveTerminalTabId
  focusTerminalTabRef.current = focusTerminalTab
  newTerminalInWorkspaceRef.current = newTerminalInWorkspace
  closeTerminalTabRef.current = closeTerminalTab
  onTerminalTitleChangeRef.current = onTerminalTitleChange

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

    const intervalId = window.setInterval(() => {
      void pollRunningThreads()
    }, 400)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [syncAgentThread, workspace.folders])

  const quickOpenSearch = useCallback(
    async (query: string) => {
      const folder = resolveContextFolder()
      if (!folder || !window.jet?.search?.fileSearch) return []

      const panel = focusedPanel
      const activeUri = panel ? getActiveEditorFileUri(panelTree, panel) : null
      let currentFile: { folderId: string; relativePath: string } | undefined
      if (activeUri) {
        const abs = fileUriToPath(activeUri)
        const rel = relativePathInFolder(folder.root.path, abs)
        if (rel != null) {
          currentFile = { folderId: folder.id, relativePath: rel }
        }
      }

      return fileSearchAcrossFolders([folder], window.jet.search, query, {
        pageSize: 100,
        currentFile,
      })
    },
    [resolveContextFolder, focusedPanel, panelTree],
  )

  const openListItem = useCallback(
    (item: ListItem) => {
      const label = workspace.tabRegistry.labelFor(
        getActiveListTabId(panelTree, focusedPanel) ?? "",
      )
      pushJumpFromActiveEditor(label || "navigation")
      handleOpenFileAt(item.fileUri, fileUriToPath(item.fileUri), item.line, item.column)
    },
    [handleOpenFileAt, pushJumpFromActiveEditor, workspace, panelTree, focusedPanel],
  )

  const syncProblemsToListTab = useCallback(() => {
    workspace.ensureProblemsList()
    workspace.listStore.update(PROBLEMS_TAB_ID, { items: problemsToListItems(problems) })
  }, [workspace, problems])

  useEffect(() => {
    lspClientPool.setWorkspaceDeps({
      openFile: (uri, path, line, column) => {
        handleOpenFile(uri, path, line, column)
      },
      readFile: uri => workspace.readFile(uri),
      getLanguageId: uri => {
        const file = workspace.fileForUri(uri)
        if (file) return file.languageId
        const path = isUntitledUri(uri) ? "" : fileUriToPath(uri)
        return workspace.createWorkspaceFile(uri, path).languageId
      },
    })
  }, [lspClientPool, handleOpenFile, workspace])

  const refreshProjects = useCallback(async (): Promise<number> => {
    let homeDir = homeDirRef.current
    if (window.jet?.getHomeDir) {
      homeDir = await window.jet.getHomeDir()
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
  }, [])

  const handleFolderPickerOpenChange = useCallback((open: boolean) => {
    setFolderPickerOpen(open)
    if (!open && folderPickerPendingRef.current) {
      folderPickerPendingRef.current.resolve(null)
      folderPickerPendingRef.current = null
    }
  }, [])

  const handleFolderPickerSelect = useCallback((folder: WorkspaceFolder) => {
    folderPickerPendingRef.current?.resolve(folder)
    folderPickerPendingRef.current = null
    setFolderPickerOpen(false)
  }, [])

  const syncGlobalSearchState = useCallback(() => {
    setFolderSearchRev(r => r + 1)
  }, [])

  const activateFolderBackground = useCallback(
    (folderId: string, folderPath: string) => {
      const gen = (workspaceInitGen.current.get(folderId) ?? 0) + 1
      workspaceInitGen.current.set(folderId, gen)

      const jetDir = `${folderPath.replace(/[/\\]+$/, "")}/.jet`
      const initCtx = workspaceInitCtxRef.current
      if (initCtx) {
        void loadWorkspaceInit(jetDir, initCtx).catch(err =>
          console.warn("Workspace init failed:", err),
        )
      }

      const finishOpen = () => {
        if (workspaceInitGen.current.get(folderId) !== gen) return
        const folder = workspace.manager.folders.find(f => f.id === folderId)
        const rootUri = folder?.root.uri
        if (!rootUri) return
        if (window.jet?.workspace) void window.jet.workspace.activate(rootUri)
        void (async () => {
          const supported = (await window.jet?.search?.isSupported?.(rootUri)) ?? false
          if (workspaceInitGen.current.get(folderId) !== gen) return
          if (!supported) {
            folderSearchStateRef.current.set(folderId, { supported: false, scanReady: true })
            setFolderSearchRev(r => r + 1)
            syncGlobalSearchState()
            return
          }
          void window.jet?.search?.fileSearch(rootUri, "", { pageSize: 1 }).catch(() => {})
          for (let attempt = 0; attempt < 120; attempt++) {
            if (workspaceInitGen.current.get(folderId) !== gen) return
            const ready = await window.jet?.search?.isScanReady?.(rootUri)
            if (ready) {
              folderSearchStateRef.current.set(folderId, { supported: true, scanReady: true })
              setFolderSearchRev(r => r + 1)
              syncGlobalSearchState()
              return
            }
            await new Promise(resolve => window.setTimeout(resolve, 250))
          }
          if (workspaceInitGen.current.get(folderId) !== gen) return
          folderSearchStateRef.current.set(folderId, { supported: true, scanReady: true })
          setFolderSearchRev(r => r + 1)
          syncGlobalSearchState()
        })()
      }
      setTimeout(finishOpen, 0)
    },
    [workspace, syncGlobalSearchState],
  )

  useEffect(() => {
    const sub = workspace.manager.onDidChangeFolders.event(folders => {
      for (const folder of folders) {
        if (!workspaceInitGen.current.has(folder.id)) {
          activateFolderBackground(folder.id, folder.root.path)
        }
      }
    })
    return () => sub.dispose()
  }, [workspace, activateFolderBackground])

  const addWorkspaceFolder = useCallback(
    (folderPath: string) => {
      void (async () => {
        const folder = await workspace.addFolder(folderPath)
        workspaceRootPathRef.current = folderPath
        showJetToast(`Added ${folder.root.name}`)
        activateFolderBackground(folder.id, folderPath)
      })()
    },
    [workspace, activateFolderBackground],
  )

  const openWorkspaceFolder = useCallback(
    async (folderPath: string, opts?: OpenWorkspaceOptions): Promise<void> => {
      const folder =
        opts?.replace || !workspace.manager.hasFolders()
          ? await workspace.replaceAllFolders(folderPath)
          : await workspace.addFolder(folderPath)
      workspaceRootPathRef.current = folderPath
      if (!opts?.silent) {
        if (opts?.replace || workspace.folders.length === 1) {
          showJetToast(`Opened ${folderPath}`)
        } else {
          showJetToast(`Added ${folder.root.name}`)
        }
      }
      activateFolderBackground(folder.id, folderPath)
    },
    [workspace, activateFolderBackground],
  )

  const removeWorkspaceFolder = useCallback(
    async (folderId: string): Promise<boolean> => {
      const folder = workspace.manager.folders.find(f => f.id === folderId)
      if (!folder) return false
      if (workspace.hasDirtyFilesUnderFolder(folderId)) {
        showJetToast("Cannot remove folder with unsaved changes", { variant: "destructive" })
        return false
      }

      const rootUri = folder.root.uri
      const rootPath = folder.root.path
      const prefix = `${normalizeAbsPath(rootPath)}/`

      const tree = cloneTree()
      for (const panel of getAllLeafPanels(tree)) {
        const view = tree.getView(panel)
        if (view?.kind !== "tabs") continue
        for (const tabId of panelTabIds(view)) {
          if (isUntitledUri(tabId)) continue
          const path = fileUriToPath(tabId)
          if (!path.startsWith(prefix) && normalizeAbsPath(path) !== normalizeAbsPath(rootPath)) {
            continue
          }
          destroyEditorBuffer(panel, tabId)
          workspace.closeBuffer(tabId)
          workspace.disposeTab(tabId)
          workspace.closeTabInPanel(tree, panel, tabId)
        }
      }
      commitTree(tree)

      if (window.jet?.workspace?.deactivate) {
        await window.jet.workspace.deactivate(rootUri)
      }
      if (lspManager) {
        await lspManager.stopServersForRoot(rootUri)
      }
      folderSearchStateRef.current.delete(folderId)
      workspaceInitGen.current.delete(folderId)
      const removed = workspace.removeFolder(folderId)
      if (removed) {
        setAgentSnapshots(prev => {
          const next = { ...prev }
          delete next[rootUri]
          return next
        })
        setAgentThreads(prev => {
          const next = { ...prev }
          for (const key of Object.keys(next)) {
            if (key.startsWith(`${rootUri}\u0000`)) delete next[key]
          }
          return next
        })
        syncGlobalSearchState()
        showJetToast(`Removed ${folder.root.name}`)
      }
      return removed
    },
    [workspace, cloneTree, commitTree, lspManager, syncGlobalSearchState, tabStore],
  )

  useEffect(() => {
    if (!window.jet?.workspace?.onSearchReady) return
    return window.jet.workspace.onSearchReady(rootUri => {
      const folder = workspace.manager.folders.find(
        f => normalizeAbsPath(f.root.uri) === normalizeAbsPath(rootUri) || f.root.uri === rootUri,
      )
      if (!folder) return
      const prev = folderSearchStateRef.current.get(folder.id)
      folderSearchStateRef.current.set(folder.id, {
        supported: prev?.supported ?? true,
        scanReady: true,
      })
      setFolderSearchRev(r => r + 1)
      syncGlobalSearchState()
    })
  }, [workspace, syncGlobalSearchState])

  useEffect(() => {
    const sub = workspace.manager.onDidChangeFolders.event(() => {
      syncGlobalSearchState()
    })
    return () => sub.dispose()
  }, [workspace, syncGlobalSearchState])

  useEffect(() => {
    const syncAgentRoots = (folders: WorkspaceFolder[]) => {
      const roots = folders.map(folder => ({
        rootUri: folder.root.uri,
        rootPath: folder.root.path,
      }))
      setAgentSnapshots(prev => {
        const keep = new Set(roots.map(root => root.rootUri))
        let changed = false
        const next: Record<string, AgentWorkspaceSnapshot | null> = {}
        for (const [key, value] of Object.entries(prev)) {
          if (!keep.has(key)) {
            changed = true
            continue
          }
          next[key] = value
        }
        return changed ? next : prev
      })
      setAgentThreads(prev => {
        const keep = new Set(roots.map(root => root.rootUri))
        let changed = false
        const next: Record<string, AgentThread | null> = {}
        for (const [key, value] of Object.entries(prev)) {
          const rootUri = key.split("\u0000", 1)[0]!
          if (!keep.has(rootUri)) {
            changed = true
            continue
          }
          next[key] = value
        }
        return changed ? next : prev
      })
      for (const root of roots) {
        void loadAgentSnapshot(root.rootUri, root.rootPath)
      }
    }

    syncAgentRoots(workspace.manager.folders)
    const sub = workspace.manager.onDidChangeFolders.event(folders => {
      syncAgentRoots(folders)
    })
    return () => sub.dispose()
  }, [workspace, loadAgentSnapshot])

  useEffect(() => {
    void loadAgentProviders()
  }, [loadAgentProviders])

  openWorkspaceRef.current = openWorkspaceFolder
  addWorkspaceRef.current = addWorkspaceFolder
  handleOpenFileRef.current = handleOpenFile
  handleOpenFileForTabs.current = handleOpenFile
  openListItemForTabs.current = openListItem
  setEditorFocusedRef.current = setEditorFocused
  setEditorSelectionRef.current = (line, column, rangeCount) =>
    setEditorCursor({ line, column, rangeCount })
  resolveLspClientRef.current = resolveLspClient
  keymapContextRef.current = keymapContext

  const bootstrapFromLaunchForDrop = useCallback((config: LaunchConfig) => {
    bootstrapFromLaunch(
      path => openWorkspaceRef.current(path, { replace: true, silent: true }),
      (uri, path) => handleOpenFileRef.current(uri, path),
      config,
    )
  }, [])

  const openUntitledFromDrop = useCallback(
    (name: string, content: string) => {
      const tree = cloneTree()
      const panel = resolveEditorPanel(tree, editorPanelRef.current, focusedPanel)
      if (!panel) return
      editorPanelRef.current = panel
      workspace.openUntitledInPanel(tree, panel, { label: name })
      setPendingInitialContent(panel, content)
      setFocusedPanel(panel)
      commitTree(tree)
    },
    [workspace, focusedPanel, cloneTree, commitTree],
  )

  useFileDrop({
    fs: jetPlatformFS(),
    knownWorkspacePaths: workspace.folders.map(f => f.root.path),
    normalizePath: normalizeAbsPath,
    openWorkspace: path => openWorkspaceRef.current(path, { replace: true, silent: true }),
    addWorkspaceFolder: path => addWorkspaceRef.current(path),
    openFile: (uri, path) => handleOpenFileRef.current(uri, path),
    bootstrapFromLaunch: bootstrapFromLaunchForDrop,
    openUntitledFromDrop,
    setMessage: showJetToast,
    onDragOverChange: setFileDragOver,
  })

  const handlePanelEvent = useCallback(
    (event: PanelEvent) => {
      const tree = cloneTree()
      let changed = true
      if (event.type === "splitRatiosChanged") {
        changed = tree.setSplitRatios(event.path, event.ratios)
      } else if (event.type === "panelClose") {
        const morphBefore = capturePanelLeafRects()
        const view = tree.getView(event.panelId)
        if (view?.kind === "tabs") {
          for (const tabId of panelTabIds(view)) {
            const kind = workspace.tabRegistry.kindFor(tabId)
            if (kind === "editor") {
              destroyEditorBuffer(event.panelId, tabId)
            }
            workspace.disposeTab(tabId)
            tabStore.dispose(tabId)
          }
        }
        tree.closePanel(event.panelId)
        commitTree(tree, undefined, { animate: true, beforeRects: morphBefore })
        changed = false
      } else if (event.type === "tabActivate") {
        const view = tree.getView(event.panelId)
        if (view?.kind !== "tabs" || view.activeTabId === event.tabId) {
          changed = false
        } else {
          tree.setView(event.panelId, activatePanelTab(view, event.tabId))
          setFocusedPanel(event.panelId)
        }
      } else if (event.type === "tabClose") {
        const view = tree.getView(event.panelId)
        if (view?.kind !== "tabs") {
          changed = false
        } else {
          const kind = workspace.tabRegistry.kindFor(event.tabId)
          if (kind === "editor") {
            destroyEditorBuffer(event.panelId, event.tabId)
          }
          workspace.disposeTab(event.tabId)
          tabStore.dispose(event.tabId)
          tree.setView(event.panelId, popPanelTab(view, event.tabId))
          closePanelIfEmpty(tree, event.panelId)
        }
      } else if (event.type === "tabReorder") {
        const view = tree.getView(event.panelId)
        if (view?.kind !== "tabs") {
          changed = false
        } else {
          tree.setView(event.panelId, reorderPanelTab(view, event.tabId, event.toIndex))
        }
      } else if (event.type === "tabDrop") {
        const kind = workspace.tabRegistry.kindFor(event.sourceTabId)
        if (kind === "editor") {
          destroyEditorBuffer(event.source, event.sourceTabId)
        }
        const morphBefore = capturePanelLeafRects()
        const result = tree.applyTabDrop(
          event.source,
          event.sourceTabId,
          event.target,
          event.action,
        )
        if (!result.moved) {
          changed = false
        } else if (result.createdPanel) {
          setFocusedPanel(result.createdPanel)
        } else {
          setFocusedPanel(event.target)
        }
        if (changed) {
          commitTree(tree, undefined, {
            animate: true,
            beforeRects: morphBefore,
            spawnFrom: result.createdPanel
              ? new Map([
                  [
                    result.createdPanel.id,
                    morphBefore.get(event.target.id) ?? { x: 0, y: 0, w: 0, h: 0 },
                  ],
                ])
              : undefined,
          })
          changed = false
        }
      }
      if (changed) commitTree(tree)
    },
    [cloneTree, commitTree, setFocusedPanel, workspace],
  )

  const tabDndHandlers = useMemo(
    () => ({
      onTabReorder: (panelId: PanelId, tabId: string, toIndex: number) => {
        handlePanelEvent({ type: "tabReorder", panelId, tabId, toIndex })
      },
      onTabDrop: (
        source: PanelId,
        sourceTabId: string,
        target: PanelId,
        action: DropAction,
      ) => {
        handlePanelEvent({ type: "tabDrop", source, sourceTabId, target, action })
      },
      tabIdsForPanel: (panelId: PanelId) => {
        const view = appStateRef.current.panelTree.getView(panelId)
        return view?.kind === "tabs" ? panelTabIds(view) : []
      },
    }),
    [handlePanelEvent],
  )

  const keymapTargetViewRef = useRef<EditorView | null>(null)

  const getCommandContext = useCallback((): JetCommandContext => {
    return {
      workspace,
      ui: {
        showMessage: showJetToast,
        showCommandPalette: () => setPaletteOpen(true),
        setCommandPaletteOpen: setPaletteOpen,
      },
      getActiveEditorView: () => {
        if (keymapTargetViewRef.current) return keymapTargetViewRef.current
        const panel = appStateRef.current.focusedPanel ?? editorPanelRef.current
        return panel ? (getEditorView(panel) ?? null) : null
      },
    }
  }, [workspace])

  const handlePanelNavigation = useCallback((action: string) => {
    const panel = appStateRef.current.focusedPanel
    const tree = appStateRef.current.panelTree
    const tabKind = activeTabKind(tree, panel, workspace.tabRegistry)
    const listTabId = getActiveListTabId(tree, panel)
    const sidebarEl = document.querySelector("[data-jet-workspace-sidebar]")
    const sidebarActive =
      sidebarEl?.contains(document.activeElement ?? null) ||
      (sidebarEl?.contains(document.querySelector(":focus") ?? null) ?? false)
    const el = sidebarActive
      ? getListPanel(
          sidebarViewRef.current === "terminal-explorer"
            ? "jet:terminal-explorer"
            : "jet:explorer",
        )
      : listTabId
        ? getListPanel(listTabId)
        : tabKind === "explorer"
          ? getListPanel("jet:explorer")
          : null
    if (!el) return
    const items = [...el.querySelectorAll<HTMLElement>("[data-jet-list-item]")]
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusItem = (index: number) => {
      const next = items[Math.max(0, Math.min(items.length - 1, index))]
      next?.focus()
    }
    if (action === "focusNext") {
      focusItem((active ? items.indexOf(active) : -1) + 1)
      return
    }
    if (action === "focusPrev") {
      focusItem((active ? items.indexOf(active) : items.length) - 1)
      return
    }
    if (action === "activate") {
      active?.click()
      return
    }
    if (action === "focusFirstItem") {
      focusItem(0)
      return
    }
    if (action === "focusLastItem") {
      focusItem(items.length - 1)
      return
    }
    const page = Math.max(80, Math.floor(el.clientHeight * 0.85))
    if (action === "focusPageUp") el.scrollBy({ top: -page })
    else if (action === "focusPageDown") el.scrollBy({ top: page })
    else if (action === "focusFirst") el.scrollTop = 0
    else if (action === "focusLast") el.scrollTop = el.scrollHeight
  }, [workspace])

  const handleZoom = useCallback((delta: number) => {
    const next = fontSizeRef.current + delta * FONT_SIZE_STEP
    if (next <= 0) return
    fontSizeRef.current = next
    applyRootFontSize(next)
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(next))
  }, [])

  const setFontSize = useCallback((px: number) => {
    if (px <= 0) return
    fontSizeRef.current = px
    applyRootFontSize(px)
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(px))
  }, [])

  const appCommands = useMemo(
    () =>
      buildAppCommands({
        workspace,
        getPanelTree: () => appStateRef.current.panelTree,
        getFocusedPanel: () => appStateRef.current.focusedPanel,
        setPaletteOpen,
        setQuickOpenOpen,
        setBufferListOpen,
        setOpenFileOpen,
        setCdOpen,
        setProjectSwitcherOpen,
        setSwitchFolderOpen,
        pickWorkspaceFolder,
        setGotoLineOpen,
        setMessage: showJetToast,
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
        openListItem,
        syncProblemsToListTab,
        editorPanelRef,
        isWebMode,
        setZoomLevel: handleZoom,
        handlePanelNavigation,
        setOutlineOpen,
        setOutlineSymbols,
        pushJumpFromActiveEditor,
        projectRegistry,
        refreshProjects,
        focusExplorer: focusExplorerPanel,
        focusTerminalExplorer: focusTerminalExplorerPanel,
        setSidebarOpen,
        setSidebarView: handleSidebarViewChange,
        getSidebarView: () => sidebarViewRef.current,
        openAgentExplorer: openAgentsExplorer,
        openTerminalExplorer,
        createAgentThread,
        archiveActiveAgentThread: () => archiveActiveAgentThreadRef.current(),
        unarchiveActiveAgentThread: () => unarchiveActiveAgentThreadRef.current(),
        getSearchSupported: () => getContextSearchState().supported,
        getContextFolder: resolveContextFolder,
      }),
    [
      workspace,
      cloneTree,
      commitTree,
      openWorkspaceFolder,
      addWorkspaceFolder,
      removeWorkspaceFolder,
      handlePanelEvent,
      openFileInEditor,
      openListItem,
      syncProblemsToListTab,
      handleZoom,
      handlePanelNavigation,
      pushJumpFromActiveEditor,
      projectRegistry,
      refreshProjects,
      openAgentsExplorer,
      openTerminalExplorer,
      handleSidebarViewChange,
      createAgentThread,
      getContextSearchState,
      resolveContextFolder,
      pickWorkspaceFolder,
    ],
  )

  const contextSearchState = getContextSearchState()

  const deferredPanelRev = useDeferredValue(panelRev)

  // Base list: id/title/keybinding for every command in the current context.
  // Depends on layoutRev (deferredPanelRev) and keybinding map, NOT on
  // recentCommands or paletteOpen — so opening the palette or bumping the
  // recent list does not re-scan or re-sort every command.
  const paletteBaseCommands = useMemo(() => {
    void deferredPanelRev // context depends on active panel; recompute on layout change
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
  }, [commands, deferredPanelRev, appCommands, keybindingByFn, fnByCommandId, getCommandContext])

  // Recent overlay: linear pass, no re-sort. When no recent, return base by
  // identity so downstream memos/renders see stable reference.
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
      keymapTargetViewRef.current = view ?? null
      try {
        void binding.run(getCommandContext())
      } finally {
        keymapTargetViewRef.current = null
      }
    },
    [getCommandContext],
  )

  useEffect(() => {
    const noOverlay = (ctx: KeymapContext) => !anyOverlayOpen(ctx)
    keymaps.registerUser([
      ...createDefaultKeybindings(appCommands),
      bind("Cmd-Backspace", appCommands.archiveAgent, ctx => ctx.agentChatFocus && noOverlay(ctx)),
      bind(
        "Cmd-Shift-Backspace",
        appCommands.unarchiveAgent,
        ctx => ctx.agentChatFocus && noOverlay(ctx),
      ),
      bind(
        "Mod-\\",
        appCommands.splitEditorRight,
        ctx => ctx.workspaceOpen && noOverlay(ctx),
      ),
      bind(
        "Mod-Shift-\\",
        appCommands.splitEditorBottom,
        ctx => ctx.workspaceOpen && noOverlay(ctx),
      ),
    ])
  }, [keymaps, appCommands])

  useEffect(() => {
    workspaceInitCtxRef.current = {
      workspace,
      commands,
      appCommands,
      getCommandContext,
      addKeybindings: bindings => keymaps.registerExtension(bindings),
      addEditorExtensions: ext => setUserExtensions(prev => [...prev, ext]),
      openFile: async uri => handleOpenFile(uri, fileUriToPath(uri)),
      showMessage: showJetToast,
    }
  }, [workspace, commands, appCommands, getCommandContext, keymaps, handleOpenFile])

  useEffect(() => {
    if (!layoutReady) return
    void (async () => {
      const fetchScanRoots = async (): Promise<string[]> => {
        if (window.jet?.loadGlobalJetrcScanRoots) {
          if (window.jet.getHomeDir) homeDirRef.current = await window.jet.getHomeDir()
          return window.jet.loadGlobalJetrcScanRoots()
        }
        const res = await fetch("/__jet/globalJetrc/scanRoots")
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
        "ui.toggleColorScheme",
        () => {
          setColorScheme(prev => {
            const next: ColorScheme = prev === "dark" ? "light" : "dark"
            localStorage.setItem(COLOR_SCHEME_KEY, next)
            showJetToast(`Color scheme: ${next}`)
            return next
          })
        },
        {
          id: "ui.toggleColorScheme",
          title: "Toggle Color Scheme",
          category: "UI",
          aliases: ["theme", "dark mode", "light mode"],
        },
      ),
    )
    disposables.push(
      commands.register(
        "ui.setColorScheme.dark",
        () => {
          setColorScheme("dark")
          localStorage.setItem(COLOR_SCHEME_KEY, "dark")
          showJetToast("Color scheme: dark")
        },
        { id: "ui.setColorScheme.dark", title: "Color Scheme: Dark", category: "UI" },
      ),
    )
    disposables.push(
      commands.register(
        "ui.setColorScheme.light",
        () => {
          setColorScheme("light")
          localStorage.setItem(COLOR_SCHEME_KEY, "light")
          showJetToast("Color scheme: light")
        },
        { id: "ui.setColorScheme.light", title: "Color Scheme: Light", category: "UI" },
      ),
    )
    return () => {
      for (const d of disposables) d?.dispose()
    }
  }, [commands, appCommands])

  useEffect(() => {
    window.__jetAgent = createAgentBridge(() => ({
      workspace,
      commands,
      panelTree,
      focusedPanel,
      paletteOpen,
      message: null,
      layoutReady,
      fontSize: fontSizeRef.current,
      activeEditorDirty: activeEditorFile?.isDirty ?? false,
      executeCommand,
      openWorkspace: folderPath =>
        Promise.resolve(openWorkspaceRef.current(folderPath, { replace: true, silent: true })),
      addWorkspace: folderPath => Promise.resolve(addWorkspaceRef.current(folderPath)),
      listWorkspaces: () => workspace.manager.folders.map(f => ({ id: f.id, path: f.root.path, name: f.root.name })),
      openFile: handleOpenFile,
      setFontSize,
      getEditorText: () => {
        const panel = focusedPanel ?? editorPanelRef.current
        if (!panel) return null
        const view = getEditorView(panel)
        return view?.state.doc.toString() ?? null
      },
      setEditorSelection: (line, column) => {
        const panel = focusedPanel ?? editorPanelRef.current
        if (!panel) return
        const view = getEditorView(panel)
        if (view) jumpToLine(view, line, column)
      },
      getCursorPosition: () => {
        const pos = getEditorCursor()
        return pos ? { line: pos.line, column: pos.column } : null
      },
      getSelectionRangeCount: () => {
        const panel = focusedPanel ?? editorPanelRef.current
        if (!panel) return null
        const view = getEditorView(panel)
        return view?.state.selection.ranges.length ?? null
      },
    }))
    return () => {
      delete window.__jetAgent
    }
  }, [
    workspace,
    commands,
    panelTree,
    focusedPanel,
    paletteOpen,
    layoutReady,
    executeCommand,
    openWorkspaceFolder,
    handleOpenFile,
    setFontSize,
    activeEditorFile,
  ])

  useEffect(() => {
    if (!layoutReady || queryBootstrapDone.current) return
    const openFile = (uri: string, path: string) => handleOpenFileRef.current(uri, path)
    if (isWebMode && hasWorkspaceQuery) {
      queryBootstrapDone.current = true
      void openWorkspaceFromQuery(
        window.location.search,
        async path => {
          await openWorkspaceRef.current(path, { replace: true, silent: true })
        },
        openFile,
      )
        .catch(err => console.warn("Failed to open workspace from query:", err))
    } else if (!isWebMode && window.jet?.getLaunchConfig) {
      void window.jet.getLaunchConfig().then(cfg => {
        if (!cfg || queryBootstrapDone.current) return
        queryBootstrapDone.current = true
        bootstrapFromLaunch(
          path => openWorkspaceRef.current(path, { replace: true, silent: true }),
          openFile,
          cfg,
        )
      })
    }
  }, [layoutReady])

  useEffect(() => {
    if (!window.jet?.lsp?.onCrashed) return
    return window.jet.lsp.onCrashed(id => {
      lspClientPool.releaseConnection(id)
      setLspCrashed(true)
      bumpLspRevision()
      showJetToast("LSP crashed — will retry on next editor focus")
    })
  }, [lspClientPool, bumpLspRevision])

  const lspStatus = useMemo((): "connected" | "off" | "unavailable" => {
    if (!window.jet?.lsp) return "unavailable"
    if (lspCrashed) return "off"
    if (lspManager?.hasAnyConnection()) return "connected"
    return "off"
  }, [lspManager, lspCrashed, lspRevision])

  const problemsFpRef = useRef("")
  const problemsRafRef = useRef<number | null>(null)
  const refreshProblems = useCallback(() => {
    const views = getAllEditorViews()
    const next = collectProblemsFromViews(views.map(v => ({ uri: v.uri, view: v.view })))
    const fp = problemsFingerprint(next)
    if (fp === problemsFpRef.current) return
    problemsFpRef.current = fp
    startTransition(() => setProblems(next))
  }, [])

  const scheduleRefreshProblems = useCallback(() => {
    if (problemsRafRef.current != null) return
    problemsRafRef.current = requestAnimationFrame(() => {
      problemsRafRef.current = null
      refreshProblems()
    })
  }, [refreshProblems])

  // Layout changes (panel splits/closes, tabs moved) can add/remove editor
  // sessions. Re-scan on layoutRev, not on per-keystroke content signals.
  useEffect(() => {
    scheduleRefreshProblems()
  }, [panelRev, scheduleRefreshProblems])

  useEffect(() => {
    syncProblemsToListTab()
  }, [problems, syncProblemsToListTab])

  const handleLspAttachFailed = useCallback(
    (fileUri: string) => {
      void ensureLspForFile(fileUri)
    },
    [ensureLspForFile],
  )

  executeCommandRef.current = executeCommand
  runKeyBindingRef.current = runKeyBinding
  handleLspAttachFailedRef.current = handleLspAttachFailed
  refreshProblemsRef.current = scheduleRefreshProblems

  useEffect(() => {
    if (activeTabKindName !== "editor") setEditorCursor(null)
  }, [activeTabKindName])

  useEffect(() => {
    let lastCloseAt = 0
    const chordState = createChordState()
    let chordTimeout: number | null = null
    const clearPendingChord = () => {
      if (chordTimeout != null) window.clearTimeout(chordTimeout)
      chordTimeout = null
      setPendingChordPrefix(null)
    }
    const closeBuffer = () => {
      if (!workspace.manager.hasFolders() || anyOverlayOpen(keymapContext)) return
      const now = Date.now()
      if (now - lastCloseAt < 100) return
      lastCloseAt = now
      void executeCommand("workspace.closeBuffer")
    }
    const dispatchKeyBinding = (e: KeyboardEvent, opts?: { allowEditor?: boolean }): boolean => {
      const allowEditor = opts?.allowEditor ?? false
      const hadPendingChord = chordState.prefix != null
      const result = resolveKeydownBinding(e, keymapBindings, keymapContext, chordState)
      if (result === "chord-started") {
        e.preventDefault()
        setPendingChordPrefix(chordState.prefix)
        if (chordTimeout != null) window.clearTimeout(chordTimeout)
        chordTimeout = window.setTimeout(clearPendingChord, CHORD_TIMEOUT_MS)
        return true
      }
      if (hadPendingChord && chordState.prefix == null) clearPendingChord()
      if (result && isChordBinding(result.key)) {
        e.preventDefault()
        runKeyBinding(result)
        return true
      }
      if (result && !isEditorKeyBinding(result, keymapContext)) {
        e.preventDefault()
        e.stopPropagation()
        runKeyBinding(result)
        return true
      }
      if (allowEditor && result && isEditorKeyBinding(result, keymapContext)) {
        const panel = appStateRef.current.focusedPanel ?? editorPanelRef.current
        const view = panel ? getEditorView(panel) : null
        if (view?.hasFocus || keymapContext.editorFocus) {
          e.preventDefault()
          e.stopPropagation()
          runKeyBinding(result, view ?? undefined)
          return true
        }
      }
      if (allowEditor && result) {
        e.preventDefault()
        runKeyBinding(result)
        return true
      }
      return false
    }
    const onKey = (e: KeyboardEvent) => {
      if (anyOverlayOpen(keymapContext)) return
      const target = e.target
      const inXterm = target instanceof HTMLElement && target.closest(".xterm") != null
      if (target instanceof HTMLInputElement || (target instanceof HTMLTextAreaElement && !inXterm)) {
        return
      }

      if (keymapContext.terminalFocus || inXterm) {
        if (dispatchKeyBinding(e)) return
        if (keyEventMatchesBinding(e, "Cmd-=") || keyEventMatchesBinding(e, "Cmd--")) {
          e.preventDefault()
          e.stopPropagation()
          void executeCommand(keyEventMatchesBinding(e, "Cmd--") ? "ui.zoomOut" : "ui.zoomIn")
          return
        }
        if (keymapContext.terminalFocus && !inXterm) {
          const textarea = document.querySelector<HTMLTextAreaElement>(
            "[data-jet-tab-slot][data-jet-tab-active] [data-jet-terminal-panel] .xterm-helper-textarea",
          )
          if (textarea && document.activeElement !== textarea) textarea.focus()
        }
        return
      }

      if (keyEventMatchesBinding(e, "Cmd-w")) {
        if (!workspace.manager.hasFolders()) return
        e.preventDefault()
        e.stopPropagation()
        closeBuffer()
        return
      }
      dispatchKeyBinding(e, { allowEditor: true })
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      if (chordTimeout != null) window.clearTimeout(chordTimeout)
    }
  }, [keymapBindings, keymapContext, runKeyBinding, workspace.root, executeCommand])

  const titleBarMenus = useMemo<JetTitleBarMenu[]>(() => {
    const shortcutFor = (fnName: string): string | undefined => {
      const run = appCommands[fnName as keyof typeof appCommands]
      const key = run ? keybindingByFn.get(run) : undefined
      return key ? formatKeyBinding(key) : undefined
    }
    return [
      {
        id: "file",
        label: "File",
        items: [
          { id: "newFile", label: "New File", shortcut: shortcutFor("newFile"), onSelect: () => void executeCommand("workspace.newFile") },
          { id: "openFile", label: "Open File…", shortcut: shortcutFor("openFile"), onSelect: () => void executeCommand("workspace.openFile") },
          { id: "openFolder", label: "Open Folder…", shortcut: shortcutFor("openFolder"), onSelect: () => void executeCommand("workspace.openFolder") },
          { kind: "separator" as const },
          { id: "save", label: "Save", shortcut: shortcutFor("save"), onSelect: () => void executeCommand("workspace.saveFile") },
          { kind: "separator" as const },
          { id: "closeBuffer", label: "Close Tab", shortcut: shortcutFor("closeBuffer"), onSelect: () => void executeCommand("workspace.closeBuffer") },
        ],
      },
      {
        id: "edit",
        label: "Edit",
        items: [
          { id: "find", label: "Find…", shortcut: shortcutFor("find"), onSelect: () => void executeCommand("editor.find") },
          { id: "replace", label: "Replace…", shortcut: shortcutFor("replace"), onSelect: () => void executeCommand("editor.replace") },
          { id: "goto", label: "Go to Line…", shortcut: shortcutFor("gotoLine"), onSelect: () => void executeCommand("editor.gotoLine") },
          { kind: "separator" as const },
          { id: "toggleComment", label: "Toggle Comment", shortcut: shortcutFor("toggleComment"), onSelect: () => void executeCommand("editor.toggleComment") },
          { id: "selectNextOccurrence", label: "Select Next Occurrence", shortcut: shortcutFor("selectNextOccurrence"), onSelect: () => void executeCommand("editor.selectNextOccurrence") },
          { id: "selectAllOccurrences", label: "Select All Occurrences", shortcut: shortcutFor("selectAllOccurrences"), onSelect: () => void executeCommand("editor.selectAllOccurrences") },
          { id: "skipNextOccurrence", label: "Skip Next Occurrence", shortcut: shortcutFor("skipNextOccurrence"), onSelect: () => void executeCommand("editor.skipNextOccurrence") },
        ],
      },
      {
        id: "view",
        label: "View",
        items: [
          { id: "palette", label: "Command Palette…", shortcut: shortcutFor("palette"), onSelect: () => void executeCommand("ui.showCommandPalette") },
          { id: "quickOpen", label: "Quick Open…", shortcut: shortcutFor("quickOpen"), onSelect: () => void executeCommand("workspace.quickOpen") },
          { id: "explorer", label: "Show Explorer", shortcut: shortcutFor("explorer"), onSelect: () => void executeCommand("explorer.show") },
          { id: "agents", label: "Show Agents", shortcut: shortcutFor("agents"), onSelect: () => void executeCommand("agents.show") },
          { id: "locationList", label: "Show Location List", shortcut: shortcutFor("locationList"), onSelect: () => void executeCommand("locationlist.show") },
          { id: "output", label: "Show Output", shortcut: shortcutFor("output"), onSelect: () => void executeCommand("output.show") },
          { kind: "separator" as const },
          {
            kind: "checkbox" as const,
            id: "darkScheme",
            label: "Dark Color Scheme",
            checked: colorScheme === "dark",
            onCheckedChange: checked => {
              const next: ColorScheme = checked ? "dark" : "light"
              setColorScheme(next)
              localStorage.setItem(COLOR_SCHEME_KEY, next)
            },
          },
          { id: "zoomIn", label: "Zoom In", shortcut: shortcutFor("zoomIn"), onSelect: () => void executeCommand("ui.zoomIn") },
          { id: "zoomOut", label: "Zoom Out", shortcut: shortcutFor("zoomOut"), onSelect: () => void executeCommand("ui.zoomOut") },
        ],
      },
      {
        id: "go",
        label: "Go",
        items: [
          { id: "buffers", label: "Buffer List…", shortcut: shortcutFor("bufferList"), onSelect: () => void executeCommand("workspace.bufferList") },
          { id: "projects", label: "Switch Project…", shortcut: shortcutFor("switchProject"), onSelect: () => void executeCommand("workspace.switchProject") },
          { id: "cd", label: "Change Directory…", shortcut: shortcutFor("cd"), onSelect: () => void executeCommand("workspace.cd") },
          { kind: "separator" as const },
          { id: "jumpBack", label: "Jump Back", shortcut: shortcutFor("jumpBack"), onSelect: () => void executeCommand("navigation.jumpBack") },
          { id: "jumpForward", label: "Jump Forward", shortcut: shortcutFor("jumpForward"), onSelect: () => void executeCommand("navigation.jumpForward") },
        ],
      },
    ]
  }, [executeCommand, appCommands, keybindingByFn, colorScheme])

  const isMac =
    typeof navigator !== "undefined" && /Mac|iPad|iPhone|iPod/i.test(navigator.userAgent)
  const forceTitleBar =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("titlebar") === "1"
  const showTitleBar = forceTitleBar || (!isWebMode && isMac)

  return (
    <TooltipProvider>
    <div className="h-full w-full" data-drag-over={fileDragOver || undefined}>
    <AppShell
      titleBar={
        showTitleBar ? (
          <JetTitleBar
            menus={titleBarMenus}
            center={workspace.root ? (activeEditorFile ? `${activeEditorFile.name}${activeEditorFile.isDirty ? " •" : ""} — ${workspace.root.name}` : workspace.root.name) : "Jet"}
          />
        ) : undefined
      }
      footer={
        <>
          {pendingChordPrefix && (
            <WhichKeyPanel prefix={formatKeyBinding(pendingChordPrefix)} entries={whichKeyEntries} />
          )}

          <StatusBar
            lspStatus={lspStatus}
            workspaceName={workspace.root?.name}
            workspacePath={workspace.root?.path}
            workspaceFolderCount={workspace.folders.length}
            workspaceFolderNames={workspace.folders.map(f => f.root.name)}
            hasWorkspace={workspace.manager.hasFolders()}
            activeFileName={activeEditorFile?.name ?? null}
            activeLanguageId={activeEditorFile?.languageId ?? null}
            activeFileDirty={activeEditorFile?.isDirty ?? false}
          />
        </>
      }
    >
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        className="h-full min-h-0 w-full"
        style={{ "--sidebar-width": "15rem" } as React.CSSProperties}
      >
        {sidebarOpen ? (
          <JetWorkspaceSidebar
            activeView={sidebarView}
            onActiveViewChange={handleSidebarViewChange}
            manager={workspace.manager}
            onOpenFile={(uri, path) => handleOpenFile(uri, path)}
            onOpenFolder={() => executeCommand("workspace.openFolder")}
            terminalExplorerGroups={getTerminalExplorerGroups()}
            activeTerminalTabId={getActiveTerminalTabId()}
            onFocusTerminal={focusTerminalTab}
            onNewTerminal={rootUri => void newTerminalInWorkspace(rootUri)}
            onCloseTerminal={closeTerminalTab}
          />
        ) : null}
        <SidebarInset className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {!workspace.manager.hasFolders() && !hasWorkspaceQuery ? (
          <WelcomeView
            isWebMode={isWebMode}
            bootstrapping={false}
            onOpenFolder={() => executeCommand("workspace.openFolder")}
          />
        ) : (
          <PanelDock<PanelView>
            tree={panelTree}
            focusedPanelId={focusedPanel}
            onFocusPanel={setFocusedPanel}
            onEvent={handlePanelEvent}
            tabDnd={tabDndHandlers}
            renderHeader={(view, panelId, meta) => (
              <PanelTabBar
                panelId={panelId}
                view={view}
                store={tabStore}
                registry={tabTypeRegistry}
                focused={meta.focused}
                onActivateTab={tabId =>
                  handlePanelEvent({ type: "tabActivate", panelId, tabId })
                }
                onCloseTab={tabId =>
                  handlePanelEvent({ type: "tabClose", panelId, tabId })
                }
              />
            )}
            renderContent={(view, panelId, meta) => (
              <PanelBody
                panelId={panelId}
                view={view}
                store={tabStore}
                registry={tabTypeRegistry}
                focused={meta.focused}
              />
            )}
          />
        )}
        </SidebarInset>
      </SidebarProvider>

      <Suspense fallback={null}>
        {(gotoLineOpen ||
          (quickOpenOpen && contextSearchState.supported) ||
          bufferListOpen ||
          openFileOpen ||
          folderPickerOpen ||
          switchFolderOpen ||
          cdOpen ||
          projectSwitcherOpen ||
          outlineOpen ||
          paletteOpen) && (
          <OverlayHost
            gotoLineOpen={gotoLineOpen}
            onGotoLineOpenChange={setGotoLineOpen}
            onGotoLineSubmit={(line, column) => {
              const panel = focusedPanel
              const view = panel ? getEditorView(panel) : null
              if (view) jumpToLine(view, line, column)
            }}
            quickOpenOpen={quickOpenOpen}
            searchSupported={contextSearchState.supported}
            searchScanReady={contextSearchState.scanReady}
            onQuickOpenOpenChange={setQuickOpenOpen}
            onQuickOpenSearch={quickOpenSearch}
            onQuickOpenSelect={(displayPath, query) => {
              const folder = resolveContextFolder()
              const folders = folder ? [folder] : workspace.folders
              const resolved = resolveQuickOpenDisplayPath(displayPath, folders)
              if (!resolved) return
              void window.jet?.search?.trackFileAccess?.(
                resolved.folder.root.uri,
                query,
                resolved.relativePath,
              )
              handleOpenFile(resolved.fileUri, resolved.fullPath)
            }}
            bufferListOpen={bufferListOpen}
            onBufferListOpenChange={setBufferListOpen}
            workspace={workspace}
            onBufferSelect={uri => handleOpenFile(uri, fileUriToPath(uri))}
            openFileOpen={openFileOpen}
            onOpenFileOpenChange={setOpenFileOpen}
            onOpenFile={handleOpenFile}
            onRequestOpenFolder={() => {
              setOpenFileOpen(false)
              void executeCommand("workspace.openFolder")
            }}
            folderPickerOpen={folderPickerOpen}
            onFolderPickerOpenChange={handleFolderPickerOpenChange}
            onFolderPickerSelect={handleFolderPickerSelect}
            switchFolderOpen={switchFolderOpen}
            onSwitchFolderOpenChange={setSwitchFolderOpen}
            cdOpen={cdOpen}
            onCdOpenChange={setCdOpen}
            onSelectFolder={path => openWorkspaceFolder(path, { replace: true })}
            resolveHomeDir={async () =>
              window.jet?.getHomeDir
                ? window.jet.getHomeDir()
                : (await resolveDevWorkspacePath(".")).path
            }
            projectSwitcherOpen={projectSwitcherOpen}
            onProjectSwitcherOpenChange={setProjectSwitcherOpen}
            projects={projects}
            onSelectProject={path => openWorkspaceFolder(path, { replace: true })}
            outlineOpen={outlineOpen}
            onOutlineOpenChange={setOutlineOpen}
            outlineSymbols={outlineSymbols}
            onOutlineSelect={line => {
              const panel = focusedPanel
              const view = panel ? getEditorView(panel) : null
              if (view) jumpToLine(view, line, 1)
            }}
            paletteOpen={paletteOpen}
            onPaletteOpenChange={setPaletteOpen}
            paletteCommands={paletteCommands}
            onRunCommand={id => {
              void executeCommand(id)
            }}
          />
        )}
      </Suspense>
      {focusedPanel ? <FindReplacePopover panelId={focusedPanel} /> : null}
      <ConfirmDialogHost />
      <Toaster position="bottom-right" />
    </AppShell>
    </div>
    </TooltipProvider>
  )
}
