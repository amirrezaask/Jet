import {
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useDeferredValue,
  type CSSProperties,
  type ReactElement,
} from "react"
import { createPortal } from "react-dom"
import { RegistryContext } from "@effect-atom/atom-react"
import { rosterAtom, notificationCenterAtom } from "./effect/atoms.js"
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
import type { MonacoEditorHandle } from "@gharargah/monaco"
import { agentDriverIdForMode } from "@gharargah/agents"
import type {
  AgentCliHistorySession,
  AppNotification,
  AgentProvider,
} from "@gharargah/shared"
import { createAgentBridge } from "./agent-bridge.js"
import { useNotificationCenter } from "./hooks/useNotificationCenter.js"
import {
  TabStore,
  TabTypeRegistry,
  PanelBody,
  bundledThemeList,
  formatKeyBinding,
  WhichKeyPanel,
  type WhichKeyEntry,
  TooltipProvider,
  ConfirmDialogHost,
  LiquidGlassFilter,
  Toaster,
  showGharargahToast,
  requestConfirm,
  AppShell,
  GharargahWindowTitlebar,
  GharagahSidebar,
  sidebarWidthStyle,
  mapHomeGroupsToSidebar,
  TerminalSessionModal,
  formatSessionHeaderTitle,
  AgentCliPickerOverlay,
  NotificationBell,
  NotificationCenter,
  SidebarProvider,
  SidebarInset,
  type AgentCliDriver,
  type OpenInAppId,
  type JetAppearanceSettings,
  type SessionDialogMode,
  type SidebarSession,
  ModalEditorPane,
  getEditorView,
  getEditorCursor,
  setEditorCursor,
  setEditorCursorStore,
  destroyEditorBuffer,
  ProjectTodosPane,
} from "@gharargah/ui"
import { SessionTerminalWorkspacePane } from "./SessionTerminalWorkspacePane.js"
import { HomeCardsWithAde } from "./HomeCardsWithAde.js"
import {
  setPendingEditorNavigation,
  setPendingInitialContent,
} from "@gharargah/monaco/pending"
import {
  openPathFromTerminal,
  resolvePathUnderRoot,
} from "./editor/code-editor-service.js"
import { ensureMonacoWorkersConfigured } from "./editor/monaco-workers.js"
import { bootstrapFromLaunch } from "./launch-bootstrap.js"
import { useFileDrop } from "./use-file-drop.js"
import {
  APP_COMMAND_REGISTRY,
  buildAppCommands,
  buildMacTerminalQuickSwitchBindings,
} from "./app-commands.js"
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
  terminalSessionNeedsCloseConfirmation,
  setTerminalCustomLabel,
  setAgentSessionTitle,
  bumpTerminalActivity,
  archiveSession,
  resumeArchivedSession,
  isSessionArchived,
  setAgentCliSessionId,
  updateTerminalLaunchArgs,
  trackTerminalPtyId,
} from "./tabs/terminal-session.js"
import {
  buildAgentCliLaunchArgs,
  buildAgentCliLaunchEnv,
  captureAgentCliSessionFromNotification,
  isAgentCliProvider,
  isPersistableAgentSession,
  prepareHydratedAgentCliFields,
  syncAgentCliLaunchArgs,
} from "./agent-cli-launch.js"
import {
  applyAgentStreamUnknown,
} from "./agent-snapshot-store.js"
import {
  isGenericAgentSessionTitle,
  shouldApplyAgentSessionTitle,
} from "./agent-session-title.js"
import {
  applySessionTitleFromAgentEvent,
  setAgentSessionTitleTabUpdater,
} from "./agent-session-title-bridge.js"
import {
  ensureAgentCliProcess,
  applyAgentCliResumeLaunchArgs,
  findExistingAgentCliHistorySession,
} from "./agent-cli-resume.js"
import {
  releaseActiveAgentWarmResumeToForeground,
  startActiveAgentCliWarmResume,
  type ActiveAgentWarmResumeRun,
} from "./background-agent-cli-resume.js"
import {
  buildAgentCliHistoryPrefetchTargets,
  ensureAgentCliHistory,
  peekAgentCliHistory,
  startAgentCliHistoryPrefetch,
  type AgentCliHistoryPrefetchRun,
} from "./background-agent-cli-history.js"
import { type PersistedSessionRoster } from "./session-roster-store.js"
import {
  loadServerSessionRoster,
  migrateLegacyLocalSessionRoster,
  saveServerSessionRoster,
} from "./server-sessions.js"
import { SessionRosterWriter } from "./session-roster-writer.js"
import { reconcileHydratedTerminalPtys } from "./probe-terminal-sessions.js"
import {
  getAllLeafPanels,
  resolveEditorPanel,
  getActiveTabId,
  getActiveEditorFileUri,
  closePanelIfEmpty,
} from "./panel-routing.js"
import { confirmCloseBuffer } from "./close-buffer.js"
import { openTerminalTab } from "./tab-routing.js"
import {
  buildTerminalExplorerGroups,
  nextTerminalLabel,
} from "./terminal-explorer.js"
import { loadGlobalJetrc } from "./load-global-gharargahrc.js"
import { WorkspaceLayoutStore } from "./workspace-layout-store.js"
import { swapWorkspaceLayout } from "./swap-workspace-layout.js"
import {
  loadServerProjectPaths,
  migrateLegacyLocalProjectCatalog,
  syncServerProjectCatalog,
} from "./server-projects.js"
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

