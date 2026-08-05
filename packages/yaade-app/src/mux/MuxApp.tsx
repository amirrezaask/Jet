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
import type { PanelId, YaadeTheme } from "@yaade/shared"
import { pathToFileUri, fileUriToPath } from "@yaade/shared"
import {
  AppShell,
  ConfirmDialogHost,
  LiquidGlassFilter,
  TabDndRoot,
  Toaster,
  TooltipProvider,
  formatMuxTitle,
  requestConfirm,
  type PaletteShellItem,
  type TabDndHandlers,
} from "@yaade/ui"
import type { WorkspaceSession } from "@yaade/rpc"
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
  anyOverlayOpen,
  bind,
  gitTabId,
  isGitTabId,
  isTerminalTabId,
  terminalTabId,
  type JetCommandContext,
  type JetKeyBinding,
  type KeymapContext,
} from "@yaade/workspace"
import { createAgentBridge } from "../agent-bridge.js"
import { useAppearanceSettings } from "../hooks/useAppearanceSettings.js"
import { useGlobalKeymap } from "../hooks/useGlobalKeymap.js"
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
import {
  activeMuxTabInPanel,
  dockSourceLeavesIntoTree,
  emptyMuxTree,
  listPaneLeaves,
  listTerminalLeaves,
  removePtyFromTree,
} from "./layout.js"
import { findFocusNeighbor, type FocusDirection } from "./focus-neighbor.js"
import {
  placeGitPane,
  placeTerminalPane,
  type AllocatedGitPane,
  type AllocatedTerminalPane,
} from "./place-pane.js"
import { MuxWindowView } from "./MuxWindowView.js"
import {
  MuxTerminalLayer,
  useMuxTerminalSlotBoxes,
} from "./MuxTerminalLayer.js"
import { cwdUriFromTerminalTitle } from "./cwd-from-title.js"
import {
  projectRootFromLocation,
  urlPathForProjectRoot,
  workspaceDocumentTitle,
} from "../url-workspace.js"
import {
  loadWorkspaceSession,
  WorkspaceSessionPersistWriter,
} from "../workspace-session-client.js"
import type {
  MuxSessionLeafPersisted,
  MuxSwitcherEntry,
  MuxWindowPersisted,
} from "./types.js"

const TerminalPanel = lazy(async () => {
  const mod = await import("@yaade/ui/terminal")
  return { default: mod.TerminalPanel }
})

const MuxOverlays = lazy(() => import("./MuxOverlays.js"))
// Prefetch immediately so Mod-k / Mod-Shift-p never race an unloaded chunk.
void import("./MuxOverlays.js")

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

