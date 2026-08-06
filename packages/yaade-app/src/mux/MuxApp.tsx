import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { PanelEvent } from "@yaade/panels"
import type { PanelId, ProjectSearchResult, YaadeTheme } from "@yaade/shared"
import { pathToFileUri, fileUriToPath, canonicalizeFileUri } from "@yaade/shared"
import {
  AppShell,
  ConfirmDialogHost,
  LiquidGlassFilter,
  MuxStatusStrip,
  TabDndRoot,
  Toaster,
  TooltipProvider,
  WhichKeyPanel,
  bundledThemeList,
  formatKeyBinding,
  formatMuxTitle,
  requestConfirm,
  showYaadeToast,
  type AgentCliDriver,
  type MuxStatusStripAction,
  type PaletteShellItem,
  type TabDndHandlers,
  type WhichKeyEntry,
} from "@yaade/ui"
import type { ProjectSession, ProjectSessionPayload } from "@yaade/rpc"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@yaade/ui/primitives"
import {
  CommandRegistry,
  KeymapService,
  WorkspaceManager,
  WorkspaceService,
  YaadePanelTree,
  activatePanelTab,
  anyOverlayOpen,
  bind,
  gitTabId,
  isEditorTabId,
  isFileEditorTabId,
  isGitTabId,
  isTerminalTabId,
  normalizeAbsPath,
  panelTabIds,
  sameFileTab,
  terminalTabId,
  type JetCommandContext,
  type JetKeyBinding,
  type KeymapContext,
  type LaunchConfig,
} from "@yaade/workspace"
import { createAgentBridge } from "../agent-bridge.js"
import {
  buildAgentCliLaunchArgs,
  buildAgentCliLaunchEnv,
} from "../agent-cli-launch.js"
import { agentDriverIdForMode } from "@yaade/agents"
import { useAppearanceSettings } from "../hooks/useAppearanceSettings.js"
import { useGlobalKeymap } from "../hooks/useGlobalKeymap.js"
import { useFileDrop } from "../use-file-drop.js"
import { MuxLspHost } from "./MuxLspHost.js"
import {
  clearTerminalSession,
  hydrateTerminalSession,
  markTerminalFailed,
  recordTerminalOutput,
  recordTerminalUserInput,
  registerTerminalSession,
  restartTerminalSession,
  subscribeTerminalSessions,
  terminalCwdForTab,
  terminalPtyIdForTab,
  terminalSessionForTab,
  terminalSessionNeedsCloseConfirmation,
  trackTerminalPtyId,
  updateTerminalLiveCwd,
} from "../tabs/terminal-session.js"
import { allocTerminalSessionKey } from "../tab-routing.js"
import { applySessionPaneDrop } from "../session-layout.js"
import { getAllLeafPanels } from "../panel-routing.js"
import {
  activeMuxTabInPanel,
  clearEditorTabsFromPanel,
  dockSourceLeavesIntoTree,
  emptyMuxTree,
  listPaneLeaves,
  listTerminalLeaves,
  removePtyFromTree,
  type MuxLeafKind,
} from "./layout.js"
import { findFocusNeighbor, type FocusDirection } from "./focus-neighbor.js"
import {
  MUX_DIRECT_BINDINGS,
  MUX_PREFIX,
  MUX_PREFIX_BINDINGS,
  muxPrefixBindingKey,
  prefixLiteralByte,
} from "./mux-keymap.js"
import {
  placeGitPane,
  placeTerminalPane,
  placeEditorPane,
  type AllocatedGitPane,
  type AllocatedTerminalPane,
  type AllocatedEditorPane,
} from "./place-pane.js"
import { MuxWindowView } from "./MuxWindowView.js"
import {
  MuxTerminalLayer,
  useMuxTerminalSlotBoxes,
} from "./MuxTerminalLayer.js"
import { cwdUriFromTerminalTitle } from "./cwd-from-title.js"
import {
  urlPathForProjectRoot,
  workspaceDocumentTitle,
} from "../url-workspace.js"
import { ProjectSessionPersistWriter } from "../project-session-client.js"
import type {
  MuxSessionLeafPersisted,
  MuxSwitcherEntry,
  MuxWindowPersisted,
} from "./types.js"

const TerminalPanel = lazy(async () => {
  const mod = await import("@yaade/ui/terminal")
  return { default: mod.TerminalPanel }
})

const MuxEditorPane = lazy(() => import("./MuxEditorPane.js"))

const MuxOverlays = lazy(() => import("./MuxOverlays.js"))
// Prefetch immediately so Mod-k / Mod-Shift-p never race an unloaded chunk.
void import("./MuxOverlays.js")

/** Window event that asks the focused editor pane to save (see MuxEditorPane). */
const MUX_EDITOR_SAVE_EVENT = "yaade:mux-editor-save"

/** Basename display label for an editor pane from its file uri. */
function editorLabelFromUri(uri: string): string {
  if (uri.startsWith("untitled:")) {
    const rest = uri.slice("untitled:".length).trim()
    return rest || "Untitled"
  }
  try {
    return fileUriToPath(uri).split(/[/\\]/).filter(Boolean).pop() ?? uri
  } catch {
    return uri.split("/").filter(Boolean).pop() ?? uri
  }
}

/** Resolve a file uri from an absolute/relative path or an existing uri. */
function resolveEditorUri(rootUri: string, target: string): string {
  if (target.startsWith("file://")) return canonicalizeFileUri(target)
  let rootPath = ""
  try {
    rootPath = fileUriToPath(rootUri)
  } catch {
    rootPath = ""
  }
  const clean = target.replace(/^\.\//, "")
  const abs = clean.startsWith("/")
    ? clean
    : rootPath
      ? `${rootPath.replace(/\/+$/, "")}/${clean}`
      : clean
  return canonicalizeFileUri(pathToFileUri(abs))
}

/**
 * Rewrite legacy `yaade:editor:pane-*` tab ids in a persisted tree to file URIs
 * using the companion `editorFiles` map. Returns remapped editorFiles keyed by URI.
 */
function migrateLegacyEditorTabs(
  tree: YaadePanelTree,
  editorFiles: Record<string, { uri: string; line?: number }>,
): Record<string, { uri: string; line?: number }> {
  const nextFiles: Record<string, { uri: string; line?: number }> = {}
  const remap = new Map<string, string>()

  for (const [tabId, entry] of Object.entries(editorFiles)) {
    if (isFileEditorTabId(tabId)) {
      nextFiles[tabId] = {
        uri: entry.uri || tabId,
        ...(entry.line != null ? { line: entry.line } : {}),
      }
      continue
    }
    if (tabId.startsWith("yaade:editor:") && entry.uri) {
      remap.set(tabId, entry.uri)
      nextFiles[entry.uri] = {
        uri: entry.uri,
        ...(entry.line != null ? { line: entry.line } : {}),
      }
      continue
    }
    if (entry.uri) {
      const key = isFileEditorTabId(entry.uri) ? entry.uri : tabId
      nextFiles[key] = {
        uri: entry.uri,
        ...(entry.line != null ? { line: entry.line } : {}),
      }
    }
  }

  if (remap.size === 0) return nextFiles

  for (const panelId of getAllLeafPanels(tree)) {
    const view = tree.getView(panelId)
    if (!view || view.kind !== "tabs") continue
    const tabIds = panelTabIds(view).map(id => remap.get(id) ?? id)
    const activeTabId = remap.get(view.activeTabId) ?? view.activeTabId
    const unique = tabIds.filter((id, i, arr) => arr.indexOf(id) === i)
    if (unique.length === 0) continue
    tree.setView(panelId, {
      kind: "tabs",
      activeTabId: unique.includes(activeTabId) ? activeTabId : unique[0]!,
      tabIds: unique,
    })
  }

  return nextFiles
}

/** True when a pane was launched as Neovim/Vim (quit should close the pane). */
function isNeovimLaunchCommand(command: string | undefined): boolean {
  if (!command) return false
  const base =
    command
      .trim()
      .split(/[/\\\s]/)
      .filter(Boolean)
      .pop()
      ?.toLowerCase() ?? ""
  return base === "nvim" || base === "neovim" || base === "vim"
}

type LiveWindow = {
  id: string
  title: string
  tree: YaadePanelTree
  focusedPaneId: PanelId | null
  zoomedPaneId: string | null
}

function jetPlatformFS(): import("@yaade/workspace").FileSystemProvider {
  const jet = window.yaade
  if (!jet?.fs) throw new Error("window.yaade.fs not available")
  const fs = jet.fs
  return {
    readFile: uri => fs.readFile(uri),
    writeFile: (uri, content) => fs.writeFile(uri, content),
    readDir: uri => fs.readDir(uri),
    stat: uri => fs.stat(uri),
  }
}

function panelIdFromNumber(id: number | null): PanelId | null {
  return id == null ? null : { id }
}

function allocWindowId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? `win-${crypto.randomUUID()}`
    : `win-${Date.now().toString(36)}`
}

function persistWindows(windows: LiveWindow[]): MuxWindowPersisted[] {
  return windows.map(w => {
    const sessions: MuxSessionLeafPersisted[] = []
    for (const leaf of listTerminalLeaves(w.tree)) {
      const session = terminalSessionForTab(leaf.ptyTabId)
      if (!session) continue
      sessions.push({
        ptyTabId: leaf.ptyTabId,
        ptyId: session.ptyId,
        cwdRootUri: session.cwdRootUri,
        liveCwdUri: session.liveCwdUri,
        launchCommand: session.launchCommand,
        launchArgs: session.launchArgs,
        label: session.customLabel,
      })
    }
    return {
      id: w.id,
      title: w.title,
      tree: w.tree.toJSON(),
      focusedPaneId: w.focusedPaneId?.id ?? null,
      zoomedPaneId: w.zoomedPaneId,
      sessions,
    }
  })
}

function hydrateWindows(persisted: MuxWindowPersisted[]): LiveWindow[] {
  return persisted.map(w => {
    try {
      return {
        id: w.id,
        title: w.title,
        tree: YaadePanelTree.jetFromJSON(w.tree),
        focusedPaneId: panelIdFromNumber(w.focusedPaneId),
        zoomedPaneId: w.zoomedPaneId,
      }
    } catch {
      return {
        id: w.id,
        title: w.title,
        tree: emptyMuxTree(),
        focusedPaneId: null,
        zoomedPaneId: null,
      }
    }
  })
}