const GitWorkspace = lazy(async () => {
  await ensureMonacoWorkersConfigured()
  return import("@gharargah/ui/git")
})
const SessionTabBar = lazy(() =>
  import("@gharargah/ui/session-tabs").then(module => ({
    default: module.SessionTabBar,
  })),
)
const FindReplacePopover = lazy(() =>
  import("@gharargah/ui/editor").then(module => ({
    default: module.FindReplacePopover,
  })),
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

function comparableAbsPath(p: string): string {
  return normalizeAbsPath(p)
    .replace(/\\/g, "/")
    .replace(/^\/private(?=\/(?:var|tmp)(?:\/|$))/, "")
}

/** Match a persisted cwd URI to a live folder when path forms differ (/var vs /private/var). */
function resolveWorkspaceRootUri(
  cwdRootUri: string,
  folders: ReadonlyArray<{ root: { uri: string; path: string } }>,
): string {
  if (folders.some(folder => folder.root.uri === cwdRootUri)) return cwdRootUri
  const cwdPath = normalizeAbsPath(fileUriToPath(cwdRootUri))
  const folder = folders.find(
    candidate =>
      comparableAbsPath(candidate.root.path) === comparableAbsPath(cwdPath),
  )
  return folder?.root.uri ?? cwdRootUri
}

function loadRecentCommands(): string[] {
  try {
    const raw = localStorage.getItem(COMMAND_RECENTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : []
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
  const atomRegistry = useContext(RegistryContext)
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
  const [terminalModalTabId, setTerminalModalTabId] = useState<string | null>(
    null,
  )
  const terminalModalTabIdRef = useRef(terminalModalTabId)
  terminalModalTabIdRef.current = terminalModalTabId
  const [terminalModalPanelId, setTerminalModalPanelId] =
    useState<PanelId | null>(null)
  const [terminalModalTitleTick, setTerminalModalTitleTick] = useState(0)
  const [terminalModalGitBranch, setTerminalModalGitBranch] = useState<
    string | null
  >(null)
  const [terminalSessionRevision, setTerminalSessionRevision] = useState(0)
  const notifications = useNotificationCenter()
  const notificationsRef = useRef(notifications)
  notificationsRef.current = notifications
  const [, setWorkspaceRevision] = useState(0)
  const [sessionMode, setSessionMode] = useState<SessionDialogMode>("terminal")
  const sessionModeRef = useRef(sessionMode)
  sessionModeRef.current = sessionMode
  const [gitFocusPath, setGitFocusPath] = useState<string | null>(null)
  const [agentCliPickerRootUri, setAgentCliPickerRootUri] = useState<
    string | null
  >(null)
  const [editorFocus, setEditorFocus] = useState(false)
  const [searchSupported, setSearchSupported] = useState(false)
  const [searchScanReady, setSearchScanReady] = useState(false)
  const [projectSearchOpen, setProjectSearchOpen] = useState(false)
  const [editorChromeTick, setEditorChromeTick] = useState(0)
  const [recentCommands, setRecentCommands] = useState<string[]>(() =>
    loadRecentCommands(),
  )
  const [pendingChordPrefix, setPendingChordPrefix] = useState<string | null>(
    null,
  )
  const fontSizeRef = useRef(fontSize)
  fontSizeRef.current = fontSize
  const initialized = useRef(false)
  const queryBootstrapDone = useRef(false)
  const projectCatalogReadyRef = useRef(false)
  const sessionRosterReadyRef = useRef(false)
  const startupRecordedRef = useRef(false)
  const activeAgentWarmResumeRef = useRef<ActiveAgentWarmResumeRun | null>(null)
  const agentCliHistoryPrefetchRef = useRef<AgentCliHistoryPrefetchRun | null>(
    null,
  )
  const openWorkspaceRef = useRef<
    (folderPath: string, opts?: OpenWorkspaceOptions) => void | Promise<void>
  >(() => {})
  const addWorkspaceRef = useRef<(folderPath: string) => Promise<void>>(
    async () => {},
  )
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

  const workspaceManager = useMemo(
    () => new WorkspaceManager(jetPlatformFS()),
    [],
  )
  const workspace = useMemo(
    () => new WorkspaceService(workspaceManager),
    [workspaceManager],
  )
  const commands = useMemo(() => new CommandRegistry(), [])
  const keymaps = useMemo(() => new KeymapService(), [])
  const tabTypeRegistry = useMemo(() => new TabTypeRegistry(), [])
  const tabStore = useMemo(
    () => new TabStore(tabTypeRegistry),
    [tabTypeRegistry],
  )

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
    (
      uri: string,
      path: string,
      line?: number,
      column?: number,
      endLine?: number,
      endColumn?: number,
    ) => void
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
  const keymapBindings = useMemo(
    () => keymaps.allBindings(),
    [keymaps, keymapRevision],
  )

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
        tabStore.create<{ fileUri: string }>(
          desc.kind,
          { fileUri: desc.id },
          desc.id,
        )
      } else if (desc.kind === "terminal") {
        tabStore.create<{ label: string; cwdRootUri: string }>(
          desc.kind,
          {
            label: desc.label,
            cwdRootUri: terminalCwdForTab(desc.id) || workspace.root?.uri || "",
          },
          desc.id,
        )
      }
    }
    const sub = workspace.tabRegistry.onDidChange.event(evt => mirror(evt.id))
    return () => sub.dispose()
  }, [workspace, tabStore])

  const activeThemeRef = useRef(activeTheme)
  activeThemeRef.current = activeTheme

  const getTerminalExplorerGroups = useCallback(() => {
      const trees = [appStateRef.current.panelTree]
      const activeRootUri = workspace.root?.uri ?? null
      for (const folder of workspace.folders) {
        if (folder.root.uri === activeRootUri) continue
        const saved = workspaceLayoutStoreRef.current.load(folder.root.uri)
        if (saved) trees.push(saved.tree)
      }
      return buildTerminalExplorerGroups(trees, workspace)
  }, [workspace])

  const activateProject = useCallback(
    (rootUri: string) => {
      const resolvedRootUri = resolveWorkspaceRootUri(
        rootUri,
        workspace.folders,
      )
      const folder = workspace.folders.find(
        candidate => candidate.root.uri === resolvedRootUri,
      )
      if (!folder) return
      workspace.setActiveFolder(folder.id)
      // Keep host index/watch rooted on the session project, not catalog[0].
      if (window.gharargah?.workspace)
        void window.gharargah.workspace.activate(folder.root.uri)
    },
    [workspace],
  )

  const folderForSessionTab = useCallback(
    (tabId: string | null): WorkspaceFolder | null => {
      if (!tabId) return null
      const cwdRootUri = resolveWorkspaceRootUri(
        terminalCwdForTab(tabId),
        workspace.folders,
      )
      if (!cwdRootUri) return null
      return (
        workspace.folders.find(folder => folder.root.uri === cwdRootUri) ?? null
      )
    },
    [workspace],
  )

  const setSessionModeSynced = useCallback(
    (mode: SessionDialogMode, sessionTabId?: string | null) => {
      const tabId =
        sessionTabId !== undefined
          ? sessionTabId
          : terminalModalTabIdRef.current
      const folder = folderForSessionTab(tabId)
      if (folder && folder.root.uri !== workspace.root?.uri) {
        activateProject(folder.root.uri)
      }
      setSessionMode(mode)
    },
    [activateProject, folderForSessionTab, workspace.root?.uri],
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
    (panelId: PanelId, tabId: string, mode?: SessionDialogMode) => {
      const session = terminalSessionForTab(tabId)
      const canShowAgent = Boolean(session?.agentId && session?.launchCommand)
      const requestedMode =
        mode ?? (canShowAgent && session?.agentId ? "agent" : "terminal")
      const resolvedMode =
        requestedMode === "agent" && !canShowAgent
          ? "terminal"
          : requestedMode
      // Modal view owns spawn — release warm-resume deferral for this tab.
      releaseActiveAgentWarmResumeToForeground(tabId)
      terminalModalTabIdRef.current = tabId
      setTerminalModalPanelId(panelId)
      setTerminalModalTabId(tabId)
      setSessionModeSynced(resolvedMode, tabId)
      notificationsRef.current.setViewingSessionId(tabId)
    },
    [setSessionModeSynced],
  )

  const closeTerminalModal = useCallback(() => {
    setTerminalModalTabId(null)
    setTerminalModalPanelId(null)
    notificationsRef.current.setViewingSessionId(null)
  }, [])

  const focusTerminalTab = useCallback(
    (panelId: PanelId, tabId: string, mode?: SessionDialogMode) => {
      // Dead/exited agent CLI → respawn with provider resume flags before open.
      // (Warm-resume release happens in openTerminalModal.)
      ensureAgentCliProcess(tabId)
      const focus = () => {
        const tree = cloneTree()
        const owningPanel = findPanelWithTab(tree, tabId) ?? panelId
        workspace.focusTabInPanel(tree, owningPanel, tabId)
        setFocusedPanel(owningPanel)
        commitTree(tree, owningPanel)
        openTerminalModal(owningPanel, tabId, mode)
      }
      const rootUri = resolveWorkspaceRootUri(
        terminalCwdForTab(tabId),
        workspace.folders,
      )
      if (rootUri && rootUri !== workspace.root?.uri) {
        activateProject(rootUri)
        requestAnimationFrame(focus)
      } else {
        focus()
      }
    },
    [
      workspace,
      cloneTree,
      commitTree,
      activateProject,
      setFocusedPanel,
      openTerminalModal,
    ],
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
      const session = terminalSessionForTab(tabId)
      const mode =
        Boolean(session?.agentId && session?.launchCommand)
          ? "agent"
          : "terminal"
      focusTerminalTab(panelId, tabId, mode)
    },
    [focusTerminalTab],
  )

  const openTerminalInWorkspace = useCallback(
    async (
      rootUri: string,
      opts?: {
        label?: string
        launchCommand?: string
        launchArgs?: string[] | ((tabId: string) => string[])
        launchEnv?: Record<string, string> | ((tabId: string) => Record<string, string>)
        agentId?: string
        agentTitle?: string
        agentDriverId?: string
        agentCliSessionId?: string
        pendingCliMint?: boolean
        lastActivityAt?: string
      },
    ) => {
      if (rootUri && rootUri !== workspace.root?.uri) {
        activateProject(rootUri)
        await new Promise<void>(resolve =>
          requestAnimationFrame(() => resolve()),
        )
      }
      const tree = cloneTree()
      const label = opts?.label ?? nextTerminalLabel(tree)
      const { panelId, tabId } = openTerminalTab(
        workspace,
        tree,
        appStateRef.current.focusedPanel,
        {
        cwdRootUri: rootUri,
        label,
        launchCommand: opts?.launchCommand,
        launchArgs: opts?.launchArgs,
        launchEnv: opts?.launchEnv,
        agentId: opts?.agentId,
        agentTitle: opts?.agentTitle,
        agentDriverId: opts?.agentDriverId,
        agentCliSessionId: opts?.agentCliSessionId,
        pendingCliMint: opts?.pendingCliMint,
        lastActivityAt: opts?.lastActivityAt,
      },
      )
      setFocusedPanel(panelId)
      commitTree(tree, panelId)
      return { panelId, tabId }
    },
    [workspace, activateProject, cloneTree, commitTree, setFocusedPanel],
  )

  const newSessionTab = useCallback((rootUri: string) => {
    setAgentCliPickerRootUri(rootUri)
  }, [])

  const createAgentSession = useCallback(
    async (rootUri: string, driver: AgentCliDriver) => {
      try {
        // Cursor: open interactive PTY immediately (same as other agents).
        // Hooks supply session_id later; roster write stays deferred until then.
        const deferRosterUntilCliId = driver.id === "cursor"
        const { panelId, tabId } = await openTerminalInWorkspace(rootUri, {
          label: driver.label,
          launchCommand: driver.command,
          launchArgs: nextTabId =>
            buildAgentCliLaunchArgs(
              driver.id,
              {
                sessionId: nextTabId,
                origin: window.location.origin,
                projectRoot: fileUriToPath(rootUri),
              },
              null,
            ),
          launchEnv: nextTabId =>
            buildAgentCliLaunchEnv(driver.id, {
              sessionId: nextTabId,
              origin: window.location.origin,
              projectRoot: fileUriToPath(rootUri),
            }),
          agentId: driver.id,
          agentTitle: driver.label,
          agentDriverId: agentDriverIdForMode(driver.id, "cli"),
          pendingCliMint: deferRosterUntilCliId,
        })
        // Project-local hooks for Codex/Cursor/OpenCode (idempotent merge).
        void window.gharargah?.agents
          ?.installProjectHooks?.({
            provider: driver.id,
            projectRoot: fileUriToPath(rootUri),
          })
          .catch(() => undefined)
        bindAgentToSession(tabId, {
          agentId: driver.id,
          driverId: agentDriverIdForMode(driver.id, "cli"),
        })
        openTerminalModal(panelId, tabId, "agent")
      } catch (err) {
        console.error("[gharargah] createAgentSession failed", err)
        showGharargahToast(err instanceof Error ? err.message : String(err), {
          variant: "destructive",
        })
        closeTerminalModal()
      }
    },
    [openTerminalInWorkspace, openTerminalModal, closeTerminalModal],
  )

  const loadAgentCliHistory = useCallback(
    (driver: AgentCliDriver, rootUri: string, signal: AbortSignal) => {
      const agents = window.gharargah?.agents
      if (!agents?.listCliSessions) {
        return Promise.reject(new Error("CLI session history is unavailable on this host"))
      }
      return ensureAgentCliHistory({
        listCliSessions: agents.listCliSessions.bind(agents),
        provider: driver.id,
        cwd: fileUriToPath(rootUri),
        limit: 50,
        signal,
      })
    },
    [],
  )

  const peekAgentCliHistoryForPicker = useCallback(
    (driver: AgentCliDriver, rootUri: string) =>
      peekAgentCliHistory(driver.id, fileUriToPath(rootUri)),
    [],
  )

  const prefetchAgentCliHistoryForFolders = useCallback(() => {
    const listCliSessions = window.gharargah?.agents?.listCliSessions
    if (!listCliSessions) return
    const targets = buildAgentCliHistoryPrefetchTargets(
      workspace.folders.map(folder => folder.root.path),
    )
    if (targets.length === 0) return
    const run = startAgentCliHistoryPrefetch({
      listCliSessions: listCliSessions.bind(window.gharargah!.agents!),
      targets,
    })
    agentCliHistoryPrefetchRef.current = run
    void run.done.then(summary => {
      if (agentCliHistoryPrefetchRef.current === run) {
        agentCliHistoryPrefetchRef.current = null
      }
      performance.measure("gharargah:agent-cli-history-prefetch", {
        start: performance.now() - summary.durationMs,
        end: performance.now(),
        detail: summary,
      })
    })
  }, [workspace])

  const resumeAgentCliHistorySession = useCallback(
    async (
      fallbackRootUri: string,
      driver: AgentCliDriver,
      history: AgentCliHistorySession,
    ) => {
      try {
        if (history.provider !== driver.id) {
          throw new Error("Provider session does not match the selected CLI")
        }

        const existing = findExistingAgentCliHistorySession(
          listTerminalSessions(),
          driver.id,
          history.id,
        )
        let existingPanel = existing
          ? findPanelWithTab(appStateRef.current.panelTree, existing.tabId)
          : null
        if (existing && !existingPanel) {
          const tree = cloneTree()
          const sessionKey = existing.tabId.startsWith(TERMINAL_TAB_ID_PREFIX)
            ? existing.tabId.slice(TERMINAL_TAB_ID_PREFIX.length)
            : existing.tabId
          const opened = openTerminalTab(
            workspace,
            tree,
            appStateRef.current.focusedPanel,
            {
              sessionKey,
              label:
                existing.customLabel ??
                existing.agentTitle ??
                history.title ??
                driver.label,
              cwdRootUri: existing.cwdRootUri,
              launchCommand: existing.launchCommand,
              launchArgs: existing.launchArgs,
              launchEnv: existing.launchEnv,
              agentId: existing.agentId,
              agentTitle: existing.agentTitle,
              agentDriverId: existing.agentDriverId,
              agentCliSessionId: existing.agentCliSessionId,
              lastActivityAt: existing.lastActivityAt,
            },
          )
          commitTree(tree, opened.panelId)
          existingPanel = opened.panelId
        }
        if (existing && existingPanel) {
          focusTerminalTab(existingPanel, existing.tabId, "agent")
          return
        }

        const cwd = history.cwd?.trim() || fileUriToPath(fallbackRootUri)
        const normalizedCwd = normalizeAbsPath(cwd)
        const rootUri = pathToFileUri(normalizedCwd)
        const knownProject = workspace.folders.some(
          folder => normalizeAbsPath(folder.root.path) === normalizedCwd,
        )
        if (!knownProject) {
          await openWorkspaceRef.current(normalizedCwd)
        }

        const { panelId, tabId } = await openTerminalInWorkspace(rootUri, {
          label: history.title || driver.label,
          launchCommand: driver.command,
          launchArgs: nextTabId =>
            buildAgentCliLaunchArgs(
              driver.id,
              {
                sessionId: nextTabId,
                origin: window.location.origin,
                projectRoot: normalizedCwd,
              },
              history.id,
            ),
          launchEnv: nextTabId =>
            buildAgentCliLaunchEnv(driver.id, {
              sessionId: nextTabId,
              origin: window.location.origin,
              projectRoot: normalizedCwd,
            }),
          agentId: driver.id,
          agentTitle: history.title || driver.label,
          agentDriverId: agentDriverIdForMode(driver.id, "cli"),
          agentCliSessionId: history.id,
          lastActivityAt: history.updatedAt ?? history.createdAt ?? undefined,
        })
        void window.gharargah?.agents
          ?.installProjectHooks?.({
            provider: driver.id,
            projectRoot: normalizedCwd,
          })
          .catch(() => undefined)
        bindAgentToSession(tabId, {
          agentId: driver.id,
          driverId: agentDriverIdForMode(driver.id, "cli"),
        })
        openTerminalModal(panelId, tabId, "agent")
      } catch (error) {
        console.error("[gharargah] resumeAgentCliHistorySession failed", error)
        showGharargahToast(error instanceof Error ? error.message : String(error), {
          variant: "destructive",
        })
      }
    },
    [
      workspace,
      cloneTree,
      commitTree,
      openTerminalInWorkspace,
      openTerminalModal,
      focusTerminalTab,
    ],
  )

  const ensureSessionModalOpen = useCallback(
    (rootUri: string | null) => {
      if (terminalModalTabIdRef.current) return
      const targetRootUri =
        rootUri ?? workspace.root?.uri ?? workspace.folders[0]?.root.uri ?? null
      if (!targetRootUri) return
      void openTerminalInWorkspace(targetRootUri).then(({ panelId, tabId }) => {
        openTerminalModal(panelId, tabId)
      })
    },
    [workspace, openTerminalInWorkspace, openTerminalModal],
  )

  const openFileInEditor = useCallback(
    (
      uri: string,
      path: string,
      line?: number,
      column?: number,
      endLine?: number,
      endColumn?: number,
    ) => {
      void ensureMonacoWorkersConfigured().then(() => {
        const tree = cloneTree()
        const existing = tree.findEditorPanelForFile(uri)
        const panel =
          existing ??
          resolveEditorPanel(
            tree,
            editorPanelRef.current,
            appStateRef.current.focusedPanel,
          ) ??
          editorPanelRef.current
        if (!panel) return
        editorPanelRef.current = panel
        workspace.assignEditorPanel(tree, panel, uri, path)
        if (line != null) {
          setPendingEditorNavigation(uri, {
            line,
            column: column ?? 1,
            endLine,
            endColumn,
          })
        }
        setFocusedPanel(panel)
        setSessionModeSynced("editor")
        commitTree(tree, panel)
        ensureSessionModalOpen(workspace.resolveRootUriForFile(uri))
        if (line != null) {
          requestAnimationFrame(() => {
            const view = getEditorView(panel)
            if (!view) return
            void import("@gharargah/monaco").then(
              ({ revealPosition, highlightRangeTemporarily }) => {
                revealPosition(view as MonacoEditorHandle, line, column ?? 1)
                if (endLine != null && endColumn != null) {
                  highlightRangeTemporarily(view as MonacoEditorHandle, {
                    startLineNumber: line,
                    startColumn: column ?? 1,
                    endLineNumber: endLine,
                    endColumn: endColumn,
                  })
                }
              },
            )
          })
        }
        void ensureLspForFile(uri)
      })
    },
    [
      cloneTree,
      commitTree,
      workspace,
      editorPanelRef,
      setFocusedPanel,
      setSessionModeSynced,
      ensureSessionModalOpen,
      ensureLspForFile,
    ],
  )

  openFileInEditorRef.current = openFileInEditor

  const newAgentTabFromHome = useCallback((rootUri: string) => {
    setAgentCliPickerRootUri(rootUri)
  }, [])

  const openTodosFromHome = useCallback(
    async (rootUri: string) => {
      try {
        const group = getTerminalExplorerGroups().find(
          g => g.rootUri === rootUri,
        )
        const existing = group?.terminals[0]
        if (existing) {
          focusTerminalTab(existing.panelId, existing.tabId, "todos")
          return
        }
        const { panelId, tabId } = await openTerminalInWorkspace(rootUri)
        openTerminalModal(panelId, tabId, "todos")
      } catch (err) {
        console.error("[gharargah] openTodosFromHome failed", err)
        showGharargahToast(err instanceof Error ? err.message : String(err), {
          variant: "destructive",
        })
      }
    },
    [
      getTerminalExplorerGroups,
      focusTerminalTab,
      openTerminalInWorkspace,
      openTerminalModal,
    ],
  )

  const openProjectInApp = useCallback(
    async (rootUri: string, appId: OpenInAppId) => {
    try {
      const shell = window.gharargah?.shell
      if (!shell?.openInApp) {
        throw new Error("Open in app is not available in this host")
      }
      await shell.openInApp(appId, rootUri)
    } catch (err) {
      console.error("[gharargah] openProjectInApp failed", err)
        showGharargahToast(err instanceof Error ? err.message : String(err), {
          variant: "destructive",
        })
    }
    },
    [],
  )

  const rosterWriter = useMemo(
    () => new SessionRosterWriter(saveServerSessionRoster),
    [],
  )
  const buildPersistedSessionRoster = useCallback((): PersistedSessionRoster => {
    const sessions = listTerminalSessions()
      .filter(isPersistableAgentSession)
      .map(session => ({
        tabId: session.tabId,
        cwdRootUri: session.cwdRootUri,
        label:
          session.customLabel ??
          session.agentTitle ??
          workspace.tabRegistry.get(session.tabId)?.label ??
          "Terminal",
        launchCommand: session.launchCommand,
        launchArgs: session.launchArgs,
        status: session.status,
        exitCode: session.exitCode,
        customLabel: session.customLabel,
        agentId: session.agentId,
        agentTitle: session.agentTitle,
        agentDriverId: session.agentDriverId,
        agentThreadId: session.agentThreadId,
        agentCliSessionId: session.agentCliSessionId,
        hasUserInput: session.hasUserInput,
        hasMeaningfulOutput: session.hasMeaningfulOutput,
        lastActivityAt: session.lastActivityAt,
        doneAt: session.archivedAt,
        transcript: session.archivedAt ? session.transcript : undefined,
      }))
    const persistedTabIds = new Set(sessions.map(session => session.tabId))
    const modalTabId = terminalModalTabIdRef.current
    return {
      version: 2,
      sessions,
      modal:
        modalTabId && persistedTabIds.has(modalTabId)
          ? { tabId: modalTabId, sessionMode: sessionModeRef.current }
          : null,
    }
  }, [workspace])
  const persistSessionRoster = useCallback(() => {
    if (!sessionRosterReadyRef.current) return
    const roster = buildPersistedSessionRoster()
    atomRegistry.set(rosterAtom, roster)
    rosterWriter.enqueue(roster)
  }, [buildPersistedSessionRoster, rosterWriter, atomRegistry])

  useEffect(() => {
    const api = window.gharargah?.notifications
    if (!api?.onEvent) return
    return api.onEvent(event => {
      if (event.type === "notification.counts-updated") {
        atomRegistry.set(notificationCenterAtom, {
          unreadCount: event.counts.totalUnread,
          lastEventAt: new Date().toISOString(),
        })
      } else if (event.type === "notification.created") {
        const prev = atomRegistry.get(notificationCenterAtom)
        atomRegistry.set(notificationCenterAtom, {
          unreadCount: prev.unreadCount + 1,
          lastEventAt: new Date().toISOString(),
        })
      }
      if (event.type !== "notification.created") return
      const n = event.notification
      if (n.sessionId && n.sessionTitle) {
        const titledSession = terminalSessionForTab(n.sessionId)
        if (
          !titledSession?.customLabel &&
          shouldApplyAgentSessionTitle(
            n.sessionTitle,
            titledSession?.agentTitle,
            titledSession?.agentId ?? n.provider,
          )
        ) {
          setAgentSessionTitle(n.sessionId, n.sessionTitle)
          workspace.tabRegistry.update(n.sessionId, { label: n.sessionTitle })
        }
      }
      if (!n.sessionId || !n.providerSessionId) return
      captureAgentCliSessionFromNotification(
        n.sessionId,
        n.provider,
        n.providerSessionId,
        (tabId, cliSessionId) => {
          setAgentCliSessionId(tabId, cliSessionId)
          const session = terminalSessionForTab(tabId)
          if (session?.agentId && isAgentCliProvider(session.agentId)) {
            updateTerminalLaunchArgs(
              tabId,
              syncAgentCliLaunchArgs(tabId, session.agentId, cliSessionId),
            )
          }
        },
      )
    })
  }, [atomRegistry, workspace])

  useEffect(() => {
    setAgentSessionTitleTabUpdater((tabId, label) => {
      workspace.tabRegistry.update(tabId, { label })
      persistSessionRoster()
    })
    return () => setAgentSessionTitleTabUpdater(null)
  }, [workspace, persistSessionRoster])

  useEffect(() => {
    const agentsApi = window.gharargah?.agents
    if (!agentsApi?.onEvent) return
    return agentsApi.onEvent(payload => {
      applyAgentStreamUnknown(payload)
      applySessionTitleFromAgentEvent(payload)
      if (
        payload.type === "agents.snapshot" &&
        payload.nativeSessionId &&
        payload.sessionId &&
        payload.snapshot
      ) {
        captureAgentCliSessionFromNotification(
          payload.sessionId,
          payload.snapshot.provider,
          payload.nativeSessionId,
          (tabId, cliSessionId) => {
            setAgentCliSessionId(tabId, cliSessionId)
            const session = terminalSessionForTab(tabId)
            if (session?.agentId && isAgentCliProvider(session.agentId)) {
              updateTerminalLaunchArgs(
                tabId,
                syncAgentCliLaunchArgs(tabId, session.agentId, cliSessionId),
              )
              // Roster needs the new agentCliSessionId — only then bump PTY revision.
              setTerminalSessionRevision(n => n + 1)
            }
          },
        )
      }
    })
  }, [workspace])

  useEffect(() => {
    const persistLatestOnPageHide = () => {
      if (!sessionRosterReadyRef.current) return
      const roster = buildPersistedSessionRoster()
      // The normal state subscription already persists intentional removal of
      // the final session. Do not let an unload-time empty snapshot overwrite
      // a newer server-side roster written by another client/test fixture.
      if (roster.sessions.length === 0) return
      atomRegistry.set(rosterAtom, roster)
      rosterWriter.enqueue(roster)
      rosterWriter.flush()
    }
    const retryWhenOnline = () => rosterWriter.flush()
    window.addEventListener("pagehide", persistLatestOnPageHide)
    window.addEventListener("online", retryWhenOnline)
    return () => {
      window.removeEventListener("pagehide", persistLatestOnPageHide)
      window.removeEventListener("online", retryWhenOnline)
    }
  }, [atomRegistry, buildPersistedSessionRoster, rosterWriter])

  const closeTerminalTab = useCallback(
    async (panelId: PanelId, tabId: string) => {
      const session = terminalSessionForTab(tabId)
      if (session && terminalSessionNeedsCloseConfirmation(session)) {
        const label =
          workspace.tabRegistry.get(tabId)?.label ??
          session.customLabel ??
          "Terminal"
        const confirmed = await requestConfirm({
          title: `End ${label}?`,
          description:
            "The running process will be stopped and this session will be removed.",
          confirmLabel: "End Session",
          cancelLabel: "Keep Running",
          destructive: true,
        })
        if (!confirmed) return
      }
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

  const archiveSessionFromHome = useCallback(
    async (_panelId: PanelId, tabId: string) => {
      const session = terminalSessionForTab(tabId)
      if (!session || isSessionArchived(tabId)) return
      const ptyId = terminalPtyIdForTab(tabId)
      if (session.agentId && !session.agentTitle) {
        setAgentSessionTitle(
          tabId,
          session.customLabel ??
            workspace.tabRegistry.get(tabId)?.label ??
            session.agentId,
        )
      }
      archiveSession(tabId)
      if (ptyId) void window.gharargah?.terminal?.dispose(ptyId)
      if (terminalModalTabIdRef.current === tabId) {
        setTerminalModalTabId(null)
        setTerminalModalPanelId(null)
      }
      setTerminalSessionRevision(revision => revision + 1)
      persistSessionRoster()
    },
    [persistSessionRoster, workspace],
  )

  const resumeArchivedSessionFromView = useCallback(
    (tabId: string) => {
      const session = terminalSessionForTab(tabId)
      if (!session?.archivedAt) return
      applyAgentCliResumeLaunchArgs(tabId)
      resumeArchivedSession(tabId)
      setTerminalSessionRevision(revision => revision + 1)
      persistSessionRoster()
    },
    [persistSessionRoster],
  )

  const onTerminalTitleChange = useCallback(
    (tabId: string, title: string) => {
      const session = terminalSessionForTab(tabId)
      if (session?.customLabel) return
      if (
        session?.agentId &&
        !shouldApplyAgentSessionTitle(title, session.agentTitle, session.agentId)
      ) {
        return
      }
      if (
        !session?.agentId &&
        session?.agentTitle &&
        !isGenericAgentSessionTitle(session.agentTitle)
      ) {
        return
      }
      const existing = workspace.tabRegistry.get(tabId)
      if (!existing || existing.label === title) return
      if (session?.agentId) {
        setAgentSessionTitle(tabId, title)
      }
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
    void window.gharargah.git
      .branch(rootUri)
      .then(branch => {
      if (!cancelled) setTerminalModalGitBranch(branch)
      })
      .catch(() => {
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
      terminalListOpen,
      agentCliPickerOpen: agentCliPickerRootUri != null,
      settingsOpen,
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
      terminalListOpen,
      agentCliPickerRootUri,
      settingsOpen,
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
        resolveEditorPanel(
          tree,
          editorPanelRef.current,
          appStateRef.current.focusedPanel,
        ) ?? editorPanelRef.current
      if (!panel) return
      editorPanelRef.current = panel
      const untitledUri = workspace.openUntitledInPanel(tree, panel, { label: name })
      setPendingInitialContent(untitledUri, content)
      setFocusedPanel(panel)
      setSessionModeSynced("editor")
      commitTree(tree, panel)
      ensureSessionModalOpen(workspace.root?.uri ?? null)
    },
    [
      workspace,
      cloneTree,
      commitTree,
      editorPanelRef,
      setFocusedPanel,
      setSessionModeSynced,
      ensureSessionModalOpen,
    ],
  )

  useFileDrop({
    fs: jetPlatformFS(),
    knownWorkspacePaths: workspace.folders.map(f => f.root.path),
    activeWorkspacePath:
      workspace.manager.activeFolder?.root.path ?? workspace.root?.path ?? null,
    normalizePath: normalizeAbsPath,
    openWorkspace: path =>
      void openWorkspaceRef.current(path, { replace: true, silent: true }),
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
        const session = terminalSessionForTab(tabId)
        const owningSessionTabId = session?.parentSessionTabId ?? tabId
        tabStore.update(owningSessionTabId, previous => ({
          ...(previous as object),
        }))
        setTerminalSessionRevision(revision => revision + 1)
        if (!session) return
        const owningSession =
          terminalSessionForTab(owningSessionTabId) ?? session
        const folder = workspace.folders.find(
          f => f.root.uri === owningSession.cwdRootUri,
        )
        const provider =
          (owningSession.agentId as AgentProvider | undefined) ?? null
        void notificationsRef.current.bindSession({
          sessionId: owningSessionTabId,
          projectId: folder?.id ?? owningSession.cwdRootUri,
          projectName: folder?.root.name ?? null,
          sessionTitle:
            owningSession.customLabel ??
            owningSession.agentTitle ??
            workspace.tabRegistry.get(owningSessionTabId)?.label ??
            null,
          provider,
          ptyId: session.ptyId ?? null,
        })
      }),
    [tabStore, workspace],
  )

  const openNotificationSession = useCallback(
    async (n: AppNotification) => {
      if (!n.sessionId) {
        showGharargahToast("This notification has no linked session", {
          variant: "warning",
        })
        await notifications.markRead(n.id)
        return
      }
      const session = terminalSessionForTab(n.sessionId)
      if (!session) {
        showGharargahToast("Session was removed — notification kept in history", {
          variant: "warning",
        })
        await notifications.markRead(n.id)
        return
      }
      const panelId =
        findPanelWithTab(panelTree, n.sessionId) ?? getAllLeafPanels(panelTree)[0]
      if (!panelId) return
      focusTerminalTab(panelId, n.sessionId)
      notifications.setOpen(false)
      await notifications.markRead(n.id)
    },
    [panelTree, focusTerminalTab, notifications],
  )
  const openNotificationSessionRef = useRef(openNotificationSession)
  openNotificationSessionRef.current = openNotificationSession

  useEffect(() => {
    persistSessionRoster()
  }, [
    persistSessionRoster,
    terminalModalTabId,
    sessionMode,
    terminalSessionRevision,
  ])

  // Document title badge
  useEffect(() => {
    const base = "YAADE"
    const unread = notifications.counts.totalUnread
    document.title = unread > 0 ? `(${unread}) ${base}` : base
  }, [notifications.counts.totalUnread])

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

  const pickWorkspaceFolder = useCallback(
    (folders: WorkspaceFolder[]) => {
    return new Promise<WorkspaceFolder | null>(resolve => {
      folderPickerPendingRef.current = { resolve }
      setFolderPickerOpen(true)
    })
    },
    [setFolderPickerOpen],
  )

  const handleFolderPickerOpenChange = useCallback(
    (open: boolean) => {
    setFolderPickerOpen(open)
    if (!open && folderPickerPendingRef.current) {
      folderPickerPendingRef.current.resolve(null)
      folderPickerPendingRef.current = null
    }
    },
    [setFolderPickerOpen],
  )

  const handleFolderPickerSelect = useCallback(
    (folder: WorkspaceFolder) => {
    folderPickerPendingRef.current?.resolve(folder)
    folderPickerPendingRef.current = null
    setFolderPickerOpen(false)
    },
    [setFolderPickerOpen],
  )

  const activateFolderBackground = useCallback(
    (folderId: string, folderPath: string) => {
      const gen = (workspaceInitGen.current.get(folderId) ?? 0) + 1
      workspaceInitGen.current.set(folderId, gen)

      const finishOpen = () => {
        if (workspaceInitGen.current.get(folderId) !== gen) return
        const folder = workspace.manager.folders.find(f => f.id === folderId)
        const rootUri = folder?.root.uri
        if (!rootUri) return
        if (window.gharargah?.workspace)
          void window.gharargah.workspace.activate(rootUri)
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
      const terminalEntries =
        getTerminalExplorerGroups().find(group => group.rootUri === rootUri)
          ?.terminals ?? []
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
    async (rootUri: string): Promise<boolean> => {
      const folder = workspace.folders.find(
        candidate => candidate.root.uri === rootUri,
      )
      if (!folder) return false
      return removeWorkspaceFolder(folder.id)
    },
    [workspace, removeWorkspaceFolder],
  )

  useEffect(() => {
    const sub = workspace.manager.onDidChangeFolders.event(() => {
      if (!projectCatalogReadyRef.current) return
      void syncServerProjectCatalog(workspace.manager.folders).catch(() => {
        showGharargahToast("Could not persist the project catalog", {
          variant: "warning",
        })
      })
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

  const fnByCommandId = FN_BY_COMMAND_ID

  const getCommandContext = useCallback(
    (viewOverride?: MonacoEditorHandle): JetCommandContext => {
    return {
      workspace,
      ui: {
        showMessage: showGharargahToast,
        showCommandPalette: () => setPaletteOpen(true),
        setCommandPaletteOpen: setPaletteOpen,
      },
      getActiveEditorView: () => {
        if (viewOverride) return viewOverride
          const panel =
            editorPanelRef.current ?? appStateRef.current.focusedPanel
        return panel ? (getEditorView(panel) ?? null) : null
      },
    }
    },
    [workspace, setPaletteOpen, editorPanelRef],
  )

  const resetAppearanceWithToast = useCallback(() => {
    resetAppearanceSettings()
    showGharargahToast("Appearance reset")
  }, [resetAppearanceSettings])

  const toggleSidebar = useCallback(() => {
    setAppearanceSettings(prev => {
      if (prev.sessionLayout !== "sidebar") {
        return {
          ...prev,
          sessionLayout: "sidebar",
          sidebarCollapsed: false,
        }
      }
      return { ...prev, sidebarCollapsed: !prev.sidebarCollapsed }
    })
  }, [setAppearanceSettings])

  const appCommands = useMemo(
    () =>
      buildAppCommands({
        workspace,
        getPanelTree: () => appStateRef.current.panelTree,
        getFocusedPanel: () => appStateRef.current.focusedPanel,
        setPaletteOpen,
        setQuickOpenOpen,
        setProjectSearchOpen,
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
        setSessionMode: setSessionModeSynced,
        getContextFolder: () =>
          folderForSessionTab(terminalModalTabIdRef.current) ??
          workspace.manager.activeFolder,
        getSearchSupported: () => searchSupported,
        goHome,
        openSessionPicker: (rootUri: string) => {
          setAgentCliPickerRootUri(rootUri)
        },
        resolveSessionNewRootUri: () => {
          const active = workspace.manager.activeFolder?.root.uri
          if (active) return active
          const folder = workspace.folders[0]?.root.uri
          if (folder) return folder
          const project = projectRegistry.list()[0]
          return project ? pathToFileUri(project.path) : null
        },
        resolveLspClient,
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
      setSessionModeSynced,
      folderForSessionTab,
      handlePanelEvent,
      openFileInEditor,
      searchSupported,
      setQuickOpenOpen,
      setBufferListOpen,
      setOpenFileOpen,
      setGotoLineOpen,
      resolveLspClient,
    ],
  )

  const deferredPanelTree = useDeferredValue(panelTree)

  const paletteBaseCommands = useMemo(() => {
    void deferredPanelTree
    const extraKeyByRun = new Map<JetKeyBinding["run"], string>()
    for (const binding of keymapBindings) {
      if (!extraKeyByRun.has(binding.run)) extraKeyByRun.set(binding.run, binding.key)
    }
    const list = commands.list(getCommandContext()).map(cmd => {
      const fnName = fnByCommandId.get(cmd.id)
      const run = fnName
        ? appCommands[fnName as keyof typeof appCommands]
        : cmd.id === "ui.toggleSidebar"
          ? toggleSidebar
          : undefined
      const key = run ? extraKeyByRun.get(run) : undefined
      return {
        ...cmd,
        keybinding: key ? formatKeyBinding(key) : undefined,
        recent: false,
      }
    })
    list.sort((a, b) => a.title.localeCompare(b.title))
    return list
  }, [
    commands,
    deferredPanelTree,
    appCommands,
    keymapBindings,
    fnByCommandId,
    getCommandContext,
    toggleSidebar,
  ])

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
    for (const entry of APP_COMMAND_REGISTRY)
      fnToTitle.set(entry.fn, entry.title)
    const runToFn = new Map<JetKeyBinding["run"], string>()
    for (const [fnName, run] of Object.entries(appCommands))
      runToFn.set(run, fnName)
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
      entries.push({
        key: formatKeyBinding(second),
        desc: title ?? fnName ?? second,
      })
    }
    return entries
  }, [keymapBindings, pendingChordPrefix, appCommands])

  const runKeyBinding = useCallback(
    (binding: JetKeyBinding, view?: MonacoEditorHandle) => {
      void binding.run(getCommandContext(view))
    },
    [getCommandContext],
  )

  const executeCommandRef = useRef<(name: string) => Promise<void>>(() =>
    Promise.resolve(),
  )

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
      setEditorCursorStore({ line, column, rangeCount }),
    onLspAttachFailed: handleLspAttachFailed,
    onProblemsChange: () => {},
    closeTerminalTab,
    onTerminalTitleChange,
    onOpenPath: (cwdRootUri, rawPath, line, column) => {
      const cwdPath = fileUriToPath(cwdRootUri)
      const fullPath = resolvePathUnderRoot(cwdPath, rawPath)
      const fileUri = pathToFileUri(fullPath)
      if (!workspace.resolveRootUriForFile(fileUri)) return
      openPathFromTerminal(openFileInEditorRef.current, cwdPath, rawPath, line, column)
    },
  }

  useEffect(() => {
    const noOverlay = (ctx: KeymapContext) => !anyOverlayOpen(ctx)
    const whenWorkspace = (ctx: KeymapContext) =>
      ctx.workspaceOpen && noOverlay(ctx)
    // Mission Control keymap (Mod = ⌘ mac / Ctrl elsewhere):
    // Mod-n new session · Mod-k switch session · Mod-p quick open ·
    // Mod-b toggle sidebar · Mod-Shift-g git · Mod-Shift-p palette · Mod-o path open ·
    // Mod-Shift-e/t/d editor/terminal/todos · Mod-, settings
    keymaps.registerUser([
      bind("Mod-n", appCommands.sessionNew, noOverlay),
      bind("Mod-k", appCommands.terminalList, noOverlay),
      bind("Mod-p", appCommands.quickOpen, whenWorkspace),
      bind("Mod-Shift-f", appCommands.search, whenWorkspace),
      bind("Mod-b", toggleSidebar, noOverlay),
      bind("Mod-Shift-g", appCommands.showGit, whenWorkspace),
      bind("Mod-Shift-p", appCommands.palette, noOverlay),
      bind("Mod-o", appCommands.openFile, noOverlay),
      bind("Mod-w", appCommands.closeTab, whenWorkspace),
      bind("Ctrl-`", appCommands.terminal, whenWorkspace),
      bind("Mod-=", appCommands.zoomIn, noOverlay),
      bind("Mod--", appCommands.zoomOut, noOverlay),
      bind("Mod-Shift-o", appCommands.quickOpen, whenWorkspace),
      bind("Mod-s", appCommands.save, whenWorkspace),
      bind("Mod-f", appCommands.find, ctx => ctx.editorFocus && noOverlay(ctx)),
      bind(
        "Mod-h",
        appCommands.replace,
        ctx => ctx.editorFocus && noOverlay(ctx),
      ),
      bind(
        "Mod-g",
        appCommands.gotoLine,
        ctx => ctx.editorFocus && noOverlay(ctx),
      ),
      bind(
        "Alt-j",
        appCommands.goBack,
        ctx => ctx.editorFocus && noOverlay(ctx),
      ),
      bind(
        "Alt-Shift-j",
        appCommands.goForward,
        ctx => ctx.editorFocus && noOverlay(ctx),
      ),
      bind("Mod-Shift-b", appCommands.bufferList, whenWorkspace),
      bind("Mod-Shift-e", appCommands.showEditor, whenWorkspace),
      bind("Mod-Shift-t", appCommands.showTerminal, whenWorkspace),
      bind("Mod-Shift-d", appCommands.showTodos, whenWorkspace),
      bind("Mod-,", () => {
        setSettingsOpen(true)
      }, noOverlay),
      bind("Mod-Shift-n", () => {
        notificationsRef.current.setOpen(true)
      }, noOverlay),
      ...buildMacTerminalQuickSwitchBindings({
        workspace,
        getTerminalExplorerGroups,
        focusTerminalTab,
        setMessage: showGharargahToast,
      }),
      bind(
        "Escape",
        appCommands.goHome,
        ctx =>
          noOverlay(ctx) && !ctx.paletteOpen && !terminalModalTabIdRef.current,
      ),
      bind("Mod-Shift-h", appCommands.goHome, ctx => noOverlay(ctx)),
    ])
  }, [
    keymaps,
    appCommands,
    workspace,
    getTerminalExplorerGroups,
    focusTerminalTab,
    setSettingsOpen,
    toggleSidebar,
  ])

  useEffect(() => {
    if (!layoutReady) return
    void (async () => {
      const fetchScanRoots = async (): Promise<string[]> => {
        if (window.gharargah?.loadGlobalGharargahrcScanRoots) {
          if (window.gharargah.getHomeDir)
            homeDirRef.current = await window.gharargah.getHomeDir()
          return window.gharargah.loadGlobalGharargahrcScanRoots()
        }
        const res = await fetch("/__gharargah/globalGharargahrc/scanRoots")
        if (!res.ok) return []
        const data = (await res.json()) as {
          scanRoots?: string[]
          homeDir?: string
        }
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
      commands.register("settings.show", () => setSettingsOpen(true), {
          id: "settings.show",
          title: "Settings",
          category: "UI",
          aliases: ["preferences", "appearance", "font", "theme"],
      }),
    )
    disposables.push(
      commands.register(
        "notifications.show",
        () => notificationsRef.current.setOpen(true),
        {
          id: "notifications.show",
          title: "Open Notification Center",
          category: "Notifications",
          aliases: ["bell", "alerts", "inbox"],
        },
      ),
      commands.register(
        "notifications.markAllRead",
        () => void notificationsRef.current.markAllVisibleRead(),
        {
          id: "notifications.markAllRead",
          title: "Mark Visible Notifications as Read",
          category: "Notifications",
        },
      ),
      commands.register(
        "notifications.nextUnread",
        () => {
          const n = notificationsRef.current
          const unread = n.items.filter(i => i.status === "unread")
          if (unread.length === 0) {
            n.setOpen(true)
            return
          }
          const idx = unread.findIndex(i => i.id === n.selectedId)
          const next = unread[(idx + 1) % unread.length]!
          n.setSelectedId(next.id)
          n.setOpen(true)
        },
        {
          id: "notifications.nextUnread",
          title: "Next Unread Notification",
          category: "Notifications",
        },
      ),
      commands.register(
        "notifications.prevUnread",
        () => {
          const n = notificationsRef.current
          const unread = n.items.filter(i => i.status === "unread")
          if (unread.length === 0) {
            n.setOpen(true)
            return
          }
          const idx = unread.findIndex(i => i.id === n.selectedId)
          const prev =
            unread[idx <= 0 ? unread.length - 1 : idx - 1]!
          n.setSelectedId(prev.id)
          n.setOpen(true)
        },
        {
          id: "notifications.prevUnread",
          title: "Previous Unread Notification",
          category: "Notifications",
        },
      ),
      commands.register(
        "notifications.openSelected",
        () => {
          const n = notificationsRef.current
          const item = n.items.find(i => i.id === n.selectedId) ?? n.items[0]
          if (item) void openNotificationSessionRef.current(item)
        },
        {
          id: "notifications.openSelected",
          title: "Open Selected Notification",
          category: "Notifications",
        },
      ),
      commands.register(
        "notifications.markSelectedRead",
        () => {
          const id = notificationsRef.current.selectedId
          if (id) void notificationsRef.current.markRead(id)
        },
        {
          id: "notifications.markSelectedRead",
          title: "Mark Selected Notification Read",
          category: "Notifications",
        },
      ),
      commands.register(
        "notifications.dismissSelected",
        () => {
          const id = notificationsRef.current.selectedId
          if (id) void notificationsRef.current.dismiss(id)
        },
        {
          id: "notifications.dismissSelected",
          title: "Dismiss Selected Notification",
          category: "Notifications",
        },
      ),
    )
    disposables.push(
      commands.register("ui.showThemePicker", () => setSettingsOpen(true), {
          id: "ui.showThemePicker",
          title: "Theme Picker",
          category: "UI",
          aliases: ["themes", "colors"],
      }),
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
            aliases: [theme.family ?? "", theme.scheme ?? "", "theme"].filter(
              Boolean,
            ),
          },
        ),
      )
    }
    disposables.push(
      commands.register("ui.resetAppearance", resetAppearanceSettings, {
          id: "ui.resetAppearance",
          title: "Reset Appearance",
          category: "UI",
          aliases: ["reset theme", "reset font"],
      }),
    )
    disposables.push(
      commands.register("ui.toggleSidebar", toggleSidebar, {
        id: "ui.toggleSidebar",
        title: "Toggle Sidebar",
        category: "UI",
        aliases: ["collapse sidebar", "show sidebar", "hide sidebar"],
      }),
    )
    for (const layout of ["cards", "tabs", "sidebar"] as const) {
      const title =
        layout === "cards" ? "Cards" : layout === "tabs" ? "Tabs" : "Sidebar"
      disposables.push(
        commands.register(
          `ui.setSessionLayout.${layout}`,
          () => {
            setAppearanceSettings(previous => ({
              ...previous,
              sessionLayout: layout,
            }))
            showGharargahToast(`Session layout: ${title}`)
          },
          {
            id: `ui.setSessionLayout.${layout}`,
            title: `Session Layout: ${title}`,
            category: "UI",
            aliases: ["home layout", "sessions", layout],
          },
        ),
      )
    }
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
    toggleSidebar,
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
      addWorkspace: folderPath =>
        Promise.resolve(addWorkspaceRef.current(folderPath)),
      listWorkspaces: () =>
        workspace.manager.folders.map(f => ({
          id: f.id,
          path: f.root.path,
          name: f.root.name,
        })),
      setFontSize,
      openFile: (uri, path) => openFileInEditor(uri, path),
      getEditorText: () => {
        const panel = editorPanelRef.current ?? appStateRef.current.focusedPanel
        const view = panel ? getEditorView(panel) : null
        return view?.getModel()?.getValue() ?? null
      },
      setEditorSelection: (line, column) => {
        const panel = editorPanelRef.current ?? appStateRef.current.focusedPanel
        const view = panel ? getEditorView(panel) : null
        if (view) {
          void import("@gharargah/monaco").then(({ revealPosition }) => {
            revealPosition(view as MonacoEditorHandle, line, column)
          })
        }
      },
      getCursorPosition: () => {
        const panel = editorPanelRef.current ?? appStateRef.current.focusedPanel
        const pos = panel ? getEditorCursor(panel) : null
        return pos ? { line: pos.line, column: pos.column } : null
      },
      getSelectionRangeCount: () => {
        const panel = editorPanelRef.current ?? appStateRef.current.focusedPanel
        const editor = panel ? getEditorView(panel) : null
        return editor?.getSelections?.()?.length ?? null
      },
      activeEditorDirty: (() => {
        const panel = editorPanelRef.current ?? appStateRef.current.focusedPanel
        const fileUri = panel
          ? getActiveEditorFileUri(appStateRef.current.panelTree, panel)
          : null
        return fileUri
          ? (workspace.fileForUri(fileUri)?.isDirty ?? false)
          : false
      })(),
      searchReady: searchScanReady,
      sessionMode: terminalModalTabId ? sessionMode : null,
      sessionLayout: appearanceSettings.sessionLayout,
      agentChatEnabled: false,
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
    appearanceSettings.sessionLayout,
  ])

  useEffect(() => {
    return () => {
      activeAgentWarmResumeRef.current?.cancel()
      agentCliHistoryPrefetchRef.current?.cancel()
    }
  }, [])

  useEffect(() => {
    if (!layoutReady || queryBootstrapDone.current) return
    queryBootstrapDone.current = true
    void (async () => {
      const cfg = window.gharargah?.getLaunchConfig
        ? await window.gharargah.getLaunchConfig()
        : null
      await migrateLegacyLocalProjectCatalog().catch(() => {})
      const paths = [
        ...(await loadServerProjectPaths().catch(() => [] as string[])),
      ]
      const explicitLaunch =
        cfg?.source === "explicit" ||
        cfg?.source === "external" ||
        !!cfg?.filePath

      if (cfg && (explicitLaunch || paths.length === 0)) {
        const launchPath = normalizeAbsPath(cfg.workspacePath)
        if (!paths.some(path => normalizeAbsPath(path) === launchPath))
          paths.push(launchPath)
      }

      for (const path of paths) {
        try {
          await workspace.addFolder(path)
        } catch {
          showGharargahToast(`Could not restore ${path}`, {
            variant: "warning",
          })
        }
      }

      const activePath = explicitLaunch
        ? (cfg?.workspacePath ?? null)
        : (cfg?.workspacePath ?? paths[0] ?? null)
      if (activePath) {
        const normalized = normalizeAbsPath(activePath)
        const active = workspace.folders.find(
          folder => normalizeAbsPath(folder.root.path) === normalized,
        )
        if (active) workspace.setActiveFolder(active.id)
      }

      projectCatalogReadyRef.current = true
      await syncServerProjectCatalog(workspace.manager.folders).catch(() => {})
      await migrateLegacyLocalSessionRoster().catch(() => {})

      const roster = await loadServerSessionRoster().catch(
        (): PersistedSessionRoster => ({
          version: 2,
          sessions: [],
          modal: null,
        }),
      )
      if (roster.sessions.length > 0) {
        const tree = cloneTree()
        for (const entry of roster.sessions) {
          if (entry.agentId && !entry.launchCommand?.trim()) continue
          if (entry.agentId && !isAgentCliProvider(entry.agentId)) continue
          if (findPanelWithTab(tree, entry.tabId)) continue
          const sessionKey = entry.tabId.startsWith(TERMINAL_TAB_ID_PREFIX)
            ? entry.tabId.slice(TERMINAL_TAB_ID_PREFIX.length)
            : entry.tabId
          const cwdRootUri = resolveWorkspaceRootUri(
            entry.cwdRootUri,
            workspace.folders,
          )
          const hydrated = prepareHydratedAgentCliFields({
            tabId: entry.tabId,
            cwdRootUri,
            agentId: entry.agentId,
            agentDriverId: entry.agentDriverId,
            agentCliSessionId: entry.agentCliSessionId,
            launchCommand: entry.launchCommand,
            launchArgs: entry.launchArgs,
            status: entry.status,
            archivedAt: entry.doneAt,
            origin: window.location.origin,
          })
          const cliSessionId =
            hydrated.agentCliSessionId ?? entry.agentCliSessionId
          openTerminalTab(workspace, tree, appStateRef.current.focusedPanel, {
            sessionKey,
            label: entry.label,
            cwdRootUri,
            launchCommand: hydrated.launchCommand,
            launchArgs: hydrated.launchArgs,
            launchEnv: hydrated.launchEnv,
            agentId: entry.agentId,
            agentTitle: entry.agentTitle ?? entry.label,
            agentDriverId: entry.agentDriverId,
            agentCliSessionId: cliSessionId,
            lastActivityAt: entry.lastActivityAt,
          })
          hydrateTerminalSession({
            tabId: entry.tabId,
            cwdRootUri,
            launchCommand: hydrated.launchCommand,
            launchArgs: hydrated.launchArgs,
            launchEnv: hydrated.launchEnv,
            ptyId: hydrated.ptyId,
            status: hydrated.status,
            exitCode: entry.exitCode,
            customLabel: entry.customLabel,
            agentId: entry.agentId,
            agentTitle: entry.agentTitle ?? entry.label,
            agentDriverId: entry.agentDriverId,
            agentThreadId: entry.agentThreadId,
            agentCliSessionId: cliSessionId,
            hasUserInput: entry.hasUserInput,
            hasMeaningfulOutput: entry.hasMeaningfulOutput,
            lastActivityAt: entry.lastActivityAt,
            archivedAt: entry.doneAt,
            transcript: entry.transcript,
          })
        }
        commitTree(tree)
        setTerminalSessionRevision(revision => revision + 1)

        const deadTabIds = await reconcileHydratedTerminalPtys(
          window.gharargah?.terminal,
        )
        // Sessions are never pruned on reload — reconcile only marks missing PTYs
        // unavailable so cards stay active / archived. deadTabIds is always empty.
        void deadTabIds

        const terminalApi = window.gharargah?.terminal
        if (terminalApi) {
          const warmResume = startActiveAgentCliWarmResume({
            terminal: terminalApi,
            origin: window.location.origin,
            sessions: listTerminalSessions(),
            getSession: terminalSessionForTab,
            onPtyCreated: trackTerminalPtyId,
            onJobSettled: tabId => {
              tabStore.update(tabId, previous => ({ ...(previous as object) }))
            },
          })
          activeAgentWarmResumeRef.current = warmResume
          void warmResume.done.then(summary => {
            if (activeAgentWarmResumeRef.current === warmResume) {
              activeAgentWarmResumeRef.current = null
            }
            performance.measure("gharargah:active-agent-warm-resume", {
              start: performance.now() - summary.durationMs,
              end: performance.now(),
              detail: summary,
            })
          })
        }

        if (roster.modal) {
          const panelId = findPanelWithTab(tree, roster.modal.tabId)
          if (panelId) {
            setTerminalModalPanelId(panelId)
            setTerminalModalTabId(roster.modal.tabId)
            releaseActiveAgentWarmResumeToForeground(roster.modal.tabId)
            const restoredSession = roster.sessions.find(
              entry => entry.tabId === roster.modal?.tabId,
            )
            let restoredMode = roster.modal.sessionMode
            const isCliAgent = Boolean(
              restoredSession?.agentId && restoredSession?.launchCommand,
            )
            if (restoredMode === "agent" && !isCliAgent) {
              restoredMode = "terminal"
            }
            setSessionModeSynced(restoredMode)
          }
        }

        setTerminalSessionRevision(revision => revision + 1)
      }

      sessionRosterReadyRef.current = true
      persistSessionRoster()
      prefetchAgentCliHistoryForFolders()
    })()
  }, [
    layoutReady,
    workspace,
    cloneTree,
    commitTree,
    persistSessionRoster,
    tabStore,
    prefetchAgentCliHistoryForFolders,
    setSessionModeSynced,
  ])

  useEffect(() => {
    if (!layoutReady || !projectCatalogReadyRef.current) return
    prefetchAgentCliHistoryForFolders()
  }, [layoutReady, workspace.folders.length, prefetchAgentCliHistoryForFolders])
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
      (window as Window & { __gharargahStartupBootstrapAt?: number })
        .__gharargahStartupBootstrapAt ?? 0
    void window.gharargah
      .recordStartup({
      shell: "web",
      buildMode: import.meta.env.DEV ? "development" : "production",
      rendererBootstrapMs: bootstrapAt,
      rendererReadyMs: performance.now(),
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      loadEventMs: navigation?.loadEventEnd ?? null,
      workspaceRootCount: workspace.folders.length,
      })
      .catch(() => {
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

  const handleAppearanceSettingsChange = useCallback(
    (next: JetAppearanceSettings) => {
      const leavingInline =
        (appearanceSettings.sessionLayout === "tabs" ||
          appearanceSettings.sessionLayout === "sidebar") &&
        next.sessionLayout === "cards"
      if (leavingInline) {
        closeTerminalModal()
      }
      setAppearanceSettings(next)
    },
    [
      appearanceSettings.sessionLayout,
      closeTerminalModal,
      setAppearanceSettings,
    ],
  )

  const overlayHandlers = useMemo(
    (): OverlayHandlers => ({
      setOverlayOpen: setOpen,
      onAppearanceSettingsChange: handleAppearanceSettingsChange,
      onTerminalSelect: entry => focusTerminalTab(entry.panelId, entry.tabId),
      onRequestOpenFolder: () => {
        void executeCommand("workspace.openFolder")
      },
      onFolderPickerSelect: handleFolderPickerSelect,
      onSelectFolder: path => openWorkspaceFolder(path, { replace: true }),
      onAddWorkspaceSelect: path => {
        const pickerWasOpen = agentCliPickerRootUri != null
        void openWorkspaceFolder(path).then(() => {
          if (pickerWasOpen) {
            setAgentCliPickerRootUri(pathToFileUri(normalizeAbsPath(path)))
          }
        })
      },
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
        if (view) {
          void import("@gharargah/monaco").then(({ revealPosition }) => {
            revealPosition(view as MonacoEditorHandle, line, column ?? 1)
          })
        }
      },
      onQuickOpenSearch: async (query, workspaceId) => {
        if (!window.gharargah?.search) return []
        const folders = workspaceId
          ? workspace.folders.filter(f => f.id === workspaceId)
          : workspace.folders
        const activeFileUri = editorPanelRef.current
          ? getActiveEditorFileUri(
              appStateRef.current.panelTree,
              editorPanelRef.current,
            )
          : null
        const currentFile = (() => {
          if (!activeFileUri) return undefined
          const folder = workspaceId
            ? workspace.folders.find(f => f.id === workspaceId)
            : workspace.manager.activeFolder
          if (!folder) return undefined
          const rel = relativePathInFolder(
            folder.root.path,
            fileUriToPath(activeFileUri),
          )
          return rel != null
            ? { folderId: folder.id, relativePath: rel }
            : undefined
        })()
        return fileSearchAcrossFolders(
          folders,
          window.gharargah.search,
          query,
          { currentFile },
        )
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
      defaultQuickOpenWorkspaceId:
        folderForSessionTab(terminalModalTabId)?.id ??
        workspace.manager.activeFolder?.id ??
        null,
      searchSupported,
      searchScanReady,
    }),
    [
      setOpen,
      handleAppearanceSettingsChange,
      focusTerminalTab,
      executeCommand,
      handleFolderPickerSelect,
      folderForSessionTab,
      terminalModalTabId,
      openWorkspaceFolder,
      agentCliPickerRootUri,
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
  const editorPanelView = editorPanelId
    ? panelTree.getView(editorPanelId)
    : null
  const editorTabIds =
    editorPanelView?.kind === "tabs"
      ? panelTabIds(editorPanelView).filter(
          id => id.startsWith("file:") || id.startsWith("untitled:"),
        )
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
    editorPanelView?.kind === "tabs" &&
    editorTabIds.includes(editorPanelView.activeTabId)
      ? editorPanelView.activeTabId
      : (editorTabIds.at(-1) ?? null)
  const modalMonacoEditorHandle: PanelView | null =
    editorPanelId && editorActiveTabId
    ? { kind: "tabs", activeTabId: editorActiveTabId, tabIds: editorTabIds }
    : null
  const terminalGroups = getTerminalExplorerGroups()
  const sessionTabs = terminalGroups.flatMap(group =>
    group.terminals.map(terminal => ({
      tabId: terminal.tabId,
      panelId: terminal.panelId,
      title: terminal.label,
      projectName: group.name,
      status: terminal.status,
      agentId: terminal.agentId,
    })),
  )
  const homeGroupsForSidebar = useMemo(
    () =>
      terminalGroups.map(g => ({
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
          archivedAt: t.archivedAt,
        })),
      })),
    [terminalGroups],
  )
  const lastActivityBySession = useMemo(() => {
    const map: Record<string, string> = {}
    for (const s of listTerminalSessions()) {
      if (s.lastActivityAt) map[s.tabId] = s.lastActivityAt
    }
    return map
  }, [terminalSessionRevision])
  const { projects: sidebarProjects, sessions: sidebarSessions } = useMemo(
    () =>
      mapHomeGroupsToSidebar(homeGroupsForSidebar, {
        unreadBySession: notifications.unreadBySession,
        lastActivityBySession,
      }),
    [
      homeGroupsForSidebar,
      notifications.unreadBySession,
      lastActivityBySession,
    ],
  )
  const newSessionRootUri =
    (terminalModalTabId ? terminalCwdForTab(terminalModalTabId) : null) ??
    workspace.manager.activeFolder?.root.uri ??
    workspace.root?.uri ??
    workspace.folders[0]?.root.uri ??
    ""

  const openSidebarSession = useCallback(
    (session: SidebarSession) => {
      openTerminalFromHome(session.panelId, session.id)
      if (session.unreadCount > 0) {
        void notifications.markSessionRead(session.id)
      }
    },
    [openTerminalFromHome, notifications],
  )

  const renameSidebarSession = useCallback(
    (session: SidebarSession) => {
      const next = window.prompt("Rename session", session.title)?.trim()
      if (!next || next === session.title) return
      setTerminalCustomLabel(session.id, next)
      workspace.tabRegistry.update(session.id, { label: next })
      bumpTerminalActivity(session.id)
      setTerminalSessionRevision(r => r + 1)
    },
    [workspace],
  )

  const isSidebarLayout = appearanceSettings.sessionLayout === "sidebar"
  const isInlineWorkspace =
    appearanceSettings.sessionLayout === "tabs" || isSidebarLayout
  const [sidebarWorkspaceHost, setSidebarWorkspaceHost] =
    useState<HTMLDivElement | null>(null)
  const desktopWindowChrome =
    window.gharargahDesktop?.windowChrome?.customTitlebar === true
      ? window.gharargahDesktop.windowChrome
      : null
  const windowTitle = terminalModalTabId
    ? (workspace.tabRegistry.get(terminalModalTabId)?.label ?? "Session")
    : "Mission Control"

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
        terminalGroups={terminalGroups}
      />
      <TooltipProvider>
        <AppShell
          footer={
            pendingChordPrefix ? (
              <WhichKeyPanel
                prefix={formatKeyBinding(pendingChordPrefix)}
                entries={whichKeyEntries}
              />
            ) : undefined
          }
        >
          <div
            className="flex h-full min-h-0 w-full flex-col"
            data-gharargah-shell="home"
            data-gharargah-session-layout={appearanceSettings.sessionLayout}
            style={
              desktopWindowChrome
                ? ({
                    "--gharargah-window-chrome-height": `${desktopWindowChrome.titlebarHeight}px`,
                  } as CSSProperties)
                : undefined
            }
          >
            {desktopWindowChrome ? (
              <GharargahWindowTitlebar
                platform={desktopWindowChrome.platform}
                title={windowTitle}
                sidebar={
                  isSidebarLayout
                    ? {
                        collapsed: appearanceSettings.sidebarCollapsed,
                        width: appearanceSettings.sidebarWidth,
                      }
                    : null
                }
              />
            ) : null}
            {appearanceSettings.sessionLayout === "tabs" ? (
              <div
                data-gharargah-liquid-glass="chrome"
                className="flex items-center gap-1 border-b border-transparent bg-transparent pe-2"
              >
                <div className="min-w-0 flex-1">
                  <Suspense
                    fallback={
                      <div className="h-10 shrink-0" />
                    }
                  >
                    <SessionTabBar
                      sessions={sessionTabs}
                      activeTabId={terminalModalTabId}
                      onSelect={openTerminalFromHome}
                      onClose={closeTerminalTab}
                      newSessionRootUri={newSessionRootUri}
                      onNewTab={rootUri => void newSessionTab(rootUri)}
                    />
                  </Suspense>
                </div>
                <NotificationBell
                  counts={notifications.counts}
                  onClick={() => notifications.setOpen(true)}
                />
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-hidden">
              {appearanceSettings.sessionLayout === "cards" ? (
              <HomeCardsWithAde
                  groups={terminalGroups.map(g => ({
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
                      archivedAt: t.archivedAt,
                  })),
                }))}
                unreadBySession={notifications.unreadBySession}
                onOpenTerminal={openTerminalFromHome}
                onNewSession={rootUri => void newAgentTabFromHome(rootUri)}
                  onOpenInApp={(rootUri, appId) =>
                    void openProjectInApp(rootUri, appId)
                  }
                onRemoveProject={removeProjectByRootUri}
                onKillTerminal={closeTerminalTab}
                onArchiveSession={archiveSessionFromHome}
                onOpenTodos={rootUri => void openTodosFromHome(rootUri)}
                notificationBell={
                  <NotificationBell
                    counts={notifications.counts}
                    onClick={() => notifications.setOpen(true)}
                  />
                }
                onViewProjectNotifications={projectId =>
                  notifications.openFiltered({ projectId })
                }
                onViewSessionNotifications={sessionId =>
                  notifications.openFiltered({ sessionId })
                }
              />
              ) : null}

              {isSidebarLayout ? (
                <SidebarProvider
                  open={!appearanceSettings.sidebarCollapsed}
                  onOpenChange={open =>
                    setAppearanceSettings(prev => ({
                      ...prev,
                      sidebarCollapsed: !open,
                    }))
                  }
                  style={sidebarWidthStyle(appearanceSettings.sidebarWidth)}
                  className="h-full min-h-0"
                >
                  <div className="flex h-full min-h-0 w-full">
                    <GharagahSidebar
                      projects={sidebarProjects}
                      sessions={sidebarSessions}
                      projectFilterId={
                        appearanceSettings.sidebarProjectFilterPath
                      }
                      onProjectFilterIdChange={id =>
                        setAppearanceSettings(prev => ({
                          ...prev,
                          sidebarProjectFilterPath: id,
                        }))
                      }
                      selectedSessionId={terminalModalTabId}
                      onSelectSession={openSidebarSession}
                      onNewSession={rootUri => {
                        const target =
                          rootUri ??
                          workspace.manager.activeFolder?.root.uri ??
                          workspace.folders[0]?.root.uri ??
                          ""
                        if (target) {
                          void newAgentTabFromHome(target)
                        }
                      }}
                      notificationBell={
                        <NotificationBell
                          counts={notifications.counts}
                          onClick={() => notifications.setOpen(true)}
                          className="size-8 shrink-0 rounded-lg"
                        />
                      }
                      onSidebarWidthChange={widthPx =>
                        setAppearanceSettings(prev => ({
                          ...prev,
                          sidebarWidth: widthPx,
                        }))
                      }
                      showWindowChrome={desktopWindowChrome != null}
                      sessionActions={{
                        onOpen: openSidebarSession,
                        onRename: renameSidebarSession,
                        onMarkRead: s =>
                          void notifications.markSessionRead(s.id),
                        onArchive: s =>
                          void archiveSessionFromHome(s.panelId, s.id),
                      }}
                      projectActions={{
                        onNewSession: project =>
                          void newAgentTabFromHome(project.rootUri),
                        onOpenProject: project => {
                          void openWorkspaceFolder(
                            fileUriToPath(project.rootUri) ?? project.path,
                            { replace: false },
                          )
                        },
                        onRevealFolder: project => {
                          void window.gharargah?.shell?.revealInFolder?.(
                            project.rootUri,
                          )
                        },
                        onRemoveProject: project => {
                          const filterPath =
                            appearanceSettings.sidebarProjectFilterPath
                          if (
                            filterPath != null &&
                            normalizeAbsPath(filterPath) ===
                              normalizeAbsPath(project.path)
                          ) {
                            setAppearanceSettings(prev => ({
                              ...prev,
                              sidebarProjectFilterPath: null,
                            }))
                          }
                          void removeProjectByRootUri(project.rootUri)
                        },
                      }}
                      onOpenSettings={() => setSettingsOpen(true)}
                      serverLabel={
                        /^(localhost|127\.0\.0\.1|\[::1\])(?::|$)/.test(window.location.host)
                          ? "Local host"
                          : window.location.host
                      }
                    />
                    <SidebarInset className="flex min-h-0 flex-col overflow-hidden bg-transparent">
                      <div
                        ref={setSidebarWorkspaceHost}
                        className="relative min-h-0 flex-1 overflow-hidden p-0"
                        data-gharargah-sidebar-workspace=""
                      />
                    </SidebarInset>
                  </div>
                </SidebarProvider>
              ) : null}

            <div
              id="gharargah-notification-live"
              className="sr-only"
              aria-live="polite"
              aria-atomic="true"
            />

            {terminalModalTabId && terminalModalPanelId
              ? ((node: ReactElement) =>
                  isSidebarLayout && sidebarWorkspaceHost
                    ? createPortal(node, sidebarWorkspaceHost)
                    : node)(
                  <TerminalSessionModal
                    sessionId={terminalModalTabId}
                    open
                    presentation={isInlineWorkspace ? "inline" : "modal"}
                    windowChrome={desktopWindowChrome}
                    headerEnd={
                      <NotificationBell
                        counts={notifications.counts}
                        onClick={() => notifications.setOpen(true)}
                        className="size-7 shrink-0 rounded-md"
                      />
                    }
                    onOpenChange={open => {
                      if (!open) closeTerminalModal()
                    }}
                    title={(() => {
                      void terminalModalTitleTick
                      void editorChromeTick
                      const rootUri = terminalCwdForTab(terminalModalTabId)
                      const project = workspace.folders.find(
                        f => f.root.uri === rootUri,
                      )?.root.name
                      if (sessionMode === "editor") {
                        const fileLabel = editorActiveTabId
                        ? (workspace.fileForUri(editorActiveTabId)?.name ??
                          tabStore.title(editorActiveTabId))
                          : "Editor"
                        return formatSessionHeaderTitle(project, fileLabel)
                      }
                      if (sessionMode === "agent") {
                        const session = terminalSessionForTab(terminalModalTabId)
                        return (
                          session?.customLabel ??
                          session?.agentTitle ??
                          workspace.tabRegistry.get(terminalModalTabId)?.label ??
                          "Agent"
                        )
                      }
                      if (sessionMode === "git")
                        return formatSessionHeaderTitle(project, "Git")
                      if (sessionMode === "todos")
                        return formatSessionHeaderTitle(project, "TODOs")
                      const label =
                        workspace.tabRegistry.get(terminalModalTabId)?.label ??
                        "Terminal"
                      return formatSessionHeaderTitle(project, label)
                    })()}
                    gitBranch={terminalModalGitBranch}
                    projectRootUri={
                      terminalCwdForTab(terminalModalTabId) || null
                    }
                    launchCommand={
                      terminalSessionForTab(terminalModalTabId)?.launchCommand ??
                      null
                    }
                    status={
                      terminalSessionForTab(terminalModalTabId)?.status ?? null
                    }
                    archivedAt={
                      terminalSessionForTab(terminalModalTabId)?.archivedAt ?? null
                    }
                    onResumeArchived={() =>
                      resumeArchivedSessionFromView(terminalModalTabId)
                    }
                    mode={sessionMode}
                    showAgentTab={(() => {
                      const session = terminalSessionForTab(terminalModalTabId)
                      return Boolean(session?.agentId && session?.launchCommand)
                    })()}
                    agentId={(() => {
                      const id =
                        terminalSessionForTab(terminalModalTabId)?.agentId
                      return id === "claude" ||
                        id === "codex" ||
                        id === "cursor" ||
                        id === "opencode" ||
                        id === "grok"
                        ? id
                        : null
                    })()}
                onModeChange={mode => {
                  const terminalSession =
                    terminalSessionForTab(terminalModalTabId)
                  const canShowAgent = Boolean(
                    terminalSession?.agentId && terminalSession?.launchCommand,
                  )
                  if (mode === "agent" && !canShowAgent) {
                    return
                  }
                  setSessionModeSynced(mode)
                }}
                  onOpenInApp={(rootUri, appId) =>
                    void openProjectInApp(rootUri, appId)
                  }
                agent={
                  terminalSessionForTab(terminalModalTabId)?.agentId &&
                  terminalSessionForTab(terminalModalTabId)?.launchCommand ? (
                    <div
                      key={`${terminalModalTabId}:${terminalSessionForTab(terminalModalTabId)?.archivedAt ?? "active"}`}
                      className="h-full min-h-0 min-w-0"
                      data-gharargah-session-pane="agent"
                    >
                      <PanelBody
                        panelId={terminalModalPanelId}
                        view={
                          {
                            kind: "tabs",
                            activeTabId: terminalModalTabId,
                            tabIds: [terminalModalTabId],
                          } as PanelView
                        }
                        store={tabStore}
                        registry={tabTypeRegistry}
                        focused={sessionMode === "agent"}
                      />
                    </div>
                  ) : null
                }
                editor={
                  <ModalEditorPane
                    buffers={editorBuffers}
                    activeTabId={editorActiveTabId}
                    workspace={workspace}
                    lspStatus={lspStatus}
                    headerActive={sessionMode === "editor"}
                    getSearchFolders={() => {
                      const folder = folderForSessionTab(terminalModalTabId)
                      if (folder) return [folder]
                      const active = workspace.manager.activeFolder
                      return active ? [active] : workspace.folders
                    }}
                    onActivateBuffer={tabId => {
                      if (!editorPanelId) return
                        handlePanelEvent({
                          type: "tabActivate",
                          panelId: editorPanelId,
                          tabId,
                        })
                    }}
                    onCloseBuffer={tabId => {
                      void (async () => {
                          if (!(await confirmCloseBuffer(workspace, tabId)))
                            return
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
                    onQuickOpen={() =>
                        void executeCommand("workspace.quickOpen")
                      }
                      projectSearchOpen={projectSearchOpen}
                      onProjectSearchOpenChange={setProjectSearchOpen}
                      onOpenSearchItem={item => {
                        setPendingEditorNavigation(item.fileUri, {
                          line: item.line,
                          column: item.column,
                        })
                        openFileInEditor(
                          item.fileUri,
                          fileUriToPath(item.fileUri),
                          item.line,
                          item.column,
                        )
                      }}
                      onCommandPalette={() =>
                        void executeCommand("ui.showCommandPalette")
                      }
                  >
                    {editorPanelId && modalMonacoEditorHandle ? (
                      <PanelBody
                        panelId={editorPanelId}
                        view={modalMonacoEditorHandle}
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
                  <SessionTerminalWorkspacePane
                    sessionTabId={terminalModalTabId}
                    theme={activeTheme}
                    active={sessionMode === "terminal"}
                    headerActive={sessionMode === "terminal"}
                    primaryTerminal={
                      terminalSessionForTab(terminalModalTabId)
                        ?.agentId ? null : (
                        <PanelBody
                          panelId={terminalModalPanelId}
                          view={
                            {
                              kind: "tabs",
                              activeTabId: terminalModalTabId,
                              tabIds: [terminalModalTabId],
                            } as PanelView
                          }
                          store={tabStore}
                          registry={tabTypeRegistry}
                          focused={sessionMode === "terminal"}
                        />
                      )
                    }
                    onOpenPath={(rawPath, line, column) => {
                      const rootUri =
                        terminalCwdForTab(terminalModalTabId)
                      const cwdPath = fileUriToPath(rootUri)
                      const fullPath = resolvePathUnderRoot(cwdPath, rawPath)
                      const fileUri = pathToFileUri(fullPath)
                      if (!workspace.resolveRootUriForFile(fileUri)) return
                      openPathFromTerminal(
                        openFileInEditorRef.current,
                        cwdPath,
                        rawPath,
                        line,
                        column,
                      )
                    }}
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
                      theme={activeTheme}
                      focusPath={gitFocusPath}
                      onBranchChange={setTerminalModalGitBranch}
                      onOpenFile={relativePath => {
                        const rootUri = terminalCwdForTab(terminalModalTabId)
                        if (!rootUri) return
                          const rootPath = fileUriToPath(rootUri).replace(
                            /[/\\]+$/,
                            "",
                          )
                        const fullPath = `${rootPath}/${relativePath.replace(/^[/\\]+/, "")}`
                        openFileInEditor(pathToFileUri(fullPath), fullPath)
                      }}
                    />
                  </Suspense>
                }
                todos={(() => {
                  const rootUri = terminalCwdForTab(terminalModalTabId)
                    const folder = workspace.folders.find(
                      f => f.root.uri === rootUri,
                    )
                  const projectId = folder?.root.path ?? rootUri ?? ""
                  const projectName = folder?.root.name ?? "Project"
                  return (
                      <ProjectTodosPane
                        projectId={projectId}
                        projectName={projectName}
                      />
                  )
                })()}
              />,
                )
              : null}

            {/* After session modal so portal stacks above stage Dialog when z equal. */}
            <NotificationCenter
              open={notifications.open}
              onOpenChange={notifications.setOpen}
              items={notifications.items}
              query={notifications.query}
              onQueryChange={notifications.setQuery}
              loading={notifications.loading}
              error={notifications.error}
              onMarkAllRead={() => void notifications.markAllVisibleRead()}
              isSessionAvailable={id => Boolean(terminalSessionForTab(id))}
              onOpenNotification={n => void openNotificationSession(n)}
              onMarkRead={id => void notifications.markRead(id)}
              onMarkUnread={id => void notifications.markUnread(id)}
              onDismiss={id => void notifications.dismiss(id)}
              onAcknowledge={id => void notifications.acknowledge(id)}
              selectedId={notifications.selectedId}
              onSelectedIdChange={notifications.setSelectedId}
            />
            </div>
            {editorPanelId ? (
              <Suspense fallback={null}>
                <FindReplacePopover panelId={editorPanelId} />
              </Suspense>
            ) : null}
          </div>

          <AgentCliPickerOverlay
            open={agentCliPickerRootUri != null}
            onOpenChange={open => {
              if (!open) setAgentCliPickerRootUri(null)
            }}
            projects={workspace.folders.map(folder => ({
              rootUri: folder.root.uri,
              name: folder.root.name,
              path: folder.root.path,
            }))}
            selectedRootUri={agentCliPickerRootUri}
            onSelectedRootUriChange={setAgentCliPickerRootUri}
            onRemoveProject={removeProjectByRootUri}
            onAddProject={() => setAddWorkspaceOpen(true)}
            loadPreviousSessions={loadAgentCliHistory}
            peekPreviousSessions={peekAgentCliHistoryForPicker}
            onResumeSession={(driver, history) => {
              const rootUri = agentCliPickerRootUri
              setAgentCliPickerRootUri(null)
              if (!rootUri) return
              void resumeAgentCliHistorySession(rootUri, driver, history)
            }}
            onSelect={driver => {
              const rootUri = agentCliPickerRootUri
              setAgentCliPickerRootUri(null)
              if (!rootUri) return
              void createAgentSession(rootUri, driver)
            }}
          />
          <Suspense fallback={null}>
            {showOverlayHost && <OverlayHost />}
          </Suspense>
          <ConfirmDialogHost />
          <LiquidGlassFilter />
          <Toaster position="bottom-right" />
        </AppShell>
      </TooltipProvider>
    </OverlayControllerProvider>
  )
}
