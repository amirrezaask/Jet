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
} from "react"
import { RegistryContext } from "@effect-atom/atom-react"
import { rosterAtom } from "./effect/atoms.js"
import type { DropAction, PanelId, PanelView } from "@yaade/shared"
import { fileUriToPath, pathToFileUri } from "@yaade/shared"
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
  YaadePanelTree,
  type JetProject,
  type WorkspaceFolder,
  popPanelTab,
  panelTabIds,
  findPanelWithTab,
  isTerminalTabId,
  canonicalizeTerminalTabId,
  terminalSessionKeyFromTabId,
  terminalTabId,
  fileSearchAcrossFolders,
  relativePathInFolder,
  resolveQuickOpenDisplayPath,
} from "@yaade/workspace"
import type { MonacoEditorHandle } from "@yaade/monaco"
import { agentDriverIdForMode } from "@yaade/agents"
import type {
  AppNotification,
  AgentProvider,
} from "@yaade/shared"
import { createAgentBridge } from "./agent-bridge.js"
import { useNotificationCenter } from "./hooks/useNotificationCenter.js"
import {
  TabStore,
  TabTypeRegistry,
  TabDndRoot,
  bundledThemeList,
  formatKeyBinding,
  WhichKeyPanel,
  type WhichKeyEntry,
  TooltipProvider,
  ConfirmDialogHost,
  LiquidGlassFilter,
  Toaster,
  showYaadeToast,
  requestConfirm,
  AppShell,
  YaadeWindowTitlebar,
  GharagahSidebar,
  sidebarWidthStyle,
  mapHomeGroupsToSidebar,
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
  getEditorView,
  getEditorCursor,
  setEditorCursor,
  setEditorCursorStore,
  destroyEditorBuffer,
} from "@yaade/ui"
import { SessionTerminalWorkspacePane } from "./SessionTerminalWorkspacePane.js"
import {
  setPendingEditorNavigation,
  setPendingInitialContent,
} from "@yaade/monaco/pending"
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
  registerTerminalSession,
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
import { setAgentSessionTitleTabUpdater } from "./agent-session-title-bridge.js"
import {
  ensureAgentCliProcess,
  applyAgentCliResumeLaunchArgs,
} from "./agent-cli-resume.js"
import {
  releaseActiveAgentWarmResumeToForeground,
  startActiveAgentCliWarmResume,
  type ActiveAgentWarmResumeRun,
} from "./background-agent-cli-resume.js"
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
import { buildSessionSidebarGroups } from "./session-sidebar-groups.js"
import {
  activeTerminalTabInPanel,
  hideSessionFromLayout,
  openSessionInLayout,
} from "./session-layout.js"
import { SessionWorkspaceDock } from "./SessionWorkspaceDock.js"
import { SessionPaneHost } from "./SessionPaneHost.js"
import { loadGlobalJetrc } from "./load-global-yaaderc.js"
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