/** Re-register terminal sessions from persisted leaf metadata so attach works. */
function hydratePersistedSessions(
  persisted: MuxWindowPersisted[],
  workspace: WorkspaceService,
): void {
  for (const w of persisted) {
    const sessions = w.sessions ?? []
    for (const entry of sessions) {
      if (!isTerminalTabId(entry.ptyTabId)) continue
      hydrateTerminalSession({
        tabId: entry.ptyTabId,
        cwdRootUri: entry.cwdRootUri,
        liveCwdUri: entry.liveCwdUri,
        launchCommand: entry.launchCommand,
        launchArgs: entry.launchArgs,
        ptyId: entry.ptyId,
        status: entry.ptyId ? "running" : "starting",
        customLabel: entry.label,
      })
      if (!workspace.tabRegistry.get(entry.ptyTabId)) {
        workspace.registerTab({
          id: entry.ptyTabId,
          kind: "terminal",
          label: entry.label ?? "Terminal",
        })
      }
    }
    // Also register any terminal/git leaves present in the tree without session meta.
    try {
      const tree = YaadePanelTree.jetFromJSON(w.tree)
      for (const leaf of listPaneLeaves(tree)) {
        if (workspace.tabRegistry.get(leaf.ptyTabId)) continue
        if (leaf.kind === "terminal") {
          workspace.registerTab({
            id: leaf.ptyTabId,
            kind: "terminal",
            label: "Terminal",
          })
          if (!terminalSessionForTab(leaf.ptyTabId)) {
            registerTerminalSession(leaf.ptyTabId, "")
          }
        } else if (leaf.kind === "git") {
          workspace.registerTab({
            id: leaf.ptyTabId,
            kind: "git",
            label: "Git",
          })
        }
      }
    } catch {
      /* ignore corrupt tree */
    }
  }
}

const EMPTY_KEYMAP_OVERLAYS = {
  quickOpenOpen: false,
  bufferListOpen: false,
  openFileOpen: false,
  projectSwitcherOpen: false,
  gotoLineOpen: false,
  outlineOpen: false,
  agentCliPickerOpen: false,
  explorerFocus: false,
  terminalExplorerFocus: false,
  outputFocus: false,
  listFocus: false,
  agentChatFocus: false,
} as const

export type MuxAppProps = {
  session: ProjectSession
  homeDir: string
  machineHostname: string
  onBackToProject?: () => void
  /**
   * Render inside ProjectPage content (no nested AppShell / session chrome).
   * Footer (WhichKey / status) stays at the bottom of this pane.
   */
  embedded?: boolean
}