export function MuxApp() {
  const {
    appearanceSettings,
    setAppearanceSettings,
    activeTheme,
    fontSize,
    handleZoom,
    setFontSize,
    resetAppearanceSettings,
  } = useAppearanceSettings()

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

  const [layoutReady, setLayoutReady] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [terminalListOpen, setTerminalListOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cdOpen, setCdOpen] = useState(false)
  const [, setPendingChordPrefix] = useState<string | null>(null)
  const [, bumpSessions] = useReducer((n: number) => n + 1, 0)

  // One browser tab = one project window (no in-app tab strip).
  const [windows, setWindows] = useState<LiveWindow[]>([])
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null)
  const [lastCwdUri, setLastCwdUri] = useState<string | null>(null)
  /** Per git-pane workspace root (source shell cwd at open time). */
  const [gitRoots, setGitRoots] = useState<Record<string, string>>({})
  const sessionRootPathRef = useRef<string>("")
  const machineHostnameRef = useRef<string>("")
  const persistWriterRef = useRef(new WorkspaceSessionPersistWriter())
  const serverHydratedRef = useRef(false)
  /** Foreground process basename per terminal tab (Deck icons / titles). */
  const [processByTab, setProcessByTab] = useState<Record<string, string>>({})
  const processByTabRef = useRef(processByTab)
  processByTabRef.current = processByTab

  const windowsRef = useRef(windows)
  windowsRef.current = windows
  const activeWindowIdRef = useRef(activeWindowId)
  activeWindowIdRef.current = activeWindowId
  const lastCwdUriRef = useRef(lastCwdUri)
  lastCwdUriRef.current = lastCwdUri
  const gitRootsRef = useRef(gitRoots)
  gitRootsRef.current = gitRoots
  const homeDirRef = useRef("")
  const bootstrappedRef = useRef(false)
  const slotBoxesRef = useRef(new Map<string, import("./MuxTerminalLayer.js").MuxTerminalSlotBox>())
  /** LRU of recently focused terminal tab ids (beyond the active window). */
  const terminalLruRef = useRef<string[]>([])
  const MAX_MOUNTED_TERMINALS = 8

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

  const buildServerSession = useCallback((): WorkspaceSession | null => {
    const rootPath = sessionRootPathRef.current
    const machine = machineHostnameRef.current
    if (!rootPath || !machine) return null
    const persisted = persistWindows(windowsRef.current)
    const live = persisted[0]
    if (!live) {
      return {
        version: 1,
        machine,
        rootPath,
        layout: {
          tree: emptyMuxTree().toJSON(),
          focusedPaneId: null,
          zoomedPaneId: null,
        },
        sessions: [],
        ...(Object.keys(gitRootsRef.current).length > 0
          ? { gitRoots: { ...gitRootsRef.current } }
          : {}),
      }
    }
    return {
      version: 1,
      machine,
      rootPath,
      layout: {
        tree: live.tree,
        focusedPaneId: live.focusedPaneId,
        zoomedPaneId: live.zoomedPaneId,
      },
      sessions: live.sessions ?? [],
      ...(Object.keys(gitRootsRef.current).length > 0
        ? { gitRoots: { ...gitRootsRef.current } }
        : {}),
    }
  }, [])

  const persist = useCallback(() => {
    if (!serverHydratedRef.current) return
    const snapshot = buildServerSession()
    if (!snapshot) return
    persistWriterRef.current.enqueue(snapshot)
  }, [buildServerSession])

  useEffect(() => {
    persist()
  }, [windows, activeWindowId, lastCwdUri, gitRoots, persist])

  const cwdUri = useCallback((): string => {
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
      setProcessByTab(prev =>
        prev[ptyTabId] === name ? prev : { ...prev, [ptyTabId]: name },
      )
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
      label?: string
      rootUri?: string
    }): AllocatedTerminalPane => {
      const sessionKey = allocTerminalSessionKey()
      const ptyTabId = terminalTabId(sessionKey)
      const rootUri = options?.rootUri ?? cwdUri()
      const label = options?.label ?? "Terminal"
      registerTerminalSession(ptyTabId, rootUri, options?.launchCommand, {
        customLabel: options?.label,
        launchArgs: options?.launchArgs,
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

  /** Open another project in a browser tab (replaces in-app mux windows). */
  const openBrowserProjectTab = useCallback((absolutePath?: string) => {
    const home = homeDirRef.current
    const target = absolutePath
      ? urlPathForProjectRoot(absolutePath, home)
      : "/"
    window.open(target, "_blank", "noopener,noreferrer")
  }, [])

  /**
   * Ensure the page has a project window with at least one terminal pane.
   * Empty / git-only layouts get a blank shell so new browser tabs are never blank.
   */
  const ensureProjectWindow = useCallback(() => {
    const existing =
      windowsRef.current.find(w => w.id === activeWindowIdRef.current) ??
      windowsRef.current[0] ??
      null

    if (!existing) {
      const id = allocWindowId()
      const base: LiveWindow = {
        id,
        title: "Window",
        tree: emptyMuxTree(),
        focusedPaneId: null,
        zoomedPaneId: null,
      }
      const pane = allocTerminalPane()
      const live = placeTerminalPane(base, pane)
      setWindows([live])
      setActiveWindowId(id)
      return
    }

    if (listTerminalLeaves(existing.tree).length > 0) return

    const pane = allocTerminalPane()
    const live = placeTerminalPane(existing, pane)
    setWindows(prev =>
      prev.length === 0
        ? [live]
        : prev.map(w => (w.id === live.id ? live : w)),
    )
    setActiveWindowId(live.id)
  }, [allocTerminalPane])

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
      // Single-window model: replace with a fresh blank terminal, do not leave empty.
      const id = allocWindowId()
      const base: LiveWindow = {
        id,
        title: "Window",
        tree: emptyMuxTree(),
        focusedPaneId: null,
        zoomedPaneId: null,
      }
      const pane = allocTerminalPane()
      const next = placeTerminalPane(base, pane)
      setWindows([next])
      setActiveWindowId(id)
    },
    [allocTerminalPane, paneTitle, workspace],
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
      const remaining = listPaneLeaves(live.tree).filter(
        p => p.ptyTabId !== tabId,
      )
      // Last pane in the window → close the window with no consent prompt.
      const skipConfirm = Boolean(options?.skipConfirm) || remaining.length === 0
      const isTerminal = isTerminalTabId(tabId)
      if (!skipConfirm && isTerminal) {
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
      if (remaining.length === 0) {
        await closeWindow(windowId, { skipConfirm: true })
        return
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
    [closeWindow, paneTitle, updateWindow, workspace],
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

  const openGitSplit = useCallback(
    async (windowId: string, panelId: PanelId) => {
      const rootUri = await resolveSplitCwdUri(windowId, panelId)
      const pane = allocGitPane(rootUri)
      updateWindow(windowId, w => placeGitPane(w, pane, "right", panelId))
    },
    [allocGitPane, resolveSplitCwdUri, updateWindow],
  )

  const openNeovimSplit = useCallback(
    async (
      windowId: string,
      panelId: PanelId,
      options?: { filePath?: string; line?: number },
    ) => {
      const rootUri = await resolveSplitCwdUri(windowId, panelId)
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
    [allocTerminalPane, resolveSplitCwdUri, updateWindow],
  )

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
      document.title = workspaceDocumentTitle(folderPath, homeDirRef.current)
      setLayoutReady(true)
    },
    [workspace],
  )

  const applyServerSession = useCallback(
    (session: WorkspaceSession) => {
      if (session.gitRoots) {
        setGitRoots(session.gitRoots)
        gitRootsRef.current = session.gitRoots
      }
      const hasLeaves = session.sessions.length > 0
      if (!hasLeaves) {
        ensureProjectWindow()
        return
      }
      const windowPersisted: MuxWindowPersisted = {
        id: allocWindowId(),
        title: "Window",
        tree: session.layout.tree as MuxWindowPersisted["tree"],
        focusedPaneId: session.layout.focusedPaneId,
        zoomedPaneId: session.layout.zoomedPaneId,
        sessions: session.sessions.map(
          (s): MuxSessionLeafPersisted => ({
            ptyTabId: s.ptyTabId,
            cwdRootUri: s.cwdRootUri,
            liveCwdUri: s.liveCwdUri,
            launchCommand: s.launchCommand,
            launchArgs: s.launchArgs ? [...s.launchArgs] : undefined,
            label: s.label,
            // Host strips ptyId on save; never reattach stale ids.
          }),
        ),
      }
      try {
        hydratePersistedSessions([windowPersisted], workspace)
        const hydrated = hydrateWindows([windowPersisted])
        let live = hydrated[0]
        if (!live) {
          ensureProjectWindow()
          return
        }
        if (listTerminalLeaves(live.tree).length === 0) {
          const pane = allocTerminalPane()
          live = placeTerminalPane(live, pane)
        }
        setWindows([live])
        setActiveWindowId(live.id)
      } catch {
        ensureProjectWindow()
      }
    },
    [allocTerminalPane, ensureProjectWindow, workspace],
  )

  useEffect(() => {
    // Only skip after a successful boot. Do NOT set this at effect start —
    // React Strict Mode (dev) cancels the first run, and marking early would
    // leave the remount stuck on "Loading…" forever.
    if (bootstrappedRef.current) return
    let cancelled = false
    void (async () => {
      const finishBoot = () => {
        if (cancelled) return
        serverHydratedRef.current = true
        bootstrappedRef.current = true
      }

      try {
        if (window.yaade?.getHomeDir) {
          homeDirRef.current = await window.yaade.getHomeDir()
        }
      } catch {
        homeDirRef.current = ""
      }
      if (cancelled) return

      let machine = ""
      try {
        const sys = await fetch("/api/v1/system")
        if (sys.ok) {
          const body = (await sys.json()) as { machineHostname?: string }
          if (typeof body.machineHostname === "string") {
            machine = body.machineHostname
          }
        }
      } catch {
        /* ignore */
      }
      if (!machine) machine = "local"
      machineHostnameRef.current = machine
      if (cancelled) return

      try {
        const pathname =
          typeof location !== "undefined" ? location.pathname : "/"
        const fromUrl = projectRootFromLocation(homeDirRef.current, pathname)
        let rootPath: string | null = fromUrl

        // `/` (or empty): prefer host launchConfig workspace, else $HOME.
        if (
          rootPath &&
          homeDirRef.current &&
          (pathname === "/" || pathname === "")
        ) {
          try {
            const cfg = window.yaade?.getLaunchConfig
              ? await window.yaade.getLaunchConfig()
              : null
            if (cfg?.workspacePath) {
              rootPath = cfg.workspacePath
            }
          } catch {
            /* keep home */
          }
        }

        if (!rootPath) {
          setLayoutReady(true)
          ensureProjectWindow()
          finishBoot()
          return
        }

        await openWorkspace(rootPath)
        if (cancelled) return

        try {
          const saved = await loadWorkspaceSession(rootPath)
          if (cancelled) return
          applyServerSession(saved)
        } catch {
          ensureProjectWindow()
        }
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
    }
  }, [applyServerSession, ensureProjectWindow, openWorkspace, persist])

  const hasTerminalPane = windows.some(
    w => listTerminalLeaves(w.tree).length > 0,
  )

  useEffect(() => {
    if (!layoutReady) return
    if (hasTerminalPane) return
    ensureProjectWindow()
  }, [layoutReady, ensureProjectWindow, hasTerminalPane])

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
  const splitPaneRef = useRef(splitPane)
  splitPaneRef.current = splitPane
  const openGitSplitRef = useRef(openGitSplit)
  openGitSplitRef.current = openGitSplit
  const openNeovimSplitRef = useRef(openNeovimSplit)
  openNeovimSplitRef.current = openNeovimSplit
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
          const w = windowsRef.current.find(
            x => x.id === activeWindowIdRef.current,
          )
          if (!w?.focusedPaneId) {
            ensureProjectWindowRef.current()
            return
          }
          splitPaneRef.current(w.id, w.focusedPaneId, "right")
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
          const w = windowsRef.current.find(
            x => x.id === activeWindowIdRef.current,
          )
          if (!w?.focusedPaneId) return
          splitPaneRef.current(w.id, w.focusedPaneId, "right")
        }),
        { id: "mux.splitRight", title: "Split Right", category: "Terminal" },
      ),
      commands.register(
        "mux.splitDown",
        run(() => {
          const w = windowsRef.current.find(
            x => x.id === activeWindowIdRef.current,
          )
          if (!w?.focusedPaneId) return
          splitPaneRef.current(w.id, w.focusedPaneId, "bottom")
        }),
        { id: "mux.splitDown", title: "Split Down", category: "Terminal" },
      ),
      commands.register(
        "mux.openGit",
        run(() => {
          const w = windowsRef.current.find(
            x => x.id === activeWindowIdRef.current,
          )
          if (!w?.focusedPaneId) return
          openGitSplitRef.current(w.id, w.focusedPaneId)
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
          const w = windowsRef.current.find(
            x => x.id === activeWindowIdRef.current,
          )
          if (!w?.focusedPaneId) return
          openGitSplitRef.current(w.id, w.focusedPaneId)
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
          const w = windowsRef.current.find(
            x => x.id === activeWindowIdRef.current,
          )
          if (!w?.focusedPaneId) return
          openNeovimSplitRef.current(w.id, w.focusedPaneId)
        }),
        {
          id: "mux.openNeovim",
          title: "Open Neovim",
          category: "View",
          aliases: ["nvim", "vim", "neovim"],
        },
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
    ]
    setCommandRevision(r => r + 1)
    return () => {
      for (const d of disposers) d.dispose()
    }
  }, [commands, handleZoom])

  // Subscribe before registerUser — otherwise the initial onDidChange is missed and
  // keymapBindings stays stuck on the empty first-render snapshot.
  useEffect(() => {
    const sub = keymaps.onDidChange.event(() => setKeymapRevision(r => r + 1))
    return () => sub.dispose()
  }, [keymaps])

  useEffect(() => {
    const noOverlay = (ctx: KeymapContext) => !anyOverlayOpen(ctx)
    keymaps.registerUser([
      bind("Mod-t", () => openBrowserProjectTab(), noOverlay),
      bind(
        "Mod-n",
        () => {
          void executeCommand("mux.openNeovim")
        },
        noOverlay,
      ),
      bind(
        "Mod-g",
        () => {
          void executeCommand("mux.openGit")
        },
        noOverlay,
      ),
      bind(
        "Mod-w",
        () => {
          void executeCommand("mux.closePane")
        },
        noOverlay,
      ),
      bind("Mod-k", () => setTerminalListOpen(true), noOverlay),
      bind("Mod-Shift-p", () => setPaletteOpen(true), noOverlay),
      bind("Mod-,", () => setSettingsOpen(true), noOverlay),
      bind(
        "Mod-f",
        () => {
          void executeCommand("mux.zoomPane")
        },
        noOverlay,
      ),
      bind(
        "Mod-d",
        () => {
          void executeCommand("mux.splitRight")
        },
        noOverlay,
      ),
      bind(
        "Mod-Shift-d",
        () => {
          void executeCommand("mux.splitDown")
        },
        noOverlay,
      ),
      bind(
        "Mod-Alt-ArrowLeft",
        () => {
          void executeCommand("mux.focusLeft")
        },
        noOverlay,
      ),
      bind(
        "Mod-Alt-ArrowRight",
        () => {
          void executeCommand("mux.focusRight")
        },
        noOverlay,
      ),
      bind(
        "Mod-Alt-ArrowUp",
        () => {
          void executeCommand("mux.focusUp")
        },
        noOverlay,
      ),
      bind(
        "Mod-Alt-ArrowDown",
        () => {
          void executeCommand("mux.focusDown")
        },
        noOverlay,
      ),
      bind(
        "Escape",
        () => {
          unzoomIfNeeded()
        },
        ctx => noOverlay(ctx),
      ),
    ])
  }, [executeCommand, keymaps, openBrowserProjectTab, unzoomIfNeeded])

  const keymapBindings = useMemo(
    () => keymaps.allBindings(),
    [keymaps, keymapRevision],
  )

  const keymapContext: KeymapContext = useMemo(
    () => ({
      ...EMPTY_KEYMAP_OVERLAYS,
      editorFocus: false,
      paletteOpen,
      cdOpen,
      terminalListOpen,
      settingsOpen,
      workspaceOpen: workspace.manager.hasFolders(),
      terminalFocus: true,
    }),
    [cdOpen, paletteOpen, settingsOpen, terminalListOpen, workspace],
  )

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
      openFile: () => {},
      sessionMode: "terminal",
      sessionLayout: "sidebar",
      agentChatEnabled: false,
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
    openWorkspace,
    paletteOpen,
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

  const focusedPtyTabId = useMemo(() => {
    if (!activeWindow?.focusedPaneId) return null
    const leaf = activeLeaves.find(
      l => l.panelId.id === activeWindow.focusedPaneId!.id,
    )
    return leaf?.kind === "terminal" ? leaf.ptyTabId : null
  }, [activeWindow, activeLeaves])

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

  // Poll foreground process for mounted terminals (Deck icons / titles).
  useEffect(() => {
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      for (const id of mountedPtyIds) {
        void refreshForegroundProcess(id)
      }
    }
    tick()
    const handle = window.setInterval(tick, 2_000)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [mountedPtyIds, refreshForegroundProcess])

  const overlayBlocksTerminalFocus =
    paletteOpen || terminalListOpen || settingsOpen || cdOpen

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

  const paletteCommands = commands.list().map(c => ({
    id: c.id,
    title: c.title,
    category: c.category,
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

  return (
    <TooltipProvider>
      <AppShell>
        <TabDndRoot handlers={tabDnd}>
          <div
            className="flex h-full min-h-0 w-full flex-col"
            data-yaade-shell="mux"
            data-yaade-mux=""
          >
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
                  onOpenFile={(panelId, filePath, line) =>
                    void openNeovimSplit(activeWindow.id, panelId, {
                      filePath,
                      line,
                    })
                  }
                  onZoom={ptyTabId => zoomPane(activeWindow.id, ptyTabId)}
                  onClosePane={(panelId, ptyTabId) =>
                    void closePane(activeWindow.id, panelId, ptyTabId)
                  }
                  onNewWindow={() => openBrowserProjectTab()}
                  gitRootForTab={tabId =>
                    (gitRoots[tabId] ?? cwdUri()) || null
                  }
                  theme={activeTheme as YaadeTheme}
                  empty={
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      No terminal panes
                    </div>
                  }
                />
                </div>
              ) : (
                <div
                  className="flex h-full flex-col items-center justify-center gap-3"
                  data-yaade-mux-empty=""
                >
                  <p className="text-sm text-muted-foreground">Loading…</p>
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
          />
        </Suspense>

        <ConfirmDialogHost />
        <LiquidGlassFilter />
        <Toaster position="bottom-right" />
      </AppShell>
    </TooltipProvider>
  )
}
