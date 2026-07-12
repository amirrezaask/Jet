import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  createDefaultKeybindings,
  bind,
  parseBindingKey,
  anyOverlayOpen,
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
  findPanelWithTab,
  isTerminalTabId,
  fileSearchAcrossFolders,
  relativePathInFolder,
  resolveQuickOpenDisplayPath,
} from "@jet/workspace"
import type { LSPClient } from "@jet/codemirror"
import { createAgentBridge } from "./agent-bridge.js"
import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import {
  jumpToLine,
  collectProblemsFromViews,
  problemsFingerprint,
  setPendingEditorNavigation,
  setPendingInitialContent,
} from "@jet/codemirror"
import {
  TabStore,
  TabTypeRegistry,
  PanelDock,
  PanelBody,
  PanelTabBar,
  StatusBar,
  bundledThemeList,
  defaultThemeId,
  defaultThemeIdForScheme,
  getThemeById,
  siblingThemeForScheme,
  getEditorView,
  getAllEditorViews,
  destroyEditorBuffer,
  setEditorCursor,
  getEditorCursor,
  formatKeyBinding,
  problemsToListItems,
  WhichKeyPanel,
  type TerminalExplorerGroup,
  type TerminalAgentShortcut,
  type JetAppearanceSettings,
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
  getListPanelController,
  focusFirstListItem,
  FindReplacePopover,
  animateLayoutMorph,
  capturePanelLeafRects,
  type PanelRect,
} from "@jet/ui"
import type { AgentExplorerWorkspaceGroup } from "@jet/ui/agents"
import { getJetSearchState } from "@jet/codemirror"
import { APP_COMMAND_REGISTRY, buildAppCommands } from "./app-commands.js"
import { registerBuiltinTabTypes } from "./tabs/index.js"
import { agentChatTabId, parseAgentChatTabId, type AgentChatTabState } from "./tabs/agent-chat.tab.js"
import { AGENT_EXPLORER_TAB_ID } from "./tabs/agent-explorer.tab.js"
import {
  clearTerminalSession,
  restartTerminalSession,
  subscribeTerminalSessions,
  terminalCwdForTab,
  terminalLaunchCommandForTab,
  terminalPtyIdForTab,
  terminalSessionForTab,
  setTerminalCustomLabel,
} from "./tabs/terminal-session.js"
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
import {
  openAgentChatTab,
  openAgentExplorerTab,
  openTerminalTab,
} from "./tab-routing.js"
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
import { WorkspaceLayoutStore } from "./workspace-layout-store.js"
import { swapWorkspaceLayout } from "./swap-workspace-layout.js"
import { readProjectCatalog, writeProjectCatalog } from "./project-catalog-store.js"
import { useFileDrop } from "./use-file-drop.js"
import { useAppearanceSettings } from "./hooks/useAppearanceSettings.js"
import { usePanelLayout } from "./hooks/usePanelLayout.js"
import { useAgentSync } from "./hooks/useAgentSync.js"
import { useLspLifecycle } from "./hooks/useLspLifecycle.js"
import OverlayHost from "./OverlayHost.js"
import { useTerminalLifecycle } from "./hooks/useTerminalLifecycle.js"
import { useOverlayState } from "./hooks/useOverlayState.js"
import { useGlobalKeymap } from "./hooks/useGlobalKeymap.js"
import {
  createTabContributorBridge,
} from "./hooks/tab-contributor-bridge.js"
import type { TabContributorDeps } from "./tabs/deps.js"
import { OverlayControllerSync } from "./hooks/OverlayControllerSync.js"
import {
  OverlayControllerProvider,
  type OverlayHandlers,
} from "./hooks/OverlayController.js"

type ColorScheme = "dark" | "light"

const THEME_ID_STORAGE_KEY = "jet-theme-id"
const COLOR_SCHEME_KEY = "jet-color-scheme"
const COMMAND_RECENTS_STORAGE_KEY = "jet-command-recents"
const FONT_SIZE_STORAGE_KEY = "jet-font-size"
const APPEARANCE_STORAGE_KEY = "jet-appearance-settings"
const DEFAULT_FONT_SIZE = 13
const FONT_SIZE_STEP = 2
const DEFAULT_MONO_FONT =
  '"Geist Mono Variable", "Geist Mono", "IBM Plex Mono", "SFMono-Regular", Menlo, monospace'
const ENABLE_AGENT_CHAT = import.meta.env.JET_ENABLE_AGENT_CHAT === "1"

const FN_BY_COMMAND_ID = ((): Map<string, string> => {
  const map = new Map<string, string>()
  for (const entry of APP_COMMAND_REGISTRY) map.set(entry.id, entry.fn)
  return map
})()

type OpenWorkspaceOptions = { replace?: boolean; silent?: boolean }

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function normalizeThemeId(value: unknown): string {
  return getThemeById(typeof value === "string" ? value : null).id
}

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

function loadStoredThemeId(): string {
  try {
    const rawTheme = localStorage.getItem(THEME_ID_STORAGE_KEY)
    if (rawTheme) return normalizeThemeId(rawTheme)
    const rawScheme = localStorage.getItem(COLOR_SCHEME_KEY)
    if (rawScheme === "light" || rawScheme === "dark") {
      return defaultThemeIdForScheme(rawScheme)
    }
  } catch {
    /* ignore */
  }
  return defaultThemeId
}