export function MuxApp({
  session,
  homeDir,
  machineHostname,
  onBackToProject,
  embedded = false,
}: MuxAppProps) {
  const {
    appearanceSettings,
    setAppearanceSettings,
    activeTheme,
    fontSize,
    handleZoom,
    setFontSize,
    resetAppearanceSettings,
  } = useAppearanceSettings()
  const sessionId = session.id
  const sessionCwdPath = session.cwdPath
  const sessionProjectPath = session.projectPath
  const sessionTitle = session.title
  const sessionWorktreeBranch = session.worktreeBranch
  const initialPayload = session.payload

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

  /** Filled after `openEditorInFocused` is defined — used by LSP go-to-def. */
  const openEditorInFocusedRef = useRef<
    (options?: {
      uri?: string
      filePath?: string
      line?: number
      column?: number
      forceNewGroup?: boolean
    }) => void
  >(() => {})
  const ensureLspForFileRef = useRef<(uri: string) => Promise<void>>(async () => {})

  const [layoutReady, setLayoutReady] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [terminalListOpen, setTerminalListOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cdOpen, setCdOpen] = useState(false)
  const [pendingChordPrefix, setPendingChordPrefix] = useState<string | null>(
    null,
  )
  const [, bumpSessions] = useReducer((n: number) => n + 1, 0)

  // One browser tab = one project window (no in-app tab strip).
  const [windows, setWindows] = useState<LiveWindow[]>([])
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null)
  const [lastCwdUri, setLastCwdUri] = useState<string | null>(null)
  /** Per git-pane workspace root (source shell cwd at open time). */
  const [gitRoots, setGitRoots] = useState<Record<string, string>>({})
  /** Per editor-pane file target (uri + optional 1-based line). */
  const [editorFiles, setEditorFiles] = useState<
    Record<string, { uri: string; line?: number; column?: number }>
  >({})
  /** Per editor-pane unsaved-changes flag. */
  const [editorDirty, setEditorDirty] = useState<Record<string, boolean>>({})
  const [quickOpenOpen, setQuickOpenOpen] = useState(false)
  const [projectSearchOpen, setProjectSearchOpen] = useState(false)
  const sessionRootPathRef = useRef<string>(sessionCwdPath)
  const projectPathRef = useRef<string>(sessionProjectPath)
  const sessionIdRef = useRef<string>(sessionId)
  const machineHostnameRef = useRef<string>(machineHostname)
  const persistWriterRef = useRef(new ProjectSessionPersistWriter())
  const serverHydratedRef = useRef(false)
  /** Skip network persist when only focusedPaneId changed (tree unchanged). */
  const lastPersistStructureRef = useRef<string>("")
  /** Foreground process basename per terminal tab (Deck icons / titles). */
  const processByTabRef = useRef<Record<string, string>>({})
  const focusedPtyTabIdRef = useRef<string | null>(null)

  const windowsRef = useRef(windows)
  windowsRef.current = windows
  const activeWindowIdRef = useRef(activeWindowId)
  activeWindowIdRef.current = activeWindowId
  const lastCwdUriRef = useRef(lastCwdUri)
  lastCwdUriRef.current = lastCwdUri
  const gitRootsRef = useRef(gitRoots)
  gitRootsRef.current = gitRoots
  const editorFilesRef = useRef(editorFiles)
  editorFilesRef.current = editorFiles
  const editorDirtyRef = useRef(editorDirty)
  editorDirtyRef.current = editorDirty
  const homeDirRef = useRef(homeDir)
  const bootstrappedRef = useRef(false)
  sessionRootPathRef.current = sessionCwdPath
  projectPathRef.current = sessionProjectPath
  sessionIdRef.current = sessionId
  machineHostnameRef.current = machineHostname
  homeDirRef.current = homeDir
  const slotBoxesRef = useRef(new Map<string, import("./MuxTerminalLayer.js").MuxTerminalSlotBox>())
  /** LRU of recently focused terminal tab ids (beyond the active window). */
  const terminalLruRef = useRef<string[]>([])
  const MAX_MOUNTED_TERMINALS = 6

  const activeWindow =
    windows.find(w => w.id === activeWindowId) ?? windows[0] ?? null

  useEffect(() => subscribeTerminalSessions(() => bumpSessions()), [])

  useEffect(() => {
    const writer = persistWriterRef.current
    const onHide = () => writer.flush()
    window.addEventListener("pagehide", onHide)
    return () => {
      window.removeEventListener("pagehide", onHide)
      writer.flush()
      writer.stop()
    }
  }, [])

  const buildServerPayload = useCallback((): ProjectSessionPayload | null => {
    if (!sessionIdRef.current) return null
    const persisted = persistWindows(windowsRef.current)
    const live = persisted[0]
    if (!live) {
      return {
        version: 1,
        layout: {
          tree: emptyMuxTree().toJSON(),
          focusedPaneId: null,
          zoomedPaneId: null,
        },
        sessions: [],
        ...(Object.keys(gitRootsRef.current).length > 0
          ? { gitRoots: { ...gitRootsRef.current } }
          : {}),
        ...(Object.keys(editorFilesRef.current).length > 0
          ? { editorFiles: { ...editorFilesRef.current } }
          : {}),
      }
    }
    return {
      version: 1,
      layout: {
        tree: live.tree,
        focusedPaneId: live.focusedPaneId,
        zoomedPaneId: live.zoomedPaneId,
      },
      sessions: live.sessions ?? [],
      ...(Object.keys(gitRootsRef.current).length > 0
        ? { gitRoots: { ...gitRootsRef.current } }
        : {}),
      ...(Object.keys(editorFilesRef.current).length > 0
        ? { editorFiles: { ...editorFilesRef.current } }
        : {}),
    }
  }, [])

  const persist = useCallback(() => {
    if (!serverHydratedRef.current) return
    const snapshot = buildServerPayload()
    const id = sessionIdRef.current
    if (!snapshot || !id) return
    // Focus-only updates must not enqueue — tree/sessions unchanged.
    const structureKey = JSON.stringify({
      tree: snapshot.layout.tree,
      zoomedPaneId: snapshot.layout.zoomedPaneId,
      sessions: snapshot.sessions,
      gitRoots: snapshot.gitRoots ?? null,
      editorFiles: snapshot.editorFiles ?? null,
    })
    if (structureKey === lastPersistStructureRef.current) return
    lastPersistStructureRef.current = structureKey
    persistWriterRef.current.enqueue(id, snapshot)
  }, [buildServerPayload])

  useEffect(() => {
    persist()
  }, [windows, activeWindowId, lastCwdUri, gitRoots, editorFiles, persist])

  const cwdUri = useCallback((): string => {
    if (sessionRootPathRef.current) {
      return pathToFileUri(sessionRootPathRef.current)
    }
    return (
      lastCwdUriRef.current ??
      workspace.manager.activeFolder?.root.uri ??
      workspace.folders[0]?.root.uri ??
      (homeDirRef.current ? pathToFileUri(homeDirRef.current) : "")
    )
  }, [workspace])

  const paneTitle = useCallback(
    (tabId: string): string => {
      if (isGitTabId(tabId)) {
        return workspace.tabRegistry.get(tabId)?.label ?? "Git"
      }
      if (isEditorTabId(tabId)) {
        return (
          workspace.tabRegistry.get(tabId)?.label ?? editorLabelFromUri(tabId)
        )
      }
      const session = terminalSessionForTab(tabId)
      if (session?.customLabel) return session.customLabel
      const cwdPath = (() => {
        const uri = terminalCwdForTab(tabId)
        if (!uri) return null
        try {
          return fileUriToPath(uri)
        } catch {
          return null
        }
      })()
      const processName =
        processByTabRef.current[tabId] ??
        session?.launchCommand?.split(/[/\\\s]/).pop() ??
        null
      return formatMuxTitle({
        cwdPath,
        homeDir: homeDirRef.current || null,
        processName,
        fallback: workspace.tabRegistry.get(tabId)?.label ?? "Terminal",
      })
    },
    [workspace],
  )

  const paneProcessName = useCallback((tabId: string): string | null => {
    if (isGitTabId(tabId)) return "git"
    const session = terminalSessionForTab(tabId)
    return (
      processByTabRef.current[tabId] ??
      session?.launchCommand?.split(/[/\\\s]/).pop() ??
      null
    )
  }, [])

  const refreshForegroundProcess = useCallback(async (ptyTabId: string) => {
    const ptyId = terminalPtyIdForTab(ptyTabId)
    if (!ptyId || !window.yaade?.terminal?.getForegroundProcess) return
    try {
      const name = await window.yaade.terminal.getForegroundProcess(ptyId)
      if (!name) return
      if (processByTabRef.current[ptyTabId] === name) return
      processByTabRef.current = { ...processByTabRef.current, [ptyTabId]: name }
      // Only re-render mux chrome when the focused pane's process name changes.
      if (focusedPtyTabIdRef.current === ptyTabId) bumpSessions()
    } catch {
      /* ignore */
    }
  }, [])

  const updateWindow = useCallback(
    (windowId: string, mutate: (w: LiveWindow) => LiveWindow) => {
      setWindows(prev => prev.map(w => (w.id === windowId ? mutate(w) : w)))
    },
    [],
  )

  /** Side effects: register session + tab. Call OUTSIDE setState updaters. */
  const allocTerminalPane = useCallback(
    (options?: {
      launchCommand?: string
      launchArgs?: string[]
      launchEnv?: Record<string, string>
      label?: string
      rootUri?: string
      agentId?: string
      agentTitle?: string
      agentDriverId?: string
    }): AllocatedTerminalPane => {
      const sessionKey = allocTerminalSessionKey()
      const ptyTabId = terminalTabId(sessionKey)
      const rootUri = options?.rootUri ?? cwdUri()
      const label = options?.label ?? "Terminal"
      registerTerminalSession(ptyTabId, rootUri, options?.launchCommand, {
        customLabel: options?.label,
        launchArgs: options?.launchArgs,
        launchEnv: options?.launchEnv,
        agentId: options?.agentId,
        agentTitle: options?.agentTitle,
        agentDriverId: options?.agentDriverId,
        pendingCliMint: options?.agentId === "cursor",
      })
      workspace.registerTab({
        id: ptyTabId,
        kind: "terminal",
        label,
      })
      return {
        ptyTabId,
        label,
        rootUri,
        launchCommand: options?.launchCommand,
        launchArgs: options?.launchArgs,
      }
    },
    [cwdUri, workspace],
  )

  const allocGitPane = useCallback(
    (rootUri?: string): AllocatedGitPane => {
      const tabId = gitTabId(`pane-${Date.now().toString(36)}`)
      const gitRoot = rootUri || cwdUri()
      if (gitRoot) {
        gitRootsRef.current = { ...gitRootsRef.current, [tabId]: gitRoot }
        setGitRoots(prev => ({ ...prev, [tabId]: gitRoot }))
      }
      workspace.registerTab({
        id: tabId,
        kind: "git",
        label: "Git",
      })
      return { tabId, rootUri: gitRoot }
    },
    [cwdUri, workspace],
  )

  const allocEditorPane = useCallback(
    (
      uri: string,
      line?: number,
      column?: number,
    ): AllocatedEditorPane => {
      const canonical = uri.startsWith("file://")
        ? canonicalizeFileUri(uri)
        : uri
      // Reuse the existing tab id when the same file is already open under a
      // URI variant (encoding / `..` segments) so goto-def does not duplicate.
      const existingKey = Object.keys(editorFilesRef.current).find(k =>
        sameFileTab(k, canonical),
      )
      const tabId = existingKey ?? canonical
      const label = editorLabelFromUri(tabId)
      const entry = {
        uri: tabId,
        ...(line != null ? { line } : {}),
        ...(column != null && column > 0 ? { column } : {}),
      }
      editorFilesRef.current = { ...editorFilesRef.current, [tabId]: entry }
      setEditorFiles(prev => ({ ...prev, [tabId]: entry }))
      workspace.registerTab({ id: tabId, kind: "editor", label })
      return { tabId, uri: tabId, line, label }
    },
    [workspace],
  )

  /** Open another project in a browser tab (replaces in-app mux windows). */
  const openBrowserProjectTab = useCallback((absolutePath?: string) => {
    const home = homeDirRef.current
    const target = absolutePath
      ? urlPathForProjectRoot(absolutePath, home)
      : "/"
    window.open(target, "_blank", "noopener,noreferrer")
  }, [])

  /**
   * Ensure the page has a project window. New sessions start empty — no PTY
   * until the user opens Terminal / Neovim / Git / Editor from the empty state.
   */
  const ensureProjectWindow = useCallback((): LiveWindow => {
    const existing =
      windowsRef.current.find(w => w.id === activeWindowIdRef.current) ??
      windowsRef.current[0] ??
      null

    if (existing) {
      if (activeWindowIdRef.current !== existing.id) {
        setActiveWindowId(existing.id)
      }
      return existing
    }

    const id = allocWindowId()
    const base: LiveWindow = {
      id,
      title: "Window",
      tree: emptyMuxTree(),
      focusedPaneId: null,
      zoomedPaneId: null,
    }
    setWindows([base])
    setActiveWindowId(id)
    return base
  }, [])

  const closeWindow = useCallback(
    async (windowId: string, options?: { skipConfirm?: boolean }) => {
      const live = windowsRef.current.find(w => w.id === windowId)
      if (!live) return
      const panes = listPaneLeaves(live.tree)
      if (!options?.skipConfirm) {
        for (const pane of panes) {
          if (pane.kind !== "terminal") continue
          const session = terminalSessionForTab(pane.ptyTabId)
          if (terminalSessionNeedsCloseConfirmation(session)) {
            const ok = await requestConfirm({
              title: `Close ${paneTitle(pane.ptyTabId)}?`,
              description: "Running shells in this window will be stopped.",
              confirmLabel: "Close",
              cancelLabel: "Keep Running",
              destructive: true,
            })
            if (!ok) return
            break
          }
        }
      }
      for (const pane of panes) {
        if (pane.kind === "terminal") {
          const ptyId = terminalPtyIdForTab(pane.ptyTabId)
          if (ptyId) void window.yaade?.terminal?.dispose(ptyId)
          clearTerminalSession(pane.ptyTabId)
        }
        workspace.disposeTab(pane.ptyTabId)
      }
      const closedGitIds = panes
        .filter(p => p.kind === "git")
        .map(p => p.ptyTabId)
      if (closedGitIds.length > 0) {
        setGitRoots(prev => {
          let changed = false
          const next = { ...prev }
          for (const id of closedGitIds) {
            if (id in next) {
              delete next[id]
              changed = true
            }
          }
          return changed ? next : prev
        })
      }
      const closedEditorIds = panes
        .filter(p => p.kind === "editor")
        .map(p => p.ptyTabId)
      if (closedEditorIds.length > 0) {
        const prune = (prev: Record<string, unknown>) => {
          let changed = false
          const next = { ...prev }
          for (const id of closedEditorIds) {
            if (id in next) {
              delete next[id]
              changed = true
            }
          }
          return changed ? next : prev
        }
        setEditorFiles(prev => prune(prev) as typeof prev)
        setEditorDirty(prev => prune(prev) as typeof prev)
      }
      // Single-window model: reset to an empty window (no auto-spawned PTY).
      const id = allocWindowId()
      const next: LiveWindow = {
        id,
        title: "Window",
        tree: emptyMuxTree(),
        focusedPaneId: null,
        zoomedPaneId: null,
      }
      setWindows([next])
      setActiveWindowId(id)
    },
    [paneTitle, workspace],
  )

  const closePane = useCallback(
    async (
      windowId: string,
      panelId: PanelId,
      tabId: string,
      options?: { skipConfirm?: boolean },
    ) => {
      const live = windowsRef.current.find(w => w.id === windowId)
      if (!live) return
      const isTerminal = isTerminalTabId(tabId)
      if (!options?.skipConfirm && isTerminal) {
        const session = terminalSessionForTab(tabId)
        if (terminalSessionNeedsCloseConfirmation(session)) {
          const ok = await requestConfirm({
            title: `Close ${paneTitle(tabId)}?`,
            description: "The running shell process will be stopped.",
            confirmLabel: "Close Pane",
            cancelLabel: "Keep Running",
            destructive: true,
          })
          if (!ok) return
        }
      }
      if (isTerminal) {
        const ptyId = terminalPtyIdForTab(tabId)
        if (ptyId) void window.yaade?.terminal?.dispose(ptyId)
        clearTerminalSession(tabId)
      } else if (isGitTabId(tabId)) {
        setGitRoots(prev => {
          if (!(tabId in prev)) return prev
          const next = { ...prev }
          delete next[tabId]
          return next
        })
      } else if (isEditorTabId(tabId)) {
        const liveNow = windowsRef.current.find(w => w.id === windowId)
        const view = liveNow?.tree.getView(panelId)
        const editorTabs =
          view?.kind === "tabs"
            ? panelTabIds(view).filter(id => isEditorTabId(id))
            : [tabId]
        setEditorFiles(prev => {
          let changed = false
          const next = { ...prev }
          for (const id of editorTabs) {
            if (id in next) {
              delete next[id]
              changed = true
            }
          }
          return changed ? next : prev
        })
        setEditorDirty(prev => {
          let changed = false
          const next = { ...prev }
          for (const id of editorTabs) {
            if (id in next) {
              delete next[id]
              changed = true
            }
          }
          return changed ? next : prev
        })
        for (const id of editorTabs) workspace.disposeTab(id)
        updateWindow(windowId, w => {
          const tree = w.tree.clone()
          clearEditorTabsFromPanel(tree, panelId)
          return {
            ...w,
            tree,
            zoomedPaneId: editorTabs.includes(w.zoomedPaneId ?? "")
              ? null
              : w.zoomedPaneId,
            focusedPaneId:
              w.focusedPaneId?.id === panelId.id
                ? (listPaneLeaves(tree)[0]?.panelId ?? null)
                : w.focusedPaneId,
          }
        })
        return
      }
      workspace.disposeTab(tabId)
      updateWindow(windowId, w => {
        const tree = w.tree.clone()
        removePtyFromTree(tree, panelId, tabId)
        return {
          ...w,
          tree,
          zoomedPaneId: w.zoomedPaneId === tabId ? null : w.zoomedPaneId,
          focusedPaneId:
            w.focusedPaneId?.id === panelId.id
              ? (listPaneLeaves(tree)[0]?.panelId ?? null)
              : w.focusedPaneId,
        }
      })
    },
    [paneTitle, updateWindow, workspace],
  )

  /** Close a single editor buffer tab (keeps the pane until the last tab). */
  const closeEditorTab = useCallback(
    (windowId: string, panelId: PanelId, tabId: string) => {
      if (!isEditorTabId(tabId)) return
      setEditorFiles(prev => {
        if (!(tabId in prev)) return prev
        const next = { ...prev }
        delete next[tabId]
        return next
      })
      setEditorDirty(prev => {
        if (!(tabId in prev)) return prev
        const next = { ...prev }
        delete next[tabId]
        return next
      })
      workspace.disposeTab(tabId)
      updateWindow(windowId, w => {
        const tree = w.tree.clone()
        removePtyFromTree(tree, panelId, tabId)
        const remaining = listPaneLeaves(tree)
        return {
          ...w,
          tree,
          zoomedPaneId: w.zoomedPaneId === tabId ? null : w.zoomedPaneId,
          focusedPaneId:
            w.focusedPaneId?.id === panelId.id
              ? remaining.find(l => l.panelId.id === panelId.id)?.panelId ??
                remaining[0]?.panelId ??
                null
              : w.focusedPaneId,
        }
      })
    },
    [updateWindow, workspace],
  )

  /** Activate an editor buffer tab inside a panel. */
  const activateEditorTab = useCallback(
    (windowId: string, panelId: PanelId, tabId: string) => {
      updateWindow(windowId, w => {
        const view = w.tree.getView(panelId)
        if (!view || view.kind !== "tabs") return w
        if (!panelTabIds(view).includes(tabId)) return w
        const tree = w.tree.clone()
        tree.setView(panelId, activatePanelTab(view, tabId))
        return { ...w, tree, focusedPaneId: panelId }
      })
    },
    [updateWindow],
  )

  /** Prefer the source pane's live shell cwd when opening splits. */
  const resolveSplitCwdUri = useCallback(
    async (windowId: string, panelId: PanelId): Promise<string> => {
      const live = windowsRef.current.find(w => w.id === windowId)
      const leaf = live
        ? listPaneLeaves(live.tree).find(p => p.panelId.id === panelId.id)
        : undefined
      if (leaf?.kind === "git") {
        return gitRootsRef.current[leaf.ptyTabId] || cwdUri()
      }
      if (leaf?.kind === "terminal") {
        const ptyId = terminalPtyIdForTab(leaf.ptyTabId)
        if (ptyId) {
          try {
            const liveCwd = await window.yaade?.terminal?.getCwd?.(ptyId)
            if (liveCwd) {
              updateTerminalLiveCwd(leaf.ptyTabId, liveCwd)
              return liveCwd
            }
          } catch {
            /* fall through — title / spawn-time cwd */
          }
        }
        const title = workspace.tabRegistry.get(leaf.ptyTabId)?.label ?? ""
        const fromTitle = cwdUriFromTerminalTitle(
          title,
          homeDirRef.current || "",
        )
        if (fromTitle) {
          updateTerminalLiveCwd(leaf.ptyTabId, fromTitle)
          return fromTitle
        }
        const sessionCwd = terminalCwdForTab(leaf.ptyTabId)
        if (sessionCwd) return sessionCwd
      }
      return cwdUri()
    },
    [cwdUri, workspace],
  )

  const splitPane = useCallback(
    async (windowId: string, panelId: PanelId, edge: "right" | "bottom") => {
      const rootUri = await resolveSplitCwdUri(windowId, panelId)
      const pane = allocTerminalPane({ rootUri })
      updateWindow(windowId, w => placeTerminalPane(w, pane, edge, panelId))
    },
    [allocTerminalPane, resolveSplitCwdUri, updateWindow],
  )

  /** Open a terminal in the active window (fill empty, else split). */
  const openTerminalInActiveWindow = useCallback(
    async (edge: "right" | "bottom" = "right") => {
      const w = ensureProjectWindow()
      if (listPaneLeaves(w.tree).length === 0 || !w.focusedPaneId) {
        const pane = allocTerminalPane()
        updateWindow(w.id, live => placeTerminalPane(live, pane))
        return
      }
      await splitPane(w.id, w.focusedPaneId, edge)
    },
    [allocTerminalPane, ensureProjectWindow, splitPane, updateWindow],
  )

  /** Launch a known agent CLI into the active (or empty) window. */
  const openAgentCliPane = useCallback(
    (driver: AgentCliDriver) => {
      const w = ensureProjectWindow()
      const rootUri = cwdUri()
      const projectRoot = rootUri ? fileUriToPath(rootUri) : ""
      const launchContext = {
        sessionId: "pending",
        origin: window.location.origin,
        projectRoot,
      }
      // Args/env need the real tab id — allocate first with placeholders, then
      // the session store already holds the tab id for build* helpers below.
      const sessionKey = allocTerminalSessionKey()
      const ptyTabId = terminalTabId(sessionKey)
      const launchArgs = buildAgentCliLaunchArgs(driver.id, {
        ...launchContext,
        sessionId: ptyTabId,
      })
      const launchEnv = buildAgentCliLaunchEnv(driver.id, {
        ...launchContext,
        sessionId: ptyTabId,
      })
      registerTerminalSession(ptyTabId, rootUri, driver.command, {
        customLabel: driver.label,
        launchArgs,
        launchEnv,
        agentId: driver.id,
        agentTitle: driver.label,
        agentDriverId: agentDriverIdForMode(driver.id, "cli"),
        pendingCliMint: driver.id === "cursor",
      })
      workspace.registerTab({
        id: ptyTabId,
        kind: "terminal",
        label: driver.label,
      })
      const pane: AllocatedTerminalPane = {
        ptyTabId,
        label: driver.label,
        rootUri,
        launchCommand: driver.command,
        launchArgs,
      }
      updateWindow(w.id, live => placeTerminalPane(live, pane))
      if (projectRoot) {
        void window.yaade?.agents
          ?.installProjectHooks?.({
            provider: driver.id,
            projectRoot,
          })
          .catch(() => undefined)
      }
    },
    [cwdUri, ensureProjectWindow, updateWindow, workspace],
  )

  const openGitSplit = useCallback(
    async (windowId: string, panelId: PanelId | null) => {
      const rootUri = panelId
        ? await resolveSplitCwdUri(windowId, panelId)
        : cwdUri()
      const pane = allocGitPane(rootUri)
      updateWindow(windowId, w => placeGitPane(w, pane, "right", panelId))
    },
    [allocGitPane, cwdUri, resolveSplitCwdUri, updateWindow],
  )

  const openNeovimSplit = useCallback(
    async (
      windowId: string,
      panelId: PanelId | null,
      options?: { filePath?: string; line?: number },
    ) => {
      const rootUri = panelId
        ? await resolveSplitCwdUri(windowId, panelId)
        : cwdUri()
      const launchArgs: string[] = []
      if (options?.filePath) {
        if (options.line != null && options.line > 0) {
          launchArgs.push(`+${options.line}`)
        }
        launchArgs.push(options.filePath)
      }
      const pane = allocTerminalPane({
        launchCommand: "nvim",
        launchArgs: launchArgs.length > 0 ? launchArgs : undefined,
        label: "Neovim",
        rootUri,
      })
      updateWindow(windowId, w => placeTerminalPane(w, pane, "right", panelId))
    },
    [allocTerminalPane, cwdUri, resolveSplitCwdUri, updateWindow],
  )

  const openEditorSplit = useCallback(
    async (
      windowId: string,
      panelId: PanelId | null,
      options?: {
        uri?: string
        filePath?: string
        line?: number
        column?: number
        forceNewGroup?: boolean
      },
    ) => {
      let uri = options?.uri
      if (!uri && options?.filePath) {
        uri = resolveEditorUri(cwdUri(), options.filePath)
      }
      if (!uri) {
        // No target yet — let quick open pick a file, then open it in-focus.
        setQuickOpenOpen(true)
        return
      }
      if (uri.startsWith("file://")) uri = canonicalizeFileUri(uri)
      const pane = allocEditorPane(uri, options?.line, options?.column)
      updateWindow(windowId, w =>
        placeEditorPane(w, pane, "right", panelId, {
          forceNewGroup: options?.forceNewGroup === true,
        }),
      )
    },
    [allocEditorPane, cwdUri, updateWindow],
  )

  const openEditorInFocused = useCallback(
    (options?: {
      uri?: string
      filePath?: string
      line?: number
      column?: number
      forceNewGroup?: boolean
    }) => {
      const w = ensureProjectWindow()
      const panelId =
        w.focusedPaneId ?? listPaneLeaves(w.tree)[0]?.panelId ?? null
      void openEditorSplit(w.id, panelId, {
        ...options,
        forceNewGroup: options?.forceNewGroup === true,
      })
    },
    [ensureProjectWindow, openEditorSplit],
  )

  const untitledDropCounterRef = useRef(0)
  const openUntitledFromDrop = useCallback(
    (name: string, content: string) => {
      untitledDropCounterRef.current += 1
      const safe = name.replace(/[/\\]/g, "_").trim() || "Untitled"
      const uri = `untitled:${safe}-${untitledDropCounterRef.current}`
      // Lazy: keep monaco editor out of the mux startup graph.
      void import("@yaade/monaco/pending").then(({ setPendingInitialContent }) => {
        setPendingInitialContent(uri, content)
        openEditorInFocused({ uri })
      })
    },
    [openEditorInFocused],
  )

  const knownDropWorkspacePaths = useMemo(() => {
    const roots = [sessionCwdPath, sessionProjectPath]
      .map(p => normalizeAbsPath(p))
      .filter(Boolean)
    return [...new Set(roots)]
  }, [sessionCwdPath, sessionProjectPath])

  useFileDrop({
    fs: jetPlatformFS(),
    knownWorkspacePaths: knownDropWorkspacePaths,
    activeWorkspacePath: normalizeAbsPath(sessionCwdPath),
    normalizePath: normalizeAbsPath,
    openWorkspace: path => openBrowserProjectTab(path),
    // Mux is single-project; still open dropped files outside the root.
    addWorkspaceFolder: () => {},
    openFile: (uri, _path) => {
      openEditorInFocusedRef.current({ uri })
    },
    bootstrapFromLaunch: (config: LaunchConfig) => {
      if (config.filePath) {
        openEditorInFocusedRef.current({
          uri: pathToFileUri(config.filePath),
        })
      } else if (config.workspacePath) {
        openBrowserProjectTab(config.workspacePath)
      }
    },
    openUntitledFromDrop,
    setMessage: showYaadeToast,
  })

  const zoomPane = useCallback(
    (windowId: string, ptyTabId: string) => {
      updateWindow(windowId, w => ({
        ...w,
        zoomedPaneId: w.zoomedPaneId === ptyTabId ? null : ptyTabId,
      }))
    },
    [updateWindow],
  )

  const unzoomIfNeeded = useCallback(() => {
    const w = windowsRef.current.find(x => x.id === activeWindowIdRef.current)
    if (!w?.zoomedPaneId) return false
    updateWindow(w.id, cur => ({ ...cur, zoomedPaneId: null }))
    return true
  }, [updateWindow])

  const focusPane = useCallback(
    (windowId: string, panelId: PanelId, ptyTabId?: string) => {
      setActiveWindowId(windowId)
      updateWindow(windowId, w => ({
        ...w,
        focusedPaneId: panelId,
        zoomedPaneId:
          ptyTabId && w.zoomedPaneId && w.zoomedPaneId !== ptyTabId
            ? null
            : w.zoomedPaneId,
      }))
    },
    [updateWindow],
  )

  const focusNeighbor = useCallback(
    (direction: FocusDirection) => {
      const w = windowsRef.current.find(x => x.id === activeWindowIdRef.current)
      if (!w?.focusedPaneId) return
      const leaves = listPaneLeaves(w.tree)
      const panes = leaves
        .map(leaf => {
          const box = slotBoxesRef.current.get(leaf.ptyTabId)
          if (!box) return null
          return { panelId: leaf.panelId, ptyTabId: leaf.ptyTabId, box }
        })
        .filter((p): p is NonNullable<typeof p> => p != null)
      const next = findFocusNeighbor(panes, w.focusedPaneId, direction)
      if (next) focusPane(w.id, next.panelId, next.ptyTabId)
    },
    [focusPane],
  )

  const openWorkspace = useCallback(
    async (folderPath: string) => {
      await workspace.openWorkspace(folderPath)
      const uri =
        workspace.manager.activeFolder?.root.uri ?? pathToFileUri(folderPath)
      setLastCwdUri(uri)
      sessionRootPathRef.current = folderPath
      const titleBase = workspaceDocumentTitle(
        projectPathRef.current || folderPath,
        homeDirRef.current,
      )
      document.title = titleBase
      setLayoutReady(true)
    },
    [workspace],
  )

  const applyServerPayload = useCallback(
    (payload: ProjectSessionPayload) => {
      if (payload.gitRoots) {
        setGitRoots(payload.gitRoots)
        gitRootsRef.current = payload.gitRoots
      }
      const hasLeaves = payload.sessions.length > 0
      if (!hasLeaves) {
        if (payload.editorFiles) {
          const migrated = migrateLegacyEditorTabs(
            emptyMuxTree(),
            payload.editorFiles,
          )
          setEditorFiles(migrated)
          editorFilesRef.current = migrated
          for (const [k, v] of Object.entries(migrated)) {
            if (!workspace.tabRegistry.get(k)) {
              workspace.registerTab({
                id: k,
                kind: "editor",
                label: editorLabelFromUri(v.uri),
              })
            }
          }
        }
        ensureProjectWindow()
        return
      }
      const windowPersisted: MuxWindowPersisted = {
        id: allocWindowId(),
        title: "Window",
        tree: payload.layout.tree as MuxWindowPersisted["tree"],
        focusedPaneId: payload.layout.focusedPaneId,
        zoomedPaneId: payload.layout.zoomedPaneId,
        sessions: payload.sessions.map(
          (s): MuxSessionLeafPersisted => ({
            ptyTabId: s.ptyTabId,
            cwdRootUri: s.cwdRootUri,
            liveCwdUri: s.liveCwdUri,
            launchCommand: s.launchCommand,
            launchArgs: s.launchArgs ? [...s.launchArgs] : undefined,
            label: s.label,
            // Reattach same-host reload; attach miss → fresh PTY.
            ...(s.ptyId ? { ptyId: s.ptyId } : {}),
          }),
        ),
      }
      try {
        hydratePersistedSessions([windowPersisted], workspace)
        const hydrated = hydrateWindows([windowPersisted])
        const live = hydrated[0]
        if (!live) {
          ensureProjectWindow()
          return
        }
        if (payload.editorFiles) {
          const migrated = migrateLegacyEditorTabs(
            live.tree,
            payload.editorFiles,
          )
          setEditorFiles(migrated)
          editorFilesRef.current = migrated
          for (const [k, v] of Object.entries(migrated)) {
            if (!workspace.tabRegistry.get(k)) {
              workspace.registerTab({
                id: k,
                kind: "editor",
                label: editorLabelFromUri(v.uri),
              })
            }
          }
        }
        setWindows([live])
        setActiveWindowId(live.id)
      } catch {
        ensureProjectWindow()
      }
    },
    [ensureProjectWindow, workspace],
  )

  useEffect(() => {
    if (bootstrappedRef.current) return
    let cancelled = false
    const payload = initialPayload
    void (async () => {
      const finishBoot = () => {
        if (cancelled) return
        serverHydratedRef.current = true
        bootstrappedRef.current = true
      }

      try {
        await openWorkspace(sessionCwdPath)
        if (cancelled) return
        applyServerPayload(payload)
        finishBoot()
        if (!cancelled) persist()
      } catch {
        setLayoutReady(true)
        ensureProjectWindow()
        finishBoot()
      }
    })()
    return () => {
      cancelled = true
      // StrictMode remounts reset React state (layoutReady) but keep refs.
      // Allow the next mount to re-run boot so waitForReady cannot hang.
      bootstrappedRef.current = false
    }
    // Boot once per mount for this session id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const handlePanelEvent = useCallback(
    (windowId: string, event: PanelEvent) => {
      if (event.type === "splitRatiosChanged") {
        updateWindow(windowId, w => {
          const tree = w.tree.clone()
          tree.setSplitRatios(event.path, event.ratios)
          return { ...w, tree }
        })
        return
      }
      if (event.type === "panelClose") {
        const live = windowsRef.current.find(w => w.id === windowId)
        if (!live) return
        const pty = listPaneLeaves(live.tree).find(
          p => p.panelId.id === event.panelId.id,
        )
        if (pty) void closePane(windowId, event.panelId, pty.ptyTabId)
      }
    },
    [closePane, updateWindow],
  )

  /** Pane rearrange inside the active window + docking strip windows into it. */
  const tabDnd = useMemo((): TabDndHandlers => {
    return {
      onTabReorder: () => {
        // One PTY per leaf — reorder within a leaf is a no-op.
      },
      tabIdsForPanel: panelId => {
        const w = windowsRef.current.find(
          x => x.id === activeWindowIdRef.current,
        )
        if (!w) return []
        const tab = activeMuxTabInPanel(w.tree, panelId)
        return tab ? [tab] : []
      },
      onTabDrop: (source, sourceTabId, target, action) => {
        const windowId = activeWindowIdRef.current
        if (!windowId) return
        updateWindow(windowId, w => {
          const tree = w.tree.clone()
          const result = applySessionPaneDrop(
            tree,
            source,
            sourceTabId,
            target,
            action,
          )
          return {
            ...w,
            tree,
            zoomedPaneId: null,
            focusedPaneId: result.focusPanel,
          }
        })
      },
      onSessionDrop: (sourceWindowId, target, action) => {
        if (sourceWindowId === activeWindowIdRef.current) return
        const activeId = activeWindowIdRef.current
        if (!activeId) return
        const source = windowsRef.current.find(w => w.id === sourceWindowId)
        if (!source) return
        const leaves = listPaneLeaves(source.tree)
        if (leaves.length === 0) return

        setWindows(prev => {
          const active = prev.find(w => w.id === activeId)
          if (!active) return prev
          const tree = active.tree.clone()
          const focus = dockSourceLeavesIntoTree(
            tree,
            leaves,
            target,
            action,
          )
          return prev
            .filter(w => w.id !== sourceWindowId)
            .map(w =>
              w.id === activeId
                ? {
                    ...w,
                    tree,
                    focusedPaneId: focus,
                    zoomedPaneId: null,
                  }
                : w,
            )
        })
      },
    }
  }, [updateWindow])

  const switcherEntries = useMemo((): MuxSwitcherEntry[] => {
    const entries: MuxSwitcherEntry[] = []
    for (const w of windows) {
      for (const leaf of listPaneLeaves(w.tree)) {
        entries.push({
          windowId: w.id,
          windowTitle: w.title,
          paneId: leaf.ptyTabId,
          ptyTabId: leaf.ptyTabId,
          title: paneTitle(leaf.ptyTabId),
          panelId: leaf.panelId.id,
        })
      }
    }
    return entries
  }, [windows, paneTitle])

  const getCommandContext = useCallback(
    (): JetCommandContext => ({
      workspace,
      ui: {
        showMessage: () => {},
        showCommandPalette: () => setPaletteOpen(true),
        setCommandPaletteOpen: setPaletteOpen,
      },
      getActiveEditorView: () => null,
    }),
    [workspace],
  )

  const executeCommand = useCallback(
    async (name: string) => {
      await commands.execute(name, getCommandContext())
    },
    [commands, getCommandContext],
  )

  const openBrowserProjectTabRef = useRef(openBrowserProjectTab)
  openBrowserProjectTabRef.current = openBrowserProjectTab
  const closeWindowRef = useRef(closeWindow)
  closeWindowRef.current = closeWindow
  const closePaneRef = useRef(closePane)
  closePaneRef.current = closePane
  const openTerminalInActiveWindowRef = useRef(openTerminalInActiveWindow)
  openTerminalInActiveWindowRef.current = openTerminalInActiveWindow
  const openGitSplitRef = useRef(openGitSplit)
  openGitSplitRef.current = openGitSplit
  const openNeovimSplitRef = useRef(openNeovimSplit)
  openNeovimSplitRef.current = openNeovimSplit
  openEditorInFocusedRef.current = openEditorInFocused
  const zoomPaneRef = useRef(zoomPane)
  zoomPaneRef.current = zoomPane
  const focusNeighborRef = useRef(focusNeighbor)
  focusNeighborRef.current = focusNeighbor
  const ensureProjectWindowRef = useRef(ensureProjectWindow)
  ensureProjectWindowRef.current = ensureProjectWindow

  const [keymapRevision, setKeymapRevision] = useState(0)
  const [commandRevision, setCommandRevision] = useState(0)

  // Stable command registrations for overlays / mux actions.
  useEffect(() => {
    const run =
      (fn: () => void) =>
      async () => {
        fn()
      }

    const disposers = [
      commands.register(
        "layout.closeTab",
        run(() => {
          const w = windowsRef.current.find(
            x => x.id === activeWindowIdRef.current,
          )
          if (!w?.focusedPaneId) return
          const pty = listPaneLeaves(w.tree).find(
            p => p.panelId.id === w.focusedPaneId!.id,
          )
          if (pty) void closePaneRef.current(w.id, pty.panelId, pty.ptyTabId)
        }),
        { id: "layout.closeTab", title: "Close Pane", category: "Terminal" },
      ),
      commands.register(
        "mux.newWindow",
        run(() => openBrowserProjectTabRef.current()),
        {
          id: "mux.newWindow",
          title: "New Browser Tab",
          category: "Terminal",
        },
      ),
      commands.register(
        "terminal.new",
        run(() => {
          void openTerminalInActiveWindowRef.current("right")
        }),
        { id: "terminal.new", title: "New Terminal Pane", category: "Terminal" },
      ),
      commands.register(
        "mux.closeWindow",
        run(() => {
          const id = activeWindowIdRef.current
          if (id) void closeWindowRef.current(id)
        }),
        {
          id: "mux.closeWindow",
          title: "Reset Window",
          category: "Terminal",
        },
      ),
      commands.register(
        "mux.splitRight",
        run(() => {
          void openTerminalInActiveWindowRef.current("right")
        }),
        { id: "mux.splitRight", title: "Split Right", category: "Terminal" },
      ),
      commands.register(
        "mux.splitDown",
        run(() => {
          void openTerminalInActiveWindowRef.current("bottom")
        }),
        { id: "mux.splitDown", title: "Split Down", category: "Terminal" },
      ),
      commands.register(
        "mux.openGit",
        run(() => {
          const w = ensureProjectWindowRef.current()
          void openGitSplitRef.current(w.id, w.focusedPaneId)
        }),
        {
          id: "mux.openGit",
          title: "Open Git",
          category: "View",
          aliases: ["git", "source control"],
        },
      ),
      commands.register(
        "dialog.showGit",
        run(() => {
          const w = ensureProjectWindowRef.current()
          void openGitSplitRef.current(w.id, w.focusedPaneId)
        }),
        {
          id: "dialog.showGit",
          title: "Show Git",
          category: "View",
          aliases: ["git", "source control"],
        },
      ),
      commands.register(
        "mux.openNeovim",
        run(() => {
          const w = ensureProjectWindowRef.current()
          void openNeovimSplitRef.current(w.id, w.focusedPaneId)
        }),
        {
          id: "mux.openNeovim",
          title: "Open Neovim",
          category: "View",
          aliases: ["nvim", "vim", "neovim"],
        },
      ),
      commands.register(
        "mux.openEditor",
        run(() => openEditorInFocusedRef.current()),
        {
          id: "mux.openEditor",
          title: "Open Editor",
          category: "View",
          aliases: ["editor", "monaco", "code"],
        },
      ),
      commands.register(
        "editor.quickOpen",
        run(() => setQuickOpenOpen(true)),
        {
          id: "editor.quickOpen",
          title: "Quick Open File",
          category: "View",
          aliases: ["open file", "find file"],
        },
      ),
      commands.register(
        "editor.projectSearch",
        run(() => setProjectSearchOpen(true)),
        {
          id: "editor.projectSearch",
          title: "Search in Files",
          category: "View",
          aliases: ["grep", "find in files", "project search"],
        },
      ),
      commands.register(
        "editor.save",
        run(() => {
          window.dispatchEvent(new CustomEvent(MUX_EDITOR_SAVE_EVENT))
        }),
        { id: "editor.save", title: "Save File", category: "View" },
      ),
      commands.register(
        "mux.closePane",
        run(() => {
          const w = windowsRef.current.find(
            x => x.id === activeWindowIdRef.current,
          )
          if (!w?.focusedPaneId) return
          const pty = listPaneLeaves(w.tree).find(
            p => p.panelId.id === w.focusedPaneId!.id,
          )
          if (pty) void closePaneRef.current(w.id, pty.panelId, pty.ptyTabId)
        }),
        { id: "mux.closePane", title: "Close Pane", category: "Terminal" },
      ),
      commands.register(
        "mux.focusLeft",
        run(() => focusNeighborRef.current("left")),
        { id: "mux.focusLeft", title: "Focus Pane Left", category: "Terminal" },
      ),
      commands.register(
        "mux.focusRight",
        run(() => focusNeighborRef.current("right")),
        {
          id: "mux.focusRight",
          title: "Focus Pane Right",
          category: "Terminal",
        },
      ),
      commands.register(
        "mux.focusUp",
        run(() => focusNeighborRef.current("up")),
        { id: "mux.focusUp", title: "Focus Pane Up", category: "Terminal" },
      ),
      commands.register(
        "mux.focusDown",
        run(() => focusNeighborRef.current("down")),
        { id: "mux.focusDown", title: "Focus Pane Down", category: "Terminal" },
      ),
      commands.register(
        "mux.zoomPane",
        run(() => {
          const w = windowsRef.current.find(
            x => x.id === activeWindowIdRef.current,
          )
          if (!w?.focusedPaneId) return
          const pty = listPaneLeaves(w.tree).find(
            p => p.panelId.id === w.focusedPaneId!.id,
          )
          if (pty) zoomPaneRef.current(w.id, pty.ptyTabId)
        }),
        { id: "mux.zoomPane", title: "Zoom Pane", category: "Terminal" },
      ),
      commands.register(
        "terminal.list",
        run(() => setTerminalListOpen(true)),
        { id: "terminal.list", title: "Switch Terminal", category: "Terminal" },
      ),
      commands.register(
        "ui.showThemePicker",
        run(() => setSettingsOpen(true)),
        {
          id: "ui.showThemePicker",
          title: "Theme Picker",
          category: "View",
        },
      ),
      commands.register(
        "ui.showCommandPalette",
        run(() => setPaletteOpen(true)),
        {
          id: "ui.showCommandPalette",
          title: "Command Palette",
          category: "View",
        },
      ),
      commands.register(
        "settings.show",
        run(() => setSettingsOpen(true)),
        { id: "settings.show", title: "Settings", category: "View" },
      ),
      commands.register(
        "workspace.cd",
        run(() => setCdOpen(true)),
        { id: "workspace.cd", title: "Change Directory", category: "Terminal" },
      ),
      commands.register(
        "ui.zoomIn",
        run(() => handleZoom(1)),
        { id: "ui.zoomIn", title: "Zoom In", category: "View" },
      ),
      commands.register(
        "ui.zoomOut",
        run(() => handleZoom(-1)),
        { id: "ui.zoomOut", title: "Zoom Out", category: "View" },
      ),
      commands.register(
        "ui.resetAppearance",
        run(() => resetAppearanceSettings()),
        {
          id: "ui.resetAppearance",
          title: "Reset Appearance",
          category: "UI",
          aliases: ["reset theme", "reset font"],
        },
      ),
      ...bundledThemeList.map(theme =>
        commands.register(
          `ui.setTheme.${theme.id}`,
          run(() => {
            setAppearanceSettings(prev => ({ ...prev, themeId: theme.id }))
            showYaadeToast(`Theme: ${theme.name}`)
          }),
          {
            id: `ui.setTheme.${theme.id}`,
            title: `Theme: ${theme.name}`,
            category: "UI",
            aliases: [theme.family ?? "", theme.scheme ?? "", "theme"].filter(
              Boolean,
            ),
          },
        ),
      ),
    ]
    setCommandRevision(r => r + 1)
    return () => {
      for (const d of disposers) d.dispose()
    }
  }, [commands, handleZoom, resetAppearanceSettings, setAppearanceSettings])

  // Subscribe before registerUser — otherwise the initial onDidChange is missed and
  // keymapBindings stays stuck on the empty first-render snapshot.
  useEffect(() => {
    const sub = keymaps.onDidChange.event(() => setKeymapRevision(r => r + 1))
    return () => sub.dispose()
  }, [keymaps])

  /** tmux send-prefix: press the prefix twice to pass it through to the shell. */
  const sendPrefixLiteral = useCallback(() => {
    const byte = prefixLiteralByte(MUX_PREFIX)
    if (!byte) return
    const tabId = focusedPtyTabIdRef.current
    if (!tabId) return
    const ptyId = terminalPtyIdForTab(tabId)
    const terminal =
      typeof window !== "undefined" ? window.yaade?.terminal : undefined
    if (!ptyId || !terminal) return
    void terminal.write(ptyId, byte)
  }, [])

  useEffect(() => {
    const noOverlay = (ctx: KeymapContext) => !anyOverlayOpen(ctx)
    keymaps.registerUser([
      ...MUX_DIRECT_BINDINGS.map(b =>
        bind(
          b.key,
          () => {
            void executeCommand(b.command)
          },
          noOverlay,
        ),
      ),
      ...MUX_PREFIX_BINDINGS.map(b =>
        bind(
          muxPrefixBindingKey(b.key),
          () => {
            void executeCommand(b.command)
          },
          noOverlay,
        ),
      ),
      bind(muxPrefixBindingKey(MUX_PREFIX), () => sendPrefixLiteral(), noOverlay),
      // Escape belongs to the terminal — vim, less and fzf all need it. Claim
      // it only to restore a zoomed pane while focus sits outside the PTY.
      bind(
        "Escape",
        () => {
          unzoomIfNeeded()
        },
        ctx =>
          noOverlay(ctx) &&
          windowsRef.current.find(w => w.id === activeWindowIdRef.current)
            ?.zoomedPaneId != null &&
          !(
            typeof document !== "undefined" &&
            document.activeElement instanceof Element &&
            document.activeElement.closest(".xterm") != null
          ),
      ),
    ])
  }, [executeCommand, keymaps, sendPrefixLiteral, unzoomIfNeeded])

  const whichKeyEntries = useMemo<WhichKeyEntry[]>(
    () =>
      MUX_PREFIX_BINDINGS.map(b => ({
        key: formatKeyBinding(b.key),
        desc: b.desc,
      })),
    [],
  )

  /** Display shortcut for a command id from the mux prefix binding table. */
  const shortcutFor = useCallback((commandId: string): string | undefined => {
    const binding = MUX_PREFIX_BINDINGS.find(b => b.command === commandId)
    if (!binding) return undefined
    return formatKeyBinding(muxPrefixBindingKey(binding.key))
  }, [])

  const statusStripActions = useMemo<MuxStatusStripAction[]>(
    () => [
      {
        id: "terminal.new",
        label: "New",
        icon: "new",
        shortcut: shortcutFor("terminal.new"),
        onClick: () => void executeCommand("terminal.new"),
      },
      {
        id: "ui.showCommandPalette",
        label: "Palette",
        icon: "palette",
        shortcut: shortcutFor("ui.showCommandPalette"),
        onClick: () => void executeCommand("ui.showCommandPalette"),
      },
      {
        id: "editor.projectSearch",
        label: "Search",
        icon: "search",
        shortcut: shortcutFor("editor.projectSearch"),
        onClick: () => void executeCommand("editor.projectSearch"),
      },
      {
        id: "workspace.cd",
        label: "Directory",
        icon: "cd",
        shortcut: shortcutFor("workspace.cd"),
        onClick: () => void executeCommand("workspace.cd"),
      },
      {
        id: "settings.show",
        label: "Settings",
        icon: "settings",
        shortcut: shortcutFor("settings.show"),
        onClick: () => void executeCommand("settings.show"),
      },
    ],
    [executeCommand, shortcutFor],
  )

  const keymapBindings = useMemo(
    () => keymaps.allBindings(),
    [keymaps, keymapRevision],
  )

  const keymapContext: KeymapContext = useMemo(() => {
    const focusedKind: MuxLeafKind | null = (() => {
      if (!activeWindow?.focusedPaneId) return null
      const leaf = listPaneLeaves(activeWindow.tree).find(
        l => l.panelId.id === activeWindow.focusedPaneId!.id,
      )
      return leaf?.kind ?? null
    })()
    return {
      ...EMPTY_KEYMAP_OVERLAYS,
      // Editor overlays share the quick-open gate so the global listener bails.
      quickOpenOpen: quickOpenOpen || projectSearchOpen,
      editorFocus: focusedKind === "editor",
      paletteOpen,
      cdOpen,
      terminalListOpen,
      settingsOpen,
      workspaceOpen: workspace.manager.hasFolders(),
      terminalFocus: focusedKind === "terminal",
    }
  }, [
    activeWindow,
    cdOpen,
    paletteOpen,
    projectSearchOpen,
    quickOpenOpen,
    settingsOpen,
    terminalListOpen,
    workspace,
  ])

  useGlobalKeymap({
    keymapBindings,
    getKeyBindings: () => keymaps.allBindings(),
    keymapContext,
    workspace,
    getFocusedPanel: () => activeWindow?.focusedPaneId ?? null,
    getEditorPanel: () => null,
    executeCommand,
    runKeyBinding: (binding: JetKeyBinding) => {
      void binding.run(getCommandContext())
    },
    setPendingChordPrefix,
  })

  useEffect(() => {
    window.__yaadeAgent = createAgentBridge(() => ({
      workspace,
      commands,
      panelTree: activeWindow?.tree ?? emptyMuxTree(),
      focusedPanel: activeWindow?.focusedPaneId ?? null,
      paletteOpen,
      message: null,
      layoutReady,
      fontSize,
      executeCommand,
      openWorkspace,
      addWorkspace: openWorkspace,
      listWorkspaces: () =>
        workspace.folders.map(folder => ({
          id: folder.id,
          path: folder.root.path,
          name: folder.root.name,
        })),
      setFontSize,
      openFile: (uri, _path) => {
        openEditorInFocusedRef.current({ uri })
      },
      sessionMode: "terminal",
      sessionLayout: "sidebar",
      agentChatEnabled: false,
      route: "session",
      sessionId,
      sessionCwd: sessionCwdPath,
      backToProject: onBackToProject,
    }))
    return () => {
      delete window.__yaadeAgent
    }
  }, [
    activeWindow,
    commands,
    executeCommand,
    fontSize,
    layoutReady,
    onBackToProject,
    openWorkspace,
    paletteOpen,
    sessionCwdPath,
    sessionId,
    setFontSize,
    workspace,
  ])

  const workspaceSurfaceRef = useRef<HTMLDivElement>(null)
  const dockSurfaceRef = useRef<HTMLDivElement>(null)
  const activeLeaves = useMemo(
    () => (activeWindow ? listPaneLeaves(activeWindow.tree) : []),
    [activeWindow],
  )
  const activePtyIds = useMemo(
    () =>
      activeLeaves
        .filter(l => l.kind === "terminal")
        .map(l => l.ptyTabId),
    [activeLeaves],
  )
  const allPtyIds = useMemo(() => {
    const ids: string[] = []
    const seen = new Set<string>()
    for (const w of windows) {
      for (const leaf of listTerminalLeaves(w.tree)) {
        if (seen.has(leaf.ptyTabId)) continue
        seen.add(leaf.ptyTabId)
        ids.push(leaf.ptyTabId)
      }
    }
    return ids
  }, [windows])
  const layoutEpoch = useMemo(() => {
    if (!activeWindow) return "0"
    const leaves = listPaneLeaves(activeWindow.tree)
      .map(l => `${l.panelId.id}:${l.ptyTabId}:${l.kind}`)
      .join("|")
    return `${leaves}#${activeWindow.zoomedPaneId ?? ""}`
  }, [activeWindow])

  const focusedLeaf = useMemo(() => {
    if (!activeWindow?.focusedPaneId) return null
    return (
      activeLeaves.find(l => l.panelId.id === activeWindow.focusedPaneId!.id) ??
      null
    )
  }, [activeWindow, activeLeaves])
  const focusedPtyTabId = useMemo(
    () => (focusedLeaf?.kind === "terminal" ? focusedLeaf.ptyTabId : null),
    [focusedLeaf],
  )
  focusedPtyTabIdRef.current = focusedPtyTabId

  const slotBoxes = useMuxTerminalSlotBoxes(
    workspaceSurfaceRef,
    dockSurfaceRef,
    activeWindow?.zoomedPaneId
      ? isTerminalTabId(activeWindow.zoomedPaneId)
        ? [activeWindow.zoomedPaneId]
        : []
      : activePtyIds,
    layoutEpoch,
  )
  slotBoxesRef.current = slotBoxes

  // Touch LRU when focus changes so background windows stay warm briefly.
  useEffect(() => {
    if (!focusedPtyTabId) return
    const lru = terminalLruRef.current.filter(id => id !== focusedPtyTabId)
    lru.unshift(focusedPtyTabId)
    terminalLruRef.current = lru.slice(0, MAX_MOUNTED_TERMINALS)
  }, [focusedPtyTabId])

  const mountedPtyIds = useMemo(() => {
    const active = new Set(activePtyIds)
    const out: string[] = [...activePtyIds]
    for (const id of terminalLruRef.current) {
      if (active.has(id)) continue
      if (out.length >= MAX_MOUNTED_TERMINALS) break
      if (allPtyIds.includes(id)) {
        out.push(id)
        active.add(id)
      }
    }
    return out
  }, [activePtyIds, allPtyIds, focusedPtyTabId])

  // Poll foreground process for focused terminal + mounted agent panes.
  useEffect(() => {
    let cancelled = false
    const pollIds = (): string[] => {
      const ids = new Set<string>()
      if (focusedPtyTabId) ids.add(focusedPtyTabId)
      for (const id of mountedPtyIds) {
        if (terminalSessionForTab(id)?.agentId) ids.add(id)
      }
      return [...ids]
    }
    const tick = () => {
      if (cancelled) return
      for (const id of pollIds()) {
        void refreshForegroundProcess(id)
      }
    }
    tick()
    const handle = window.setInterval(tick, 2_000)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [mountedPtyIds, focusedPtyTabId, refreshForegroundProcess])

  const overlayBlocksTerminalFocus =
    paletteOpen ||
    terminalListOpen ||
    settingsOpen ||
    cdOpen ||
    quickOpenOpen ||
    projectSearchOpen

  const renderTerminal = useCallback(
    (ptyTabId: string, focused: boolean, slotVisible: boolean): ReactNode => {
      const session = terminalSessionForTab(ptyTabId)
      const termFocused = focused && !overlayBlocksTerminalFocus
      const host = (
        <Suspense fallback={null}>
          <TerminalPanel
            cwdRootUri={session?.cwdRootUri ?? cwdUri()}
            launchCommand={session?.launchCommand}
            launchArgs={session?.launchArgs}
            launchEnv={session?.launchEnv}
            theme={activeTheme as YaadeTheme}
            tabId={ptyTabId}
            focused={termFocused}
            isActive={termFocused}
            existingPtyId={session?.ptyId}
            status={session?.status}
            exitCode={session?.exitCode}
            sessionGeneration={session?.generation}
            onPtyId={(tabId, ptyId) => {
              trackTerminalPtyId(tabId, ptyId)
              // Persist promptly so reload can reattach this PTY id.
              persist()
            }}
            onInput={recordTerminalUserInput}
            onOutput={recordTerminalOutput}
            onTitleChange={(id, title) => {
              const prevLabel = workspace.tabRegistry.get(id)?.label
              if (prevLabel !== title) {
                workspace.tabRegistry.update(id, { label: title })
              }
              const fromTitle = cwdUriFromTerminalTitle(
                title,
                homeDirRef.current || "",
              )
              if (fromTitle) updateTerminalLiveCwd(id, fromTitle)
              void refreshForegroundProcess(id)
              // Only re-render mux chrome when the visible title actually changes.
              if (prevLabel !== title) bumpSessions()
              const winId = activeWindowIdRef.current
              if (!winId) return
              updateWindow(winId, w => {
                const leaves = listPaneLeaves(w.tree)
                if (leaves.length !== 1 || leaves[0]?.ptyTabId !== id) return w
                const nextTitle = paneTitle(id)
                if (w.title === nextTitle) return w
                return { ...w, title: nextTitle }
              })
            }}
            visible={slotVisible}
            onFailed={() => markTerminalFailed(ptyTabId)}
            onRestart={() => {
              const ptyId = terminalPtyIdForTab(ptyTabId)
              if (ptyId) void window.yaade?.terminal?.dispose(ptyId)
              restartTerminalSession(ptyTabId)
            }}
            onExit={() => {
              const session = terminalSessionForTab(ptyTabId)
              if (!isNeovimLaunchCommand(session?.launchCommand)) return
              const w = windowsRef.current.find(x =>
                listPaneLeaves(x.tree).some(p => p.ptyTabId === ptyTabId),
              )
              if (!w) return
              const leaf = listPaneLeaves(w.tree).find(
                p => p.ptyTabId === ptyTabId,
              )
              if (leaf) {
                void closePane(w.id, leaf.panelId, ptyTabId, {
                  skipConfirm: true,
                })
              }
            }}
            onClose={() => {
              const w = windowsRef.current.find(
                x => x.id === activeWindowIdRef.current,
              )
              if (!w) return
              const leaf = listPaneLeaves(w.tree).find(
                p => p.ptyTabId === ptyTabId,
              )
              if (leaf) void closePane(w.id, leaf.panelId, ptyTabId)
            }}
          />
        </Suspense>
      )

      const live = windowsRef.current.find(w =>
        listPaneLeaves(w.tree).some(l => l.ptyTabId === ptyTabId),
      )
      const leaf = live
        ? listPaneLeaves(live.tree).find(l => l.ptyTabId === ptyTabId)
        : null
      if (!live || !leaf) return host

      const canZoom = listPaneLeaves(live.tree).length > 1
      const zoomed = live.zoomedPaneId === ptyTabId

      return (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="h-full min-h-0 w-full">{host}</div>
          </ContextMenuTrigger>
          <ContextMenuContent data-yaade-mux-terminal-context-menu="">
            <ContextMenuItem
              onSelect={() => void splitPane(live.id, leaf.panelId, "right")}
            >
              Split Right
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => void splitPane(live.id, leaf.panelId, "bottom")}
            >
              Split Down
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => void openGitSplit(live.id, leaf.panelId)}
            >
              Open Git
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => void openNeovimSplit(live.id, leaf.panelId)}
            >
              Open Neovim
            </ContextMenuItem>
            {canZoom ? (
              <ContextMenuItem
                onSelect={() => zoomPane(live.id, ptyTabId)}
              >
                {zoomed ? "Restore Pane" : "Zoom Pane"}
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem onSelect={() => openBrowserProjectTab()}>
              New Browser Tab
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={() => void closePane(live.id, leaf.panelId, ptyTabId)}
            >
              Close Pane
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )
    },
    [
      activeTheme,
      closePane,
      cwdUri,
      openBrowserProjectTab,
      openGitSplit,
      openNeovimSplit,
      overlayBlocksTerminalFocus,
      paneTitle,
      persist,
      refreshForegroundProcess,
      splitPane,
      updateWindow,
      workspace,
      zoomPane,
    ],
  )

  const renderEditor = useCallback(
    (tabId: string, panelId: PanelId, focused: boolean): ReactNode => {
      const file =
        editorFiles[tabId] ??
        (isFileEditorTabId(tabId) ? { uri: tabId } : null)
      if (!file) return null
      return (
        <Suspense
          fallback={
            <div className="min-h-0 flex-1 animate-pulse bg-background/10" />
          }
        >
          <MuxEditorPane
            uri={file.uri}
            line={file.line}
            column={file.column}
            theme={activeTheme as YaadeTheme}
            focused={focused}
            viewStateId={`mux-editor-${panelId.id}`}
            onDirtyChange={dirty =>
              setEditorDirty(prev =>
                prev[tabId] === dirty ? prev : { ...prev, [tabId]: dirty },
              )
            }
            onQuickOpen={() => setQuickOpenOpen(true)}
            onCommandPalette={() => setPaletteOpen(true)}
            onEnsureLsp={uri => void ensureLspForFileRef.current(uri)}
          />
        </Suspense>
      )
    },
    [activeTheme, editorFiles],
  )

  const onQuickOpenSearch = useCallback(
    async (query: string): Promise<string[]> => {
      const root = cwdUri()
      const search =
        typeof window !== "undefined" ? window.yaade?.search : undefined
      if (!root || !search) return []
      try {
        return await search.fileSearch(root, query, { pageSize: 50 })
      } catch {
        return []
      }
    },
    [cwdUri],
  )

  const onQuickOpenSelect = useCallback(
    (path: string) => {
      openEditorInFocused({ uri: resolveEditorUri(cwdUri(), path) })
    },
    [cwdUri, openEditorInFocused],
  )

  const onProjectSearch = useCallback(
    async (query: string): Promise<ProjectSearchResult[]> => {
      const root = cwdUri()
      const search =
        typeof window !== "undefined" ? window.yaade?.search : undefined
      if (!root || !search) return []
      try {
        return await search.project(root, query)
      } catch {
        return []
      }
    },
    [cwdUri],
  )

  const onProjectSearchSelect = useCallback(
    (result: ProjectSearchResult) => {
      openEditorInFocused({
        uri: resolveEditorUri(cwdUri(), result.path),
        line: result.line,
      })
    },
    [cwdUri, openEditorInFocused],
  )

  const paletteCommands = commands.list().map(c => ({
    id: c.id,
    title: c.title,
    category: c.category,
    aliases: c.aliases,
    keybinding: shortcutFor(c.id),
  }))
  void commandRevision
  void paletteOpen

  const switcherItems = useMemo<PaletteShellItem<MuxSwitcherEntry>[]>(
    () =>
      switcherEntries.map(e => ({
        key: e.ptyTabId,
        value: `${e.windowTitle} ${e.title}`,
        data: e,
      })),
    [switcherEntries],
  )

  const footer = pendingChordPrefix ? (
    <WhichKeyPanel
      prefix={formatKeyBinding(pendingChordPrefix)}
      entries={whichKeyEntries}
    />
  ) : (
    <MuxStatusStrip
      prefixLabel={formatKeyBinding(MUX_PREFIX)}
      actions={statusStripActions}
    />
  )

  const muxBody = (
    <TabDndRoot handlers={tabDnd}>
      <div
        className="flex h-full min-h-0 w-full flex-col"
        data-yaade-shell={embedded ? "mux-embedded" : "mux"}
        data-yaade-mux=""
        data-yaade-session-id={sessionId}
        data-yaade-session-cwd={sessionCwdPath}
        data-yaade-worktree-branch={sessionWorktreeBranch ?? undefined}
      >
        {!embedded && (onBackToProject || sessionTitle) ? (
          <div
            className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3"
            data-yaade-session-chrome=""
          >
            {onBackToProject ? (
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                data-yaade-session-back=""
                onClick={onBackToProject}
              >
                ← Project
              </button>
            ) : null}
            <span className="truncate text-xs font-medium text-foreground">
              {sessionTitle}
            </span>
            {sessionWorktreeBranch ? (
              <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-3xs text-muted-foreground">
                {sessionWorktreeBranch}
              </span>
            ) : null}
          </div>
        ) : null}
        <div
          ref={workspaceSurfaceRef}
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
        >
              {activeWindow ? (
                <div ref={dockSurfaceRef} className="h-full min-h-0 w-full">
                <MuxWindowView
                  key={activeWindow.id}
                  tree={activeWindow.tree}
                  focusedPanelId={activeWindow.focusedPaneId}
                  zoomedPaneId={activeWindow.zoomedPaneId}
                  paneTitle={paneTitle}
                  paneProcessName={paneProcessName}
                  onFocusPanel={panelId => {
                    const pty = listPaneLeaves(activeWindow.tree).find(
                      p => p.panelId.id === panelId.id,
                    )
                    focusPane(activeWindow.id, panelId, pty?.ptyTabId)
                  }}
                  onEvent={event => handlePanelEvent(activeWindow.id, event)}
                  tabDnd={tabDnd}
                  onSplit={(panelId, edge) =>
                    void splitPane(activeWindow.id, panelId, edge)
                  }
                  onOpenGit={panelId =>
                    void openGitSplit(activeWindow.id, panelId)
                  }
                  onOpenNeovim={panelId =>
                    void openNeovimSplit(activeWindow.id, panelId)
                  }
                  onOpenEditor={panelId =>
                    void openEditorSplit(activeWindow.id, panelId, {
                      forceNewGroup: true,
                    })
                  }
                  onOpenFile={(panelId, filePath, line) => {
                    const leaf = listPaneLeaves(activeWindow.tree).find(
                      p => p.panelId.id === panelId.id,
                    )
                    const rootUri = leaf
                      ? (gitRoots[leaf.ptyTabId] ?? cwdUri())
                      : cwdUri()
                    void openEditorSplit(activeWindow.id, panelId, {
                      uri: resolveEditorUri(rootUri, filePath),
                      line,
                    })
                  }}
                  onZoom={ptyTabId => zoomPane(activeWindow.id, ptyTabId)}
                  onClosePane={(panelId, ptyTabId) =>
                    void closePane(activeWindow.id, panelId, ptyTabId)
                  }
                  onActivateEditorTab={(panelId, tabId) =>
                    activateEditorTab(activeWindow.id, panelId, tabId)
                  }
                  onCloseEditorTab={(panelId, tabId) =>
                    closeEditorTab(activeWindow.id, panelId, tabId)
                  }
                  onEmptyOpenTerminal={() => {
                    void executeCommand("terminal.new")
                  }}
                  onEmptyOpenNeovim={() => {
                    void executeCommand("mux.openNeovim")
                  }}
                  onEmptyOpenGit={() => {
                    void executeCommand("mux.openGit")
                  }}
                  onEmptyOpenEditor={() => {
                    void executeCommand("mux.openEditor")
                  }}
                  onEmptyOpenAgent={driver => {
                    openAgentCliPane(driver)
                  }}
                  onNewWindow={() => openBrowserProjectTab()}
                  gitRootForTab={tabId =>
                    (gitRoots[tabId] ?? cwdUri()) || null
                  }
                  editorFileForTab={tabId =>
                    editorFiles[tabId] ??
                    (isFileEditorTabId(tabId) ? { uri: tabId } : null)
                  }
                  editorDirtyForTab={tabId => editorDirty[tabId] ?? false}
                  editorBuffersForPanel={panelId => {
                    const view = activeWindow.tree.getView(panelId)
                    if (!view || view.kind !== "tabs") return []
                    return panelTabIds(view)
                      .filter(id => isEditorTabId(id))
                      .map(tabId => ({
                        tabId,
                        label:
                          workspace.tabRegistry.get(tabId)?.label ??
                          editorLabelFromUri(tabId),
                        dirty: editorDirty[tabId] ?? false,
                      }))
                  }}
                  shortcutFor={shortcutFor}
                  renderEditor={renderEditor}
                  theme={activeTheme as YaadeTheme}
                  fontSize={fontSize}
                  empty={
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Empty pane
                    </div>
                  }
                />
                </div>
              ) : (
                <div
                  className="flex h-full min-h-0 w-full flex-col p-1"
                  data-yaade-mux-empty=""
                  aria-busy="true"
                  aria-label="Loading workspace"
                >
                  <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-md border border-border/40 bg-background/20">
                    <div className="flex h-5 shrink-0 items-center gap-1.5 border-b border-border/35 bg-background/40 px-1">
                      <div className="size-3 shrink-0 animate-pulse rounded-[0.2rem] bg-muted/50" />
                      <div className="h-2.5 w-24 animate-pulse rounded bg-muted/40" />
                    </div>
                    <div className="min-h-0 flex-1" />
                  </div>
                </div>
              )}
              <MuxTerminalLayer
                ptyTabIds={mountedPtyIds}
                boxes={slotBoxes}
                focusedPtyTabId={focusedPtyTabId}
                renderTerminal={renderTerminal}
              />
            </div>
          </div>
        </TabDndRoot>
  )

  const chrome = (
    <>
      {muxBody}
      <Suspense fallback={null}>
        <MuxOverlays
          paletteOpen={paletteOpen}
          onPaletteOpenChange={setPaletteOpen}
          paletteCommands={paletteCommands}
          onRunCommand={id => void executeCommand(id)}
          terminalListOpen={terminalListOpen}
          onTerminalListOpenChange={setTerminalListOpen}
          switcherItems={switcherItems}
          onSelectTerminal={entry => {
            focusPane(
              entry.windowId,
              { id: entry.panelId },
              entry.ptyTabId,
            )
          }}
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
          appearanceSettings={appearanceSettings}
          onAppearanceChange={setAppearanceSettings}
          onResetAppearance={resetAppearanceSettings}
          cdOpen={cdOpen}
          onCdOpenChange={setCdOpen}
          cdInitialPath={
            lastCwdUri
              ? fileUriToPath(lastCwdUri)
              : homeDirRef.current || null
          }
          onSelectFolder={openWorkspace}
          resolveHomeDir={async () => {
            if (window.yaade?.getHomeDir) {
              return window.yaade.getHomeDir()
            }
            return homeDirRef.current
          }}
          quickOpenOpen={quickOpenOpen}
          onQuickOpenOpenChange={setQuickOpenOpen}
          onQuickOpenSearch={onQuickOpenSearch}
          onQuickOpenSelect={onQuickOpenSelect}
          projectSearchOpen={projectSearchOpen}
          onProjectSearchOpenChange={setProjectSearchOpen}
          onProjectSearch={onProjectSearch}
          onProjectSearchSelect={onProjectSearchSelect}
        />
      </Suspense>

      <ConfirmDialogHost />
      <LiquidGlassFilter />
      {windows.some(w => listPaneLeaves(w.tree).some(l => l.kind === "editor")) ||
      Object.keys(editorFiles).length > 0 ? (
        <MuxLspHost
          workspace={workspace}
          onOpenFile={(uri, _path, line, column) => {
            openEditorInFocusedRef.current({ uri, line, column })
          }}
          onReady={ensure => {
            ensureLspForFileRef.current = ensure
          }}
        />
      ) : null}
      <Toaster position="bottom-right" />
    </>
  )

  return (
    <TooltipProvider>
      {embedded ? (
        <div
          className="flex h-full min-h-0 w-full flex-col overflow-hidden"
          data-yaade-app-shell=""
        >
          <div className="min-h-0 flex-1 overflow-hidden">{chrome}</div>
          {footer}
        </div>
      ) : (
        <AppShell footer={footer}>{chrome}</AppShell>
      )}
    </TooltipProvider>
  )
}