const FindReplacePopover = lazy(() =>
  import("@yaade/ui/editor").then(module => ({
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

function jetPlatformFS(): import("@yaade/workspace").FileSystemProvider {
  const jet = window.yaade
  if (!jet?.fs) {
    throw new Error("window.yaade.fs not available")
  }
  const fs = jet.fs
  return {
    readFile: uri => fs.readFile(uri),
    writeFile: (uri, content) => fs.writeFile(uri, content),
    readDir: uri => fs.readDir(uri),
    stat: uri => fs.stat(uri),
  }
}

export function YaadeApp() {
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
  const [sessionModesByTabId, setSessionModesByTabId] = useState<
    Record<string, SessionDialogMode>
  >({})
  const sessionModesByTabIdRef = useRef(sessionModesByTabId)
  sessionModesByTabIdRef.current = sessionModesByTabId
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
    panelTree: null! as YaadePanelTree,
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
    tabDndHandlers,
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

  const getSessionSidebarGroups = useCallback(() => {
    return buildSessionSidebarGroups(appStateRef.current.panelTree, workspace)
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
      if (window.yaade?.workspace)
        void window.yaade.workspace.activate(folder.root.uri)
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
      if (tabId) {
        setSessionModesByTabId(prev =>
          prev[tabId] === mode ? prev : { ...prev, [tabId]: mode },
        )
      }
      setSessionMode(mode)
    },
    [activateProject, folderForSessionTab, workspace.root?.uri],
  )

  const modeForSession = useCallback(
    (tabId: string | null | undefined): SessionDialogMode => {
      if (!tabId) return "terminal"
      return sessionModesByTabId[tabId] ?? sessionMode
    },
    [sessionModesByTabId, sessionMode],
  )

  const getActiveTerminalTabId = useCallback((): string | null => {
    const modalTabId = terminalModalTabIdRef.current
    if (modalTabId && isTerminalTabId(modalTabId)) return modalTabId
    const focused = appStateRef.current.focusedPanel
    return activeTerminalTabInPanel(appStateRef.current.panelTree, focused)
  }, [])

  const openTerminalModal = useCallback(
    (panelId: PanelId, tabId: string, mode?: SessionDialogMode) => {
      const session = terminalSessionForTab(tabId)
      const canShowAgent = Boolean(session?.agentId && session?.launchCommand)
      const requestedMode =
        mode ??
        sessionModesByTabIdRef.current[tabId] ??
        (canShowAgent && session?.agentId ? "agent" : "terminal")
      const resolvedMode =
        requestedMode === "agent" && !canShowAgent
          ? "terminal"
          : requestedMode
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
    (panelId: PanelId | null, tabId: string, mode?: SessionDialogMode) => {
      ensureAgentCliProcess(tabId)
      const focus = () => {
        const tree = cloneTree()
        const opened = openSessionInLayout(
          workspace,
          tree,
          tabId,
          appStateRef.current.focusedPanel ?? panelId,
        )
        setFocusedPanel(opened.panelId)
        commitTree(tree, opened.panelId)
        openTerminalModal(opened.panelId, tabId, mode)
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

  const hideSessionTab = useCallback(
    (panelId: PanelId, tabId: string) => {
      const tree = cloneTree()
      hideSessionFromLayout(tree, panelId, tabId)
      commitTree(tree, appStateRef.current.focusedPanel)
      if (terminalModalTabIdRef.current === tabId) {
        const active = activeTerminalTabInPanel(
          tree,
          appStateRef.current.focusedPanel,
        )
        if (active) {
          const panel =
            findPanelWithTab(tree, active) ?? appStateRef.current.focusedPanel
          if (panel) openTerminalModal(panel, active)
          else closeTerminalModal()
        } else {
          closeTerminalModal()
        }
      }
      setTerminalSessionRevision(revision => revision + 1)
    },
    [cloneTree, commitTree, openTerminalModal, closeTerminalModal],
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
    (panelId: PanelId | null, tabId: string) => {
      const session = terminalSessionForTab(tabId)
      const mode =
        Boolean(session?.agentId && session?.launchCommand)
          ? "agent"
          : "terminal"
      focusTerminalTab(panelId, tabId, mode)
    },
    [focusTerminalTab],
  )

  const openTerminalInWorkspaceChainRef = useRef(Promise.resolve())
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
      // Serialize opens so parallel createAgentSession calls cannot each
      // cloneTree() then overwrite the other with commitTree().
      const run = async () => {
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
      }
      const next = openTerminalInWorkspaceChainRef.current.then(run, run)
      openTerminalInWorkspaceChainRef.current = next.then(
        () => undefined,
        () => undefined,
      )
      return next
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
        void window.yaade?.agents
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
        console.error("[yaade] createAgentSession failed", err)
        showYaadeToast(err instanceof Error ? err.message : String(err), {
          variant: "destructive",
        })
        closeTerminalModal()
      }
    },
    [openTerminalInWorkspace, openTerminalModal, closeTerminalModal],
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
            void import("@yaade/monaco").then(
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
        console.error("[yaade] openTodosFromHome failed", err)
        showYaadeToast(err instanceof Error ? err.message : String(err), {
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
      const shell = window.yaade?.shell
      if (!shell?.openInApp) {
        throw new Error("Open in app is not available in this host")
      }
      await shell.openInApp(appId, rootUri)
    } catch (err) {
      console.error("[yaade] openProjectInApp failed", err)
        showYaadeToast(err instanceof Error ? err.message : String(err), {
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
    const tree = appStateRef.current.panelTree
    const modesByTabId: Record<string, SessionDialogMode> = {}
    for (const [tabId, mode] of Object.entries(sessionModesByTabIdRef.current)) {
      if (persistedTabIds.has(tabId)) modesByTabId[tabId] = mode
    }
    return {
      version: 2,
      sessions,
      modal:
        modalTabId && persistedTabIds.has(modalTabId)
          ? {
              tabId: modalTabId,
              sessionMode:
                sessionModesByTabIdRef.current[modalTabId] ??
                sessionModeRef.current,
            }
          : null,
      layout: {
        tree: tree.toJSON(),
        focusedPanelId: appStateRef.current.focusedPanel?.id ?? null,
        modesByTabId,
      },
    }
  }, [workspace])
  const lastRosterJsonRef = useRef<string | null>(null)
  const persistSessionRoster = useCallback(() => {
    if (!sessionRosterReadyRef.current) return
    const roster = buildPersistedSessionRoster()
    const json = JSON.stringify(roster)
    if (json === lastRosterJsonRef.current) return
    lastRosterJsonRef.current = json
    atomRegistry.set(rosterAtom, roster)
    rosterWriter.enqueue(roster)
  }, [buildPersistedSessionRoster, rosterWriter, atomRegistry])

  const persistRosterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const schedulePersistSessionRoster = useCallback(() => {
    if (persistRosterTimerRef.current != null) {
      clearTimeout(persistRosterTimerRef.current)
    }
    persistRosterTimerRef.current = setTimeout(() => {
      persistRosterTimerRef.current = null
      persistSessionRoster()
    }, 400)
  }, [persistSessionRoster])

  useEffect(() => {
    if (!sessionRosterReadyRef.current) return
    schedulePersistSessionRoster()
  }, [panelTree, focusedPanel, sessionModesByTabId, schedulePersistSessionRoster])

  useEffect(
    () => () => {
      if (persistRosterTimerRef.current != null) {
        clearTimeout(persistRosterTimerRef.current)
      }
    },
    [],
  )

  // Title / CLI capture only — list + counts owned by useNotificationCenter.
  useEffect(() => {
    const api = window.yaade?.notifications
    if (!api?.onEvent) return
    return api.onEvent(event => {
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
  }, [workspace])

  useEffect(() => {
    setAgentSessionTitleTabUpdater((tabId, label) => {
      workspace.tabRegistry.update(tabId, { label })
      persistSessionRoster()
    })
    return () => setAgentSessionTitleTabUpdater(null)
  }, [workspace, persistSessionRoster])

  // Telemetry + CLI id — session titles owned by installAgentSessionTitleBridge.
  useEffect(() => {
    const agentsApi = window.yaade?.agents
    if (!agentsApi?.onEvent) return
    return agentsApi.onEvent(payload => {
      applyAgentStreamUnknown(payload)
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
      if (persistRosterTimerRef.current != null) {
        clearTimeout(persistRosterTimerRef.current)
        persistRosterTimerRef.current = null
      }
      const roster = buildPersistedSessionRoster()
      // The normal state subscription already persists intentional removal of
      // the final session. Do not let an unload-time empty snapshot overwrite
      // a newer server-side roster written by another client/test fixture.
      if (roster.sessions.length === 0) return
      const json = JSON.stringify(roster)
      if (json !== lastRosterJsonRef.current) {
        lastRosterJsonRef.current = json
        atomRegistry.set(rosterAtom, roster)
        rosterWriter.enqueue(roster)
      }
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
        if (ptyId) void window.yaade?.terminal?.dispose(ptyId)
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
    async (_panelId: PanelId | null, tabId: string) => {
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
      if (ptyId) void window.yaade?.terminal?.dispose(ptyId)
      const openPanel = findPanelWithTab(appStateRef.current.panelTree, tabId)
      if (openPanel) {
        const tree = cloneTree()
        hideSessionFromLayout(tree, openPanel, tabId)
        commitTree(tree)
      }
      if (terminalModalTabIdRef.current === tabId) {
        setTerminalModalTabId(null)
        setTerminalModalPanelId(null)
      }
      setTerminalSessionRevision(revision => revision + 1)
      persistSessionRoster()
    },
    [persistSessionRoster, workspace, cloneTree, commitTree],
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
    if (!rootUri || !window.yaade?.git?.branch) {
      setTerminalModalGitBranch(null)
      return
    }
    let cancelled = false
    void window.yaade.git
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
    setMessage: showYaadeToast,
  })

  const boundNotificationSessionsRef = useRef(
    new Map<string, string>(),
  )
  useEffect(
    () =>
      subscribeTerminalSessions((tabId, kind) => {
        if (kind !== "roster") return
        const session = terminalSessionForTab(tabId)
        // Cleared top-level session — refresh sidebar; drop bind cache.
        if (!session) {
          boundNotificationSessionsRef.current.delete(tabId)
          setTerminalSessionRevision(revision => revision + 1)
          return
        }
        if (session.parentSessionTabId) return
        setTerminalSessionRevision(revision => revision + 1)
        const folder = workspace.folders.find(
          f => f.root.uri === session.cwdRootUri,
        )
        const projectId = folder?.id ?? session.cwdRootUri
        const provider = (session.agentId as AgentProvider | undefined) ?? null
        const sessionTitle =
          session.customLabel ??
          session.agentTitle ??
          workspace.tabRegistry.get(tabId)?.label ??
          null
        const bindKey = `${session.ptyId ?? ""}|${projectId}|${sessionTitle ?? ""}|${provider ?? ""}`
        if (boundNotificationSessionsRef.current.get(tabId) === bindKey) return
        boundNotificationSessionsRef.current.set(tabId, bindKey)
        void notificationsRef.current.bindSession({
          sessionId: tabId,
          projectId,
          projectName: folder?.root.name ?? null,
          sessionTitle,
          provider,
          ptyId: session.ptyId ?? null,
        })
      }),
    [workspace],
  )

  const openNotificationSession = useCallback(
    async (n: AppNotification) => {
      if (!n.sessionId) {
        showYaadeToast("This notification has no linked session", {
          variant: "warning",
        })
        await notifications.markRead(n.id)
        return
      }
      const session = terminalSessionForTab(n.sessionId)
      if (!session) {
        showYaadeToast("Session was removed — notification kept in history", {
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
    schedulePersistSessionRoster()
  }, [
    schedulePersistSessionRoster,
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
    if (!window.yaade?.fs.onFileChanged) return
    return window.yaade.fs.onFileChanged(uri => {
      void workspace.handleExternalFileChange(uri)
    })
  }, [workspace])

  const refreshProjects = useCallback(async (): Promise<number> => {
    let homeDir = homeDirRef.current
    if (window.yaade?.getHomeDir) {
      homeDir = await window.yaade.getHomeDir()
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
        if (window.yaade?.workspace)
          void window.yaade.workspace.activate(rootUri)
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
      showYaadeToast(`Added ${folder.root.name}`)
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
          showYaadeToast(`Opened ${folderPath}`)
        } else {
          showYaadeToast(`Added ${folder.root.name}`)
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
          if (ptyId) await window.yaade?.terminal?.dispose(ptyId)
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
          if (ptyId) await window.yaade?.terminal?.dispose(ptyId)
          workspace.disposeTab(tabId)
          tabStore.dispose(tabId)
          clearTerminalSession(tabId)
          workspace.closeTabInPanel(tree, panel, tabId)
        }
      }
      commitTree(tree)

      if (window.yaade?.workspace?.deactivate) {
        await window.yaade.workspace.deactivate(rootUri)
      }
      workspaceInitGen.current.delete(folderId)
      const removed = workspace.removeFolder(folderId)
      if (removed) {
        workspaceLayoutStoreRef.current.delete(rootUri)
        showYaadeToast(`Removed ${folder.root.name}`)
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
        showYaadeToast("Could not persist the project catalog", {
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
    if (!rootUri || !window.yaade?.search) return
    const search = window.yaade.search
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
        showMessage: showYaadeToast,
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
    showYaadeToast("Appearance reset")
  }, [resetAppearanceSettings])

  const toggleSidebar = useCallback(() => {
    setAppearanceSettings(prev => ({
      ...prev,
      sidebarCollapsed: !prev.sidebarCollapsed,
    }))
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
        setMessage: showYaadeToast,
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
        setMessage: showYaadeToast,
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
        if (window.yaade?.loadGlobalYaadercScanRoots) {
          if (window.yaade.getHomeDir)
            homeDirRef.current = await window.yaade.getHomeDir()
          return window.yaade.loadGlobalYaadercScanRoots()
        }
        const res = await fetch("/__yaade/globalYaaderc/scanRoots")
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
            showYaadeToast(`Theme: ${theme.name}`)
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
    window.__yaadeAgent = createAgentBridge(() => ({
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
          void import("@yaade/monaco").then(({ revealPosition }) => {
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
      sessionLayout: "sidebar",
      agentChatEnabled: false,
    }))
    return () => {
      delete window.__yaadeAgent
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
    return () => {
      activeAgentWarmResumeRef.current?.cancel()
    }
  }, [])

  useEffect(() => {
    if (!layoutReady || queryBootstrapDone.current) return
    queryBootstrapDone.current = true
    void (async () => {
      const cfg = window.yaade?.getLaunchConfig
        ? await window.yaade.getLaunchConfig()
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
          showYaadeToast(`Could not restore ${path}`, {
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
        const hydrateEntries = new Map<
          string,
          (typeof roster.sessions)[number]
        >()
        for (const entry of roster.sessions) {
          const sessionKey = terminalSessionKeyFromTabId(entry.tabId)
          const canonicalTabId = sessionKey
            ? terminalTabId(sessionKey)
            : canonicalizeTerminalTabId(entry.tabId)
          const prior = hydrateEntries.get(canonicalTabId)
          if (!prior) {
            hydrateEntries.set(canonicalTabId, entry)
            continue
          }
          if (entry.doneAt && !prior.doneAt) {
            hydrateEntries.set(canonicalTabId, entry)
          }
        }
        // Register all sessions (including archived) without opening them in the layout.
        for (const [canonicalTabId, entry] of hydrateEntries) {
          if (entry.agentId && !entry.launchCommand?.trim()) continue
          if (entry.agentId && !isAgentCliProvider(entry.agentId)) continue
          const cwdRootUri = resolveWorkspaceRootUri(
            entry.cwdRootUri,
            workspace.folders,
          )
          const hydrated = prepareHydratedAgentCliFields({
            tabId: canonicalTabId,
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
          registerTerminalSession(canonicalTabId, cwdRootUri, hydrated.launchCommand, {
            launchArgs: hydrated.launchArgs,
            launchEnv: hydrated.launchEnv,
            agentId: entry.agentId,
            agentTitle: entry.agentTitle ?? entry.label,
            agentDriverId: entry.agentDriverId,
            agentCliSessionId: cliSessionId,
            lastActivityAt: entry.lastActivityAt,
          })
          workspace.registerTab({
            id: canonicalTabId,
            kind: "terminal",
            label: entry.label,
          })
          hydrateTerminalSession({
            tabId: canonicalTabId,
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

        let layoutTree = tree
        const layout = roster.layout
        if (layout?.tree && typeof layout.tree === "object") {
          try {
            layoutTree = YaadePanelTree.jetFromJSON(
              layout.tree as Parameters<typeof YaadePanelTree.jetFromJSON>[0],
            )
            // Keep only non-archived hydrated sessions that still exist.
            layoutTree.visitLeaves(node => {
              if (node.view.kind !== "tabs") return
              const kept = panelTabIds(node.view).filter(id => {
                const canonical = canonicalizeTerminalTabId(id)
                const entry = hydrateEntries.get(canonical)
                return Boolean(entry && !entry.doneAt)
              })
              if (kept.length === 0) {
                node.view = { kind: "empty" }
                return
              }
              const active = kept.includes(node.view.activeTabId)
                ? node.view.activeTabId
                : kept[0]!
              node.view = { kind: "tabs", activeTabId: active, tabIds: kept }
            })
            layoutTree.pruneEmptyLeaves()
            if (layout.modesByTabId) {
              setSessionModesByTabId(layout.modesByTabId)
            }
          } catch {
            layoutTree = tree
          }
        }

        // Backward compat: open only the last focused/modal session (never archived).
        const wantsOpenTabId = roster.modal
          ? canonicalizeTerminalTabId(roster.modal.tabId)
          : null
        const canOpenModal =
          wantsOpenTabId != null &&
          hydrateEntries.has(wantsOpenTabId) &&
          !hydrateEntries.get(wantsOpenTabId)?.doneAt
        if (
          canOpenModal &&
          layoutTree.root.kind === "leaf" &&
          layoutTree.root.view.kind === "empty" &&
          wantsOpenTabId
        ) {
          openSessionInLayout(
            workspace,
            layoutTree,
            wantsOpenTabId,
            appStateRef.current.focusedPanel,
          )
        }

        commitTree(layoutTree)
        if (layout?.focusedPanelId != null) {
          const leaves = getAllLeafPanels(layoutTree)
          if (leaves.some(p => p.id === layout.focusedPanelId)) {
            setFocusedPanel({ id: layout.focusedPanelId })
          }
        }
        setTerminalSessionRevision(revision => revision + 1)

        const deadTabIds = await reconcileHydratedTerminalPtys(
          window.yaade?.terminal,
        )
        void deadTabIds

        const terminalApi = window.yaade?.terminal
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
            performance.measure("yaade:active-agent-warm-resume", {
              start: performance.now() - summary.durationMs,
              end: performance.now(),
              detail: summary,
            })
          })
        }

        const focusTabId = (() => {
          if (canOpenModal && wantsOpenTabId) return wantsOpenTabId
          const focused = layout?.focusedPanelId
            ? { id: layout.focusedPanelId }
            : appStateRef.current.focusedPanel
          return activeTerminalTabInPanel(layoutTree, focused)
        })()
        if (focusTabId && hydrateEntries.has(focusTabId) && !hydrateEntries.get(focusTabId)?.doneAt) {
          const panelId = findPanelWithTab(layoutTree, focusTabId)
          if (panelId) {
            setTerminalModalPanelId(panelId)
            setTerminalModalTabId(focusTabId)
            releaseActiveAgentWarmResumeToForeground(focusTabId)
            const restoredSession = hydrateEntries.get(focusTabId)
            let restoredMode =
              layout?.modesByTabId?.[focusTabId] ??
              roster.modal?.sessionMode ??
              "terminal"
            const isCliAgent = Boolean(
              restoredSession?.agentId && restoredSession?.launchCommand,
            )
            if (restoredMode === "agent" && !isCliAgent) {
              restoredMode = "terminal"
            }
            setSessionModeSynced(restoredMode, focusTabId)
          }
        }
      }

      sessionRosterReadyRef.current = true
      persistSessionRoster()
    })()
  }, [
    layoutReady,
    workspace,
    cloneTree,
    commitTree,
    persistSessionRoster,
    tabStore,
    setSessionModeSynced,
  ])

  useEffect(() => {
    if (
      startupRecordedRef.current ||
      !layoutReady ||
      !projectCatalogReadyRef.current ||
      !workspace.manager.hasFolders() ||
      !window.yaade?.recordStartup
    ) {
      return
    }
    startupRecordedRef.current = true
    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined
    const bootstrapAt =
      (window as Window & { __yaadeStartupBootstrapAt?: number })
        .__yaadeStartupBootstrapAt ?? 0
    void window.yaade
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
      setAppearanceSettings(next)
    },
    [setAppearanceSettings],
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
        if (!window.yaade?.getHomeDir) {
          throw new Error("window.yaade.getHomeDir not available")
        }
        return window.yaade.getHomeDir()
      },
      onGotoLineSubmit: (line, column) => {
        setGotoLineOpen(false)
        const panel = editorPanelRef.current
        const view = panel ? getEditorView(panel) : null
        if (view) {
          void import("@yaade/monaco").then(({ revealPosition }) => {
            revealPosition(view as MonacoEditorHandle, line, column ?? 1)
          })
        }
      },
      onQuickOpenSearch: async (query, workspaceId) => {
        if (!window.yaade?.search) return []
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
          window.yaade.search,
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
  const terminalGroups = useMemo(
    () => getTerminalExplorerGroups(),
    [getTerminalExplorerGroups, panelTree, terminalSessionRevision, workspace.folders],
  )
  const homeGroupsForSidebar = useMemo(
    () =>
      getSessionSidebarGroups().map(g => ({
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
    [getSessionSidebarGroups, panelTree, terminalSessionRevision, workspace.folders],
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
  const openSidebarSession = useCallback(
    (session: SidebarSession) => {
      openTerminalFromHome(session.panelId, session.id)
      if (session.unreadCount > 0) {
        void notifications.markSessionRead(session.id)
      }
    },
    [openTerminalFromHome, notifications],
  )

  const dropSessionIntoLayout = useCallback(
    (tabId: string, target: PanelId, action: DropAction) => {
      ensureAgentCliProcess(tabId)
      const tree = cloneTree()
      const existing = findPanelWithTab(tree, tabId)
      if (existing) {
        if (action.kind === "moveToPane" && existing.id === target.id) {
          workspace.focusTabInPanel(tree, existing, tabId)
          setFocusedPanel(existing)
          commitTree(tree, existing)
          openTerminalModal(existing, tabId)
          return
        }
        const result = tree.applyTabDrop(existing, tabId, target, action)
        if (result.moved) {
          const focus = result.createdPanel ?? target
          setFocusedPanel(focus)
          commitTree(tree, focus)
          openTerminalModal(focus, tabId)
        }
        return
      }
      const session = terminalSessionForTab(tabId)
      const label =
        session?.customLabel ??
        session?.agentTitle ??
        workspace.tabRegistry.get(tabId)?.label ??
        "Terminal"
      let panelId = target
      if (action.kind === "split") {
        panelId = tree.splitAtEdge(target, action.edge)
      }
      workspace.openOrFocusTab(tree, panelId, {
        id: tabId,
        kind: "terminal",
        label,
      })
      setFocusedPanel(panelId)
      commitTree(tree, panelId)
      openTerminalModal(panelId, tabId)
    },
    [cloneTree, commitTree, workspace, setFocusedPanel, openTerminalModal],
  )

  const sessionTabDndHandlers = useMemo(
    () => ({
      ...tabDndHandlers,
      tabIdsForPanel: (panelId: PanelId) => {
        const view = appStateRef.current.panelTree.getView(panelId)
        if (view?.kind !== "tabs") return []
        return panelTabIds(view).filter(isTerminalTabId)
      },
      onSessionDrop: dropSessionIntoLayout,
    }),
    [tabDndHandlers, dropSessionIntoLayout],
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

  const desktopWindowChrome =
    window.yaadeDesktop?.windowChrome?.customTitlebar === true
      ? window.yaadeDesktop.windowChrome
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
            data-yaade-shell="home"
            data-yaade-session-layout="sidebar"
            style={
              desktopWindowChrome
                ? ({
                    "--yaade-window-chrome-height": `${desktopWindowChrome.titlebarHeight}px`,
                  } as CSSProperties)
                : undefined
            }
          >
            {desktopWindowChrome ? (
              <YaadeWindowTitlebar
                platform={desktopWindowChrome.platform}
                title={windowTitle}
                sidebar={{
                  collapsed: appearanceSettings.sidebarCollapsed,
                  width: appearanceSettings.sidebarWidth,
                }}
              />
            ) : null}
            <div className="min-h-0 flex-1 overflow-hidden">
              <TabDndRoot handlers={sessionTabDndHandlers}>
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
                        void window.yaade?.shell?.revealInFolder?.(
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
                      className="relative min-h-0 flex-1 overflow-hidden p-0"
                      data-yaade-sidebar-workspace=""
                    >
                      <SessionWorkspaceDock
                        tree={panelTree}
                        focusedPanelId={focusedPanel}
                        onFocusPanel={panelId => {
                          setFocusedPanel(panelId)
                          const tabId = activeTerminalTabInPanel(
                            appStateRef.current.panelTree,
                            panelId,
                          )
                          if (tabId) openTerminalModal(panelId, tabId)
                        }}
                        onEvent={handlePanelEvent}
                        tabDnd={sessionTabDndHandlers}
                        wrapTabDnd={false}
                        tabStore={tabStore}
                        tabRegistry={tabTypeRegistry}
                        onHideSession={hideSessionTab}
                        onActivateSession={(panelId, tabId) => {
                          handlePanelEvent({
                            type: "tabActivate",
                            panelId,
                            tabId,
                          })
                          openTerminalModal(panelId, tabId)
                        }}
                        empty={
                          <div
                            className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center"
                            data-yaade-session-workspace-empty-state=""
                          >
                            <p className="text-sm text-muted-foreground">
                              Open a session from the sidebar, or start a new one.
                            </p>
                            <button
                              type="button"
                              className="rounded-md border border-border bg-card/70 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/70"
                              onClick={() => {
                                const target =
                                  workspace.manager.activeFolder?.root.uri ??
                                  workspace.folders[0]?.root.uri ??
                                  ""
                                if (target) void newAgentTabFromHome(target)
                              }}
                            >
                              New session
                            </button>
                          </div>
                        }
                        renderSession={(sessionTabId, panelId, meta) => (
                          <SessionPaneHost
                            key={sessionTabId}
                            sessionTabId={sessionTabId}
                            panelId={panelId}
                            focused={meta.focused}
                            mode={modeForSession(sessionTabId)}
                            onModeChange={mode =>
                              setSessionModeSynced(mode, sessionTabId)
                            }
                            titleTick={terminalModalTitleTick}
                            editorChromeTick={editorChromeTick}
                            gitBranch={
                              meta.focused ? terminalModalGitBranch : null
                            }
                            onGitBranchChange={setTerminalModalGitBranch}
                            gitFocusPath={gitFocusPath}
                            workspace={workspace}
                            tabStore={tabStore}
                            tabTypeRegistry={tabTypeRegistry}
                            folderForSessionTab={folderForSessionTab}
                            editorBuffers={editorBuffers}
                            editorActiveTabId={editorActiveTabId}
                            editorPanelId={editorPanelId}
                            modalMonacoEditorHandle={modalMonacoEditorHandle}
                            lspStatus={lspStatus}
                            projectSearchOpen={projectSearchOpen}
                            onProjectSearchOpenChange={setProjectSearchOpen}
                            notificationCounts={notifications.counts}
                            onOpenNotifications={() =>
                              notifications.setOpen(true)
                            }
                            onResumeArchived={resumeArchivedSessionFromView}
                            onOpenInApp={(rootUri, appId) =>
                              void openProjectInApp(rootUri, appId)
                            }
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
                            onCommandPalette={() =>
                              void executeCommand("ui.showCommandPalette")
                            }
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
                            openFileInEditor={openFileInEditor}
                            openFileInEditorRef={openFileInEditorRef}
                            activeTheme={activeTheme}
                          />
                        )}
                      />
                    </div>
                  </SidebarInset>
                </div>
              </SidebarProvider>
              </TabDndRoot>

            <div
              id="yaade-notification-live"
              className="sr-only"
              aria-live="polite"
              aria-atomic="true"
            />


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