const SIDEBAR_VIEW_STORAGE_KEY = "jet-sidebar-view"
const WORKSPACE_SIDEBAR_WIDTH = "20rem"

function loadSidebarView(): JetSidebarView {
  if (typeof localStorage === "undefined") return "terminal-explorer"
  const stored = localStorage.getItem(SIDEBAR_VIEW_STORAGE_KEY)
  if (stored === "explorer" || stored === "terminal-explorer") return stored
  return "terminal-explorer"
}

/** First child recursively — visual top-left leaf in the panel tree. */
function isTopLeftPanel(tree: JetPanelTree, panelId: PanelId): boolean {
  let node = tree.root
  while (node.kind !== "leaf") {
    const first = node.split.children[0]
    if (!first) return false
    node = first
  }
  return node.panelId.id === panelId.id
}

/** A leaf touches the native window's top edge unless it follows a column split. */
function isTopEdgePanel(tree: JetPanelTree, panelId: PanelId): boolean {
  const visit = (node: JetPanelTree["root"], touchesTop: boolean): boolean => {
    if (node.kind === "leaf") return node.panelId.id === panelId.id && touchesTop
    return node.split.children.some((child, index) =>
      visit(child, touchesTop && (node.kind !== "column" || index === 0)),
    )
  }
  return visit(tree.root, true)
}

function detectWindowChrome(): boolean {
  if (typeof navigator === "undefined") return false
  if (/Mac|iPad|iPhone|iPod/i.test(navigator.userAgent)) return true
  if (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("titlebar") === "1"
  ) {
    return true
  }
  return false
}

function initialEditorLayout() {
  return JetPanelTree.editorOnlyLayout()
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
  const jet = window.jet
  if (!jet?.fs) {
    throw new Error("window.jet.fs not available")
  }
  const fs = jet.fs
  return {
    readFile: uri => fs.readFile(uri),
    writeFile: (uri, content) => fs.writeFile(uri, content),
    readDir: uri => fs.readDir(uri),
    stat: uri => fs.stat(uri),
  }
}

export function JetApp() {
  const {
    appearanceSettings,
    setAppearanceSettings,
    activeTheme,
    colorScheme,
    fontSize,
    handleZoom,
    setFontSize,
    resetAppearanceSettings,
    toggleColorScheme,
    setColorScheme,
    setThemeId,
  } = useAppearanceSettings()

  const overlay = useOverlayState()
  const {
    open: overlayOpen,
    paletteOpen,
    gotoLineOpen,
    outlineOpen,
    quickOpenOpen,
    bufferListOpen,
    terminalListOpen,
    openFileOpen,
    cdOpen,
    addWorkspaceOpen,
    settingsOpen,
    projectSwitcherOpen,
    switchFolderOpen,
    folderPickerOpen,
    setPaletteOpen,
    setGotoLineOpen,
    setOutlineOpen,
    setQuickOpenOpen,
    setBufferListOpen,
    setTerminalListOpen,
    setOpenFileOpen,
    setCdOpen,
    setAddWorkspaceOpen,
    setSettingsOpen,
    setProjectSwitcherOpen,
    setSwitchFolderOpen,
    setFolderPickerOpen,
    setOpen,
  } = overlay

  const [outlineSymbols, setOutlineSymbols] = useState<OutlineEntry[]>([])
  const [userExtensions, setUserExtensions] = useState<Extension[]>([])
  const [keymapRevision, setKeymapRevision] = useState(0)
  const [editorFocused, setEditorFocused] = useState(false)
  const [layoutReady, setLayoutReady] = useState(false)
  const folderPickerPendingRef = useRef<{
    resolve: (folder: WorkspaceFolder | null) => void
  } | null>(null)
  const [projects, setProjects] = useState<JetProject[]>([])
  const folderSearchStateRef = useRef(
    new Map<string, { supported: boolean; scanReady: boolean }>(),
  )
  const lastContextFolderRef = useRef<WorkspaceFolder | null>(null)
  const [, setFolderSearchRev] = useState(0)
  const [fileDragOver, setFileDragOver] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarView, setSidebarView] = useState<JetSidebarView>(loadSidebarView)
  const [sidebarFocused, setSidebarFocused] = useState(false)
  const showWindowChrome = useMemo(() => detectWindowChrome(), [])
  const [, setTerminalSessionRevision] = useState(0)
  const sidebarFocusedRef = useRef(false)
  sidebarFocusedRef.current = sidebarFocused
  const sidebarViewRef = useRef<JetSidebarView>(sidebarView)
  sidebarViewRef.current = sidebarView
  const [recentCommands, setRecentCommands] = useState<string[]>(() => loadRecentCommands())
  const [pendingChordPrefix, setPendingChordPrefix] = useState<string | null>(null)
  const fontSizeRef = useRef(fontSize)
  fontSizeRef.current = fontSize
  const initialized = useRef(false)
  const queryBootstrapDone = useRef(false)
  const projectCatalogReadyRef = useRef(false)
  const startupRecordedRef = useRef(false)
  const openWorkspaceRef = useRef<(folderPath: string, opts?: OpenWorkspaceOptions) => void | Promise<void>>(
    () => {},
  )
  const addWorkspaceRef = useRef<(folderPath: string) => void>(() => {})
  const handleOpenFileRef = useRef<(uri: string, path: string) => void>(() => {})
  const workspaceInitGen = useRef(new Map<string, number>())
  const workspaceRootPathRef = useRef<string | null>(null)
  const workspaceLayoutStoreRef = useRef(new WorkspaceLayoutStore())
  const lastActiveRootUriRef = useRef<string | null>(null)
  const homeDirRef = useRef("")
  const workspaceInitCtxRef = useRef<JetInitContext | null>(null)
  const projectRegistry = useMemo(() => new ProjectRegistry(), [])
  const appStateRef = useRef({
    panelTree: null! as JetPanelTree,
    focusedPanel: null as PanelId | null,
    keymapContext: undefined as KeymapContext | undefined,
    activePanelKind: undefined as string | undefined,
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
    tabDndHandlers,
  } = usePanelLayout(workspace, tabStore, appStateRef as never)

  const agentSync = useAgentSync(workspace, tabStore, ENABLE_AGENT_CHAT)
  const {
    syncAgentThread,
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
    archiveAgentThread: archiveAgentThreadFromHook,
    unarchiveAgentThread: unarchiveAgentThreadFromHook,
    refreshAgentExplorerTab,
    findWorkspaceFolderByRootUri,
    removeAgentRoot,
  } = agentSync

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

  const lspRevisionRef = useRef(0)
  const keymapBindingsRef = useRef<JetKeyBinding[]>([])
  const userExtensionsRef = useRef<Extension[]>([])
  const keymapRevisionRef = useRef(0)
  const keymapContextRef = useRef<KeymapContext | undefined>(undefined)
  const openAgentThreadRef = useRef<(rootUri: string, threadId: string) => Promise<void>>(
    () => Promise.resolve(),
  )
  const createAgentThreadRef = useRef<(rootUri: string, rootPath: string) => Promise<void>>(
    () => Promise.resolve(),
  )
  const refreshAgentProvidersRef = useRef(refreshAgentProviders)
  refreshAgentProvidersRef.current = refreshAgentProviders
  const archiveAgentThreadRef = useRef(
    async (_rootUri: string, _rootPath: string, _threadId: string): Promise<void> => {},
  )
  const unarchiveAgentThreadRef = useRef(
    async (_rootUri: string, _rootPath: string, _threadId: string): Promise<void> => {},
  )
  const sendAgentMessageRef = useRef(sendAgentMessage)
  sendAgentMessageRef.current = sendAgentMessage
  const updateAgentThreadSettingsRef = useRef(updateAgentThreadSettings)
  updateAgentThreadSettingsRef.current = updateAgentThreadSettings
  const interruptAgentTurnRef = useRef(interruptAgentTurn)
  interruptAgentTurnRef.current = interruptAgentTurn
  const getTerminalExplorerGroupsRef = useRef<() => TerminalExplorerGroup[]>(() => [])
  const getActiveTerminalTabIdRef = useRef<() => string | null>(() => null)
  const focusTerminalTabRef = useRef<(panelId: PanelId, tabId: string) => void>(() => {})
  const newTerminalInWorkspaceRef = useRef<(rootUri: string) => Promise<void>>(async () => {})
  const closeTerminalTabRef = useRef<(panelId: PanelId, tabId: string) => void>(() => {})
  const onTerminalTitleChangeRef = useRef<(tabId: string, title: string) => void>(() => {})
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

  const onTerminalTitleChange = useCallback(
    (tabId: string, title: string) => {
      if (terminalSessionForTab(tabId)?.customLabel) return
      const existing = workspace.tabRegistry.get(tabId)
      if (!existing || existing.label === title) return
      workspace.tabRegistry.update(tabId, { label: title })
    },
    [workspace],
  )
  onTerminalTitleChangeRef.current = onTerminalTitleChange

  const tabContributorRef = useRef<TabContributorDeps>(null!)
  const tabContributorBridge = useMemo(
    () => createTabContributorBridge(() => tabContributorRef.current),
    [],
  )

  const resolveContextFolder = useCallback((): WorkspaceFolder | null => {
    const current = appStateRef.current
    return resolveContextWorkspaceFolder(
      current.panelTree,
      current.focusedPanel,
      workspace.tabRegistry,
      workspace,
      lastContextFolderRef.current,
    )
  }, [workspace])

  const getContextSearchState = useCallback(() => {
    const folder = resolveContextFolder()
    if (!folder) return { supported: false, scanReady: false }
    const state = folderSearchStateRef.current.get(folder.id)
    return { supported: state?.supported ?? false, scanReady: state?.scanReady ?? false }
  }, [resolveContextFolder])

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
  }, [panelTree, focusedPanel, workspace])

  const activeThemeRef = useRef(activeTheme)
  activeThemeRef.current = activeTheme

  useEffect(() => {
    registerBuiltinTabTypes(tabTypeRegistry, tabContributorBridge)
  }, [tabTypeRegistry, tabContributorBridge])

  const keybindingByFn = useMemo(() => {
    const map = new Map<JetKeyBinding["run"], string>()
    for (const binding of keymapBindings) {
      if (!map.has(binding.run)) map.set(binding.run, binding.key)
    }
    return map
  }, [keymapBindings])

  const fnByCommandId = FN_BY_COMMAND_ID

  const activePanelKind = focusedPanel ? panelViewKind(panelTree, focusedPanel) : undefined

  const activeTabKindName = useMemo(
    () => activeTabKind(panelTree, focusedPanel, workspace.tabRegistry),
    [focusedPanel, panelTree, workspace],
  )

  const activeEditorFile = useMemo(() => {
    if (!focusedPanel) return null
    const uri = getActiveEditorFileUri(panelTree, focusedPanel)
    if (!uri) return null
    const file = workspace.fileForUri(uri)
    if (!file) return null
    return { name: file.name, languageId: file.languageId, isDirty: file.isDirty }
  }, [focusedPanel, panelTree, workspace])

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
    editorPanelRef,
  }

  const {
    lspRevision,
    resolveLspClient,
    ensureLspForFile,
    handleLspAttachFailed,
    stopLspServersForRoot,
    lspStatus,
  } = useLspLifecycle(workspace, (uri, path, line, column) => {
    handleOpenFileRef.current(uri, path)
    if (line != null) {
      const panel = appStateRef.current.focusedPanel ?? editorPanelRef.current
      const view = panel ? getEditorView(panel) : null
      if (view) jumpToLine(view, line, column ?? 1)
    }
  })
  lspRevisionRef.current = lspRevision
  resolveLspClientRef.current = resolveLspClient
  handleLspAttachFailedRef.current = handleLspAttachFailed

  useTerminalLifecycle()

  useEffect(
    () => subscribeTerminalSessions(tabId => {
      tabStore.update(tabId, previous => ({ ...(previous as object) }))
      setTerminalSessionRevision(revision => revision + 1)
    }),
    [tabStore],
  )

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
      const snapshot = getAgentSnapshot(rootUri)
      const existingThread = getAgentThread(rootUri, threadId)
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
    [workspace, findWorkspaceFolderByRootUri, cloneTree, commitTree, loadAgentThread, tabStore, getAgentSnapshot, getAgentThread],
  )

  const openAgentsExplorer = useCallback(async (): Promise<void> => {
    const tree = cloneTree()
    const { panelId } = openAgentExplorerTab(workspace, tree, appStateRef.current.focusedPanel)
    commitTree(tree, panelId)
    requestAnimationFrame(() => {
      focusFirstListItem("jet:agent-explorer")
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

  const openFileFromSidebar = useCallback(
    (uri: string, path: string) => {
      const rootUri = workspace.resolveRootUriForFile(uri)
      if (rootUri && rootUri !== workspace.root?.uri) {
        activateProject(rootUri)
        requestAnimationFrame(() => handleOpenFileRef.current(uri, path))
        return
      }
      handleOpenFile(uri, path)
    },
    [workspace, activateProject, handleOpenFile],
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
      const focus = () => {
        const tree = cloneTree()
        const owningPanel = findPanelWithTab(tree, tabId) ?? panelId
        workspace.focusTabInPanel(tree, owningPanel, tabId)
        setFocusedPanel(owningPanel)
        commitTree(tree, owningPanel)
      }
      const rootUri = terminalCwdForTab(tabId)
      if (rootUri && rootUri !== workspace.root?.uri) {
        activateProject(rootUri)
        requestAnimationFrame(focus)
      } else {
        focus()
      }
    },
    [workspace, cloneTree, commitTree, activateProject, setFocusedPanel],
  )

  const openTerminalInWorkspace = useCallback(
    async (rootUri: string, opts?: { label?: string; launchCommand?: string }) => {
      if (rootUri && rootUri !== workspace.root?.uri) {
        activateProject(rootUri)
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
      const tree = cloneTree()
      const label = opts?.label ?? nextTerminalLabel(tree)
      const { panelId } = openTerminalTab(workspace, tree, appStateRef.current.focusedPanel, {
        cwdRootUri: rootUri,
        label,
        launchCommand: opts?.launchCommand,
      })
      setFocusedPanel(panelId)
      commitTree(tree, panelId)
    },
    [workspace, activateProject, cloneTree, commitTree, setFocusedPanel],
  )

  const newTerminalInWorkspace = useCallback(
    (rootUri: string) => openTerminalInWorkspace(rootUri),
    [openTerminalInWorkspace],
  )

  const launchAgentTerminal = useCallback(
    (rootUri: string, shortcut: TerminalAgentShortcut) => {
      void openTerminalInWorkspace(rootUri, {
        label: shortcut.label,
        launchCommand: shortcut.command,
      })
    },
    [openTerminalInWorkspace],
  )

  const closeTerminalTab = useCallback(
    (panelId: PanelId, tabId: string) => {
      const close = () => {
        const tree = cloneTree()
        const owningPanel = findPanelWithTab(tree, tabId) ?? panelId
        const view = tree.getView(owningPanel)
        if (view?.kind !== "tabs") return
        workspace.disposeTab(tabId)
        tabStore.dispose(tabId)
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

  const renameTerminal = useCallback(
    (tabId: string, label: string) => {
      setTerminalCustomLabel(tabId, label)
      workspace.tabRegistry.update(tabId, { label })
    },
    [workspace],
  )

  const duplicateTerminal = useCallback(
    (tabId: string) => {
      const session = terminalSessionForTab(tabId)
      if (!session) return
      const label = workspace.tabRegistry.get(tabId)?.label ?? "Terminal"
      void openTerminalInWorkspace(session.cwdRootUri, {
        label: `${label} copy`,
        launchCommand: terminalLaunchCommandForTab(tabId),
      })
    },
    [workspace, openTerminalInWorkspace],
  )

  const restartTerminal = useCallback((tabId: string) => {
    const ptyId = terminalPtyIdForTab(tabId)
    if (ptyId) void window.jet?.terminal?.dispose(ptyId)
    restartTerminalSession(tabId)
  }, [])

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

  const quickOpenSearch = useCallback(
    async (query: string, workspaceId: string | null) => {
      if (!window.jet?.search?.fileSearch) return []
      const folders = workspaceId
        ? workspace.folders.filter(folder => folder.id === workspaceId)
        : workspace.folders
      if (folders.length === 0) return []

      const panel = focusedPanel
      const activeUri = panel ? getActiveEditorFileUri(panelTree, panel) : null
      let currentFile: { folderId: string; relativePath: string } | undefined
      if (activeUri) {
        const abs = fileUriToPath(activeUri)
        const fileFolder = folders.find(folder => relativePathInFolder(folder.root.path, abs) != null)
        const rel = fileFolder ? relativePathInFolder(fileFolder.root.path, abs) : undefined
        if (fileFolder && rel != null) {
          currentFile = { folderId: fileFolder.id, relativePath: rel }
        }
      }

      return fileSearchAcrossFolders(folders, window.jet.search, query, {
        pageSize: 100,
        currentFile,
      })
    },
    [resolveContextFolder, focusedPanel, panelTree, workspace.folders],
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
    const views = getAllEditorViews()
    const currentProblems = collectProblemsFromViews(
      views.map(v => ({ uri: v.uri, view: v.view })),
    )
    workspace.ensureProblemsList()
    workspace.listStore.update(PROBLEMS_TAB_ID, { items: problemsToListItems(currentProblems) })
  }, [workspace])

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
      const normalized = normalizeAbsPath(folderPath)
      const existing = workspace.folders.find(
        folder => normalizeAbsPath(folder.root.path) === normalized,
      )
      const folder = await workspace.addFolder(folderPath)
      workspaceRootPathRef.current = folderPath
      if (!opts?.silent) {
        if (existing || opts?.replace || workspace.folders.length === 1) {
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
      const terminalEntries = getTerminalExplorerGroups()
        .find(group => group.rootUri === rootUri)?.terminals ?? []
      if (terminalEntries.length > 0) {
        const confirmed = await requestConfirm({
          title: `Remove ${folder.root.name}?`,
          description: `${terminalEntries.length} live terminal${terminalEntries.length === 1 ? "" : "s"} will be closed. Files and terminal sessions are not restored after relaunch.`,
          confirmLabel: "Remove Project",
          cancelLabel: "Cancel",
          destructive: true,
        })
        if (!confirmed) return false
        for (const entry of terminalEntries) {
          const ptyId = terminalPtyIdForTab(entry.tabId)
          if (ptyId) await window.jet?.terminal?.dispose(ptyId)
          workspace.disposeTab(entry.tabId)
          tabStore.dispose(entry.tabId)
          clearTerminalSession(entry.tabId)
        }
      }
      const rootPath = folder.root.path
      const prefix = `${normalizeAbsPath(rootPath)}/`

      const tree = cloneTree()
      for (const panel of getAllLeafPanels(tree)) {
        const view = tree.getView(panel)
        if (view?.kind !== "tabs") continue
        for (const tabId of panelTabIds(view)) {
          if (workspace.tabRegistry.kindFor(tabId) !== "editor") continue
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
      await stopLspServersForRoot(rootUri)
      folderSearchStateRef.current.delete(folderId)
      workspaceInitGen.current.delete(folderId)
      const removed = workspace.removeFolder(folderId)
      if (removed) {
        workspaceLayoutStoreRef.current.delete(rootUri)
        removeAgentRoot(rootUri)
        syncGlobalSearchState()
        showJetToast(`Removed ${folder.root.name}`)
      }
      return removed
    },
    [workspace, cloneTree, commitTree, stopLspServersForRoot, syncGlobalSearchState, tabStore, getTerminalExplorerGroups],
  )

  const removeProjectByRootUri = useCallback(
    (rootUri: string) => {
      const folder = workspace.folders.find(candidate => candidate.root.uri === rootUri)
      if (folder) void removeWorkspaceFolder(folder.id)
    },
    [workspace, removeWorkspaceFolder],
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
      if (projectCatalogReadyRef.current) {
        writeProjectCatalog(
          workspace.manager.folders,
          workspace.manager.activeFolder?.id ?? null,
        )
      }
    })
    return () => sub.dispose()
  }, [workspace, syncGlobalSearchState])

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

  const launchAgentTerminalRef = useRef(launchAgentTerminal)
  launchAgentTerminalRef.current = launchAgentTerminal

  tabContributorRef.current = {
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
    createAgentThread: (rootUri, rootPath) => createAgentThreadRef.current(rootUri, rootPath),
    sendAgentMessage: (rootUri, threadId, payload) =>
      sendAgentMessageRef.current(rootUri, threadId, payload),
    interruptAgentTurn: (rootUri, threadId) => interruptAgentTurnRef.current(rootUri, threadId),
    archiveAgentThread: (rootUri, rootPath, threadId) =>
      archiveAgentThreadRef.current(rootUri, rootPath, threadId),
    unarchiveAgentThread: (rootUri, rootPath, threadId) =>
      unarchiveAgentThreadRef.current(rootUri, rootPath, threadId),
    getTerminalExplorerGroups: () => getTerminalExplorerGroupsRef.current(),
    getActiveTerminalTabId: () => getActiveTerminalTabIdRef.current(),
    focusTerminalTab: (panelId, tabId) => focusTerminalTabRef.current(panelId, tabId),
    newTerminalInWorkspace: rootUri => newTerminalInWorkspaceRef.current(rootUri),
    launchAgentTerminal: (rootUri, shortcut) => launchAgentTerminalRef.current(rootUri, shortcut),
    closeTerminalTab: (panelId, tabId) => closeTerminalTabRef.current(panelId, tabId),
    onTerminalTitleChange: (tabId, title) => onTerminalTitleChangeRef.current(tabId, title),
    getSearchFolders: () => {
      const folder = resolveContextFolder()
      return folder ? [folder] : workspace.folders
    },
  }

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

  const renderPanelHeader = useCallback(
    (view: PanelView, panelId: PanelId, meta: { focused: boolean }) => (
      <PanelTabBar
        panelId={panelId}
        view={view}
        store={tabStore}
        registry={tabTypeRegistry}
        focused={meta.focused}
        windowChrome={showWindowChrome && isTopEdgePanel(panelTree, panelId)}
        windowChromeLeading={
          showWindowChrome && !sidebarOpen && isTopLeftPanel(panelTree, panelId)
        }
        showSidebarToggle={!sidebarOpen && isTopLeftPanel(panelTree, panelId)}
        onActivateTab={tabId => handlePanelEvent({ type: "tabActivate", panelId, tabId })}
        onCloseTab={tabId => handlePanelEvent({ type: "tabClose", panelId, tabId })}
      />
    ),
    [tabStore, tabTypeRegistry, handlePanelEvent, sidebarOpen, panelTree, showWindowChrome],
  )

  const renderPanelContent = useCallback(
    (view: PanelView, panelId: PanelId, meta: { focused: boolean }) => (
      <PanelBody
        panelId={panelId}
        view={view}
        store={tabStore}
        registry={tabTypeRegistry}
        focused={meta.focused}
      />
    ),
    [tabStore, tabTypeRegistry],
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
    const listId = sidebarFocusedRef.current
      ? sidebarViewRef.current === "terminal-explorer"
        ? "jet:terminal-explorer"
        : "jet:explorer"
      : listTabId
        ? listTabId
        : tabKind === "explorer"
          ? "jet:explorer"
          : null
    if (!listId) return

    const controller = getListPanelController(listId)
    if (!controller) return

    switch (action) {
      case "focusNext":
        controller.focusNext()
        break
      case "focusPrev":
        controller.focusPrev()
        break
      case "activate":
        controller.activate()
        break
      case "focusFirstItem":
        controller.focusFirstItem()
        break
      case "focusLastItem":
        controller.focusLastItem()
        break
      case "focusPageUp":
        controller.focusPageUp()
        break
      case "focusPageDown":
        controller.focusPageDown()
        break
      case "focusFirst":
        controller.focusFirst()
        break
      case "focusLast":
        controller.focusLast()
        break
      default:
        break
    }
  }, [workspace])

  const resetAppearanceWithToast = useCallback(() => {
    resetAppearanceSettings()
    showJetToast("Appearance reset")
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
        toggleSidebar: () => setSidebarOpen(open => !open),
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
      bind("ArrowDown", appCommands.listFocusNext, ctx => ctx.listFocus && noOverlay(ctx)),
      bind("ArrowUp", appCommands.listFocusPrev, ctx => ctx.listFocus && noOverlay(ctx)),
      bind("Enter", appCommands.listFocusActivate, ctx => ctx.listFocus && noOverlay(ctx)),
      bind("PageDown", appCommands.listFocusPageDown, ctx => ctx.listFocus && noOverlay(ctx)),
      bind("PageUp", appCommands.listFocusPageUp, ctx => ctx.listFocus && noOverlay(ctx)),
      bind("Home", appCommands.listFocusFirst, ctx => ctx.listFocus && noOverlay(ctx)),
      bind("End", appCommands.listFocusLast, ctx => ctx.listFocus && noOverlay(ctx)),
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
        "Mod-b",
        appCommands.toggleSidebar,
        ctx => ctx.workspaceOpen && noOverlay(ctx),
      ),
      bind(
        "F12",
        appCommands.goToDefinition,
        ctx => ctx.editorFocus && noOverlay(ctx),
      ),
      bind(
        "Shift-F12",
        appCommands.goToReferences,
        ctx => ctx.editorFocus && noOverlay(ctx),
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
    const disposables = APP_COMMAND_REGISTRY
      .filter(entry => ENABLE_AGENT_CHAT || !entry.id.startsWith("agent"))
      .map(entry => {
      const run = appCommands[entry.fn]
      if (!run) return null
      return commands.register(entry.id, run, {
        id: entry.id,
        title: entry.title,
        category: entry.category,
        aliases: "aliases" in entry ? [...entry.aliases] : undefined,
      })
      })
      .filter(Boolean)
    disposables.push(
      commands.register(
        "ui.toggleColorScheme",
        () => {
          setAppearanceSettings(prev => {
            const current = getThemeById(prev.themeId)
            const nextScheme: ColorScheme = current.scheme === "light" ? "dark" : "light"
            const next = siblingThemeForScheme(prev.themeId, nextScheme)
            showJetToast(`Theme: ${next.name}`)
            return { ...prev, themeId: next.id }
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
      commands.register(
        "terminal.duplicateActive",
        () => {
          const tabId = getActiveTerminalTabId()
          if (tabId) duplicateTerminal(tabId)
        },
        {
          id: "terminal.duplicateActive",
          title: "Duplicate Active Terminal",
          category: "Terminal",
        },
      ),
      commands.register(
        "terminal.restartActive",
        () => {
          const tabId = getActiveTerminalTabId()
          if (tabId) restartTerminal(tabId)
        },
        {
          id: "terminal.restartActive",
          title: "Restart Active Terminal",
          category: "Terminal",
        },
      ),
    )
    disposables.push(
      commands.register(
        "ui.setColorScheme.dark",
        () => {
          setAppearanceSettings(prev => {
            const next = siblingThemeForScheme(prev.themeId, "dark")
            showJetToast(`Theme: ${next.name}`)
            return { ...prev, themeId: next.id }
          })
        },
        { id: "ui.setColorScheme.dark", title: "Color Scheme: Dark", category: "UI" },
      ),
    )
    disposables.push(
      commands.register(
        "ui.setColorScheme.light",
        () => {
          setAppearanceSettings(prev => {
            const next = siblingThemeForScheme(prev.themeId, "light")
            showJetToast(`Theme: ${next.name}`)
            return { ...prev, themeId: next.id }
          })
        },
        { id: "ui.setColorScheme.light", title: "Color Scheme: Light", category: "UI" },
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
          aliases: ["preferences", "appearance", "font", "terminal settings"],
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
          aliases: ["themes", "colors", "ayu", "everforest", "gruvbox", "tokyonight"],
        },
      ),
    )
    for (const theme of bundledThemeList) {
      disposables.push(
        commands.register(
          `ui.setTheme.${theme.id}`,
          () => {
            setAppearanceSettings(prev => ({ ...prev, themeId: theme.id }))
            showJetToast(`Theme: ${theme.name}`)
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
    workspace,
    removeProjectByRootUri,
    getActiveTerminalTabId,
    duplicateTerminal,
    restartTerminal,
  ])

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
      activeEditorDirty: (() => {
        const panel = appStateRef.current.focusedPanel
        const tabId = getActiveTabId(appStateRef.current.panelTree, panel)
        if (!tabId || workspace.tabRegistry.kindFor(tabId) !== "editor") return false
        return workspace.fileForUri(tabId)?.isDirty ?? false
      })(),
      searchReady: (() => {
        const state = getContextSearchState()
        return state.supported && state.scanReady
      })(),
      executeCommand,
      openWorkspace: folderPath =>
        Promise.resolve(openWorkspaceRef.current(folderPath, { silent: true })),
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
    getContextSearchState,
  ])

  useEffect(() => {
    if (!layoutReady || queryBootstrapDone.current) return
    queryBootstrapDone.current = true
    void (async () => {
      const cfg = window.jet?.getLaunchConfig ? await window.jet.getLaunchConfig() : null
      const catalog = readProjectCatalog()
      const paths = catalog.projects.map(project => project.path)
      const explicitLaunch = cfg?.source === "explicit" || cfg?.source === "external" || !!cfg?.filePath

      if (cfg && (explicitLaunch || paths.length === 0)) {
        const launchPath = normalizeAbsPath(cfg.workspacePath)
        if (!paths.some(path => normalizeAbsPath(path) === launchPath)) paths.push(launchPath)
      }

      for (const path of paths) {
        try {
          await workspace.addFolder(path)
        } catch {
          showJetToast(`Could not restore ${path}`, { variant: "warning" })
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

      if (cfg?.filePath) {
        handleOpenFileRef.current(pathToFileUri(cfg.filePath), cfg.filePath)
      }
    })()
  }, [layoutReady, workspace])

  useEffect(() => {
    if (
      startupRecordedRef.current ||
      !layoutReady ||
      !projectCatalogReadyRef.current ||
      !workspace.manager.hasFolders() ||
      !window.jet?.recordStartup
    ) {
      return
    }
    startupRecordedRef.current = true
    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined
    const bootstrapAt =
      (window as Window & { __jetStartupBootstrapAt?: number }).__jetStartupBootstrapAt ?? 0
    void window.jet.recordStartup({
      shell: "tauri",
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

  const problemsFpRef = useRef("")
  const problemsRafRef = useRef<number | null>(null)
  const refreshProblems = useCallback(() => {
    const views = getAllEditorViews()
    const next = collectProblemsFromViews(views.map(v => ({ uri: v.uri, view: v.view })))
    const fp = problemsFingerprint(next)
    if (fp === problemsFpRef.current) return
    problemsFpRef.current = fp
    workspace.ensureProblemsList()
    workspace.listStore.update(PROBLEMS_TAB_ID, { items: problemsToListItems(next) })
  }, [workspace])

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
  }, [panelTree, scheduleRefreshProblems])

  executeCommandRef.current = executeCommand
  runKeyBindingRef.current = runKeyBinding
  refreshProblemsRef.current = scheduleRefreshProblems

  useEffect(() => {
    if (activeTabKindName !== "editor") setEditorCursor(null)
  }, [activeTabKindName])

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
      onGotoLineSubmit: (line, column) => {
        const panel = appStateRef.current.focusedPanel
        const view = panel ? getEditorView(panel) : null
        if (view) jumpToLine(view, line, column)
      },
      onQuickOpenSearch: quickOpenSearch,
      onQuickOpenSelect: (displayPath, query, workspaceId) => {
        const folders = workspaceId
          ? workspace.folders.filter(folder => folder.id === workspaceId)
          : workspace.folders
        const resolved = resolveQuickOpenDisplayPath(displayPath, folders)
        if (!resolved) return
        void window.jet?.search?.trackFileAccess?.(
          resolved.folder.root.uri,
          query,
          resolved.relativePath,
        )
        handleOpenFile(resolved.fileUri, resolved.fullPath)
      },
      onBufferSelect: uri => handleOpenFile(uri, fileUriToPath(uri)),
      onTerminalSelect: entry => focusTerminalTab(entry.panelId, entry.tabId),
      onOpenFile: handleOpenFile,
      onRequestOpenFolder: () => {
        setOpenFileOpen(false)
        void executeCommand("workspace.openFolder")
      },
      onFolderPickerSelect: handleFolderPickerSelect,
      onSelectFolder: path => openWorkspaceFolder(path, { replace: true }),
      onAddWorkspaceSelect: path => openWorkspaceFolder(path),
      onResetAppearanceSettings: resetAppearanceWithToast,
      onSelectProject: path => openWorkspaceFolder(path),
      onOutlineSelect: line => {
        const panel = appStateRef.current.focusedPanel
        const view = panel ? getEditorView(panel) : null
        if (view) jumpToLine(view, line, 1)
      },
      onRunCommand: id => {
        void executeCommand(id)
      },
      onFolderPickerOpenChange: handleFolderPickerOpenChange,
      resolveHomeDir: async () => {
        if (!window.jet?.getHomeDir) {
          throw new Error("window.jet.getHomeDir not available")
        }
        return window.jet.getHomeDir()
      },
    }),
    [
      setOpen,
      setAppearanceSettings,
      quickOpenSearch,
      handleOpenFile,
      setOpenFileOpen,
      executeCommand,
      handleFolderPickerSelect,
      openWorkspaceFolder,
      resetAppearanceWithToast,
      resolveContextFolder,
      workspace.folders,
      handleFolderPickerOpenChange,
    ],
  )

  const showOverlayHost =
    gotoLineOpen ||
    (quickOpenOpen && contextSearchState.supported) ||
    bufferListOpen ||
    terminalListOpen ||
    openFileOpen ||
    folderPickerOpen ||
    switchFolderOpen ||
    cdOpen ||
    addWorkspaceOpen ||
    settingsOpen ||
    projectSwitcherOpen ||
    outlineOpen ||
    paletteOpen

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
        outlineSymbols={outlineSymbols}
        searchSupported={contextSearchState.supported}
        searchScanReady={contextSearchState.scanReady}
        paletteCommands={paletteCommands}
        terminalGroups={getTerminalExplorerGroups()}
      />
    <TooltipProvider>
    <div className="h-full w-full" data-drag-over={fileDragOver || undefined}>
    <AppShell
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
            workspaceFolderNames={workspace.folders.map(folder => folder.root.name)}
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
        style={{ "--sidebar-width": WORKSPACE_SIDEBAR_WIDTH } as React.CSSProperties}
      >
        {sidebarOpen ? (
          <JetWorkspaceSidebar
            activeView={sidebarView}
            onActiveViewChange={handleSidebarViewChange}
            manager={workspace.manager}
            onOpenFile={openFileFromSidebar}
            onOpenFolder={() => executeCommand("workspace.openFolder")}
            onAddWorkspace={() => setAddWorkspaceOpen(true)}
            terminalExplorerGroups={getTerminalExplorerGroups()}
            activeProjectRootUri={workspace.root?.uri ?? null}
            activeTerminalTabId={getActiveTerminalTabId()}
            onActivateProject={activateProject}
            onFocusTerminal={focusTerminalTab}
            onNewTerminal={rootUri => void newTerminalInWorkspace(rootUri)}
            onLaunchAgentTerminal={launchAgentTerminal}
            onCloseTerminal={closeTerminalTab}
            onRenameTerminal={renameTerminal}
            onDuplicateTerminal={duplicateTerminal}
            onRestartTerminal={restartTerminal}
            onRemoveProject={removeProjectByRootUri}
            onSidebarFocusChange={setSidebarFocused}
            showWindowChrome={showWindowChrome}
          />
        ) : null}
        <SidebarInset className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {!workspace.manager.hasFolders() ? (
          <div className="h-full w-full bg-background" />
        ) : (
          <PanelDock<PanelView>
            tree={panelTree}
            focusedPanelId={focusedPanel}
            onFocusPanel={setFocusedPanel}
            onEvent={handlePanelEvent}
            tabDnd={tabDndHandlers}
            renderHeader={renderPanelHeader}
            renderContent={renderPanelContent}
          />
        )}
        </SidebarInset>
      </SidebarProvider>

      <Suspense fallback={null}>
        {showOverlayHost && <OverlayHost />}
      </Suspense>
      {focusedPanel ? <FindReplacePopover panelId={focusedPanel} /> : null}
      <ConfirmDialogHost />
      <Toaster position="bottom-right" />
    </AppShell>
    </div>
    </TooltipProvider>
    </OverlayControllerProvider>
  )
}
