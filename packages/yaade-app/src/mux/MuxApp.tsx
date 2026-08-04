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
import type { Edge, PanelId, YaadeTheme } from "@yaade/shared"
import { pathToFileUri, fileUriToPath } from "@yaade/shared"
import {
  AppShell,
  ConfirmDialogHost,
  LiquidGlassFilter,
  MuxTabStrip,
  TabDndRoot,
  Toaster,
  TooltipProvider,
  requestConfirm,
  type PaletteShellItem,
  type TabDndHandlers,
} from "@yaade/ui"
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
  markTerminalFailed,
  recordTerminalOutput,
  recordTerminalUserInput,
  registerTerminalSession,
  restartTerminalSession,
  subscribeTerminalSessions,
  terminalPtyIdForTab,
  terminalSessionForTab,
  terminalSessionNeedsCloseConfirmation,
  trackTerminalPtyId,
} from "../tabs/terminal-session.js"
import { allocTerminalSessionKey } from "../tab-routing.js"
import { applySessionPaneDrop } from "../session-layout.js"
import {
  activePtyInPanel,
  dockSourceLeavesIntoTree,
  emptyMuxTree,
  listPaneLeaves,
  listTerminalLeaves,
  placePtyInTree,
  removePtyFromTree,
} from "./layout.js"
import { MuxWindowView } from "./MuxWindowView.js"
import {
  MuxTerminalLayer,
  useMuxTerminalSlotBoxes,
} from "./MuxTerminalLayer.js"
import { readMuxState, writeMuxState } from "./store.js"
import type {
  MuxStatePersisted,
  MuxSwitcherEntry,
  MuxWindowPersisted,
  TabOrientation,
} from "./types.js"

const TerminalPanel = lazy(async () => {
  const mod = await import("@yaade/ui/terminal")
  return { default: mod.TerminalPanel }
})

const MuxOverlays = lazy(() => import("./MuxOverlays.js"))

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
  return windows.map(w => ({
    id: w.id,
    title: w.title,
    tree: w.tree.toJSON(),
    focusedPaneId: w.focusedPaneId?.id ?? null,
    zoomedPaneId: w.zoomedPaneId,
    paneOrder: listPaneLeaves(w.tree).map(p => p.ptyTabId),
  }))
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

  const initial = useMemo(() => readMuxState(), [])
  const [orientation, setOrientation] = useState<TabOrientation>(
    initial.orientation,
  )
  const [windows, setWindows] = useState<LiveWindow[]>(() =>
    hydrateWindows(initial.windows),
  )
  const [activeWindowId, setActiveWindowId] = useState<string | null>(
    initial.activeWindowId,
  )
  const [lastCwdUri, setLastCwdUri] = useState<string | null>(
    initial.lastCwdUri,
  )

  const windowsRef = useRef(windows)
  windowsRef.current = windows
  const activeWindowIdRef = useRef(activeWindowId)
  activeWindowIdRef.current = activeWindowId
  const lastCwdUriRef = useRef(lastCwdUri)
  lastCwdUriRef.current = lastCwdUri
  const orientationRef = useRef(orientation)
  orientationRef.current = orientation
  const homeDirRef = useRef("")
  const bootstrappedRef = useRef(false)

  const activeWindow =
    windows.find(w => w.id === activeWindowId) ?? windows[0] ?? null

  useEffect(() => subscribeTerminalSessions(() => bumpSessions()), [])

  const persist = useCallback(() => {
    const state: MuxStatePersisted = {
      version: 1,
      orientation: orientationRef.current,
      windows: persistWindows(windowsRef.current),
      activeWindowId: activeWindowIdRef.current,
      lastCwdUri: lastCwdUriRef.current,
    }
    writeMuxState(state)
  }, [])

  useEffect(() => {
    persist()
  }, [windows, activeWindowId, orientation, lastCwdUri, persist])

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
      return (
        session?.customLabel ??
        workspace.tabRegistry.get(tabId)?.label ??
        "Terminal"
      )
    },
    [workspace],
  )

  const updateWindow = useCallback(
    (windowId: string, mutate: (w: LiveWindow) => LiveWindow) => {
      setWindows(prev => prev.map(w => (w.id === windowId ? mutate(w) : w)))
    },
    [],
  )

  const createPaneInWindow = useCallback(
    (
      live: LiveWindow,
      edge: Edge = "right",
      focusPanel: PanelId | null = live.focusedPaneId,
      options?: { launchCommand?: string; label?: string },
    ): LiveWindow => {
      const tree = live.tree.clone()
      const sessionKey = allocTerminalSessionKey()
      const ptyTabId = terminalTabId(sessionKey)
      const label =
        options?.label ?? `Terminal ${listPaneLeaves(tree).length + 1}`
      const rootUri = cwdUri()
      registerTerminalSession(ptyTabId, rootUri, options?.launchCommand, {
        customLabel: options?.label,
      })
      workspace.registerTab({
        id: ptyTabId,
        kind: "terminal",
        label,
      })
      const panelId = placePtyInTree(tree, ptyTabId, focusPanel, edge)
      const sole = listPaneLeaves(tree).length === 1
      return {
        ...live,
        tree,
        focusedPaneId: panelId,
        zoomedPaneId: null,
        title: sole ? label : live.title,
      }
    },
    [cwdUri, workspace],
  )

  const newWindow = useCallback(() => {
    const id = allocWindowId()
    const base: LiveWindow = {
      id,
      title: "Window",
      tree: emptyMuxTree(),
      focusedPaneId: null,
      zoomedPaneId: null,
    }
    const live = createPaneInWindow(base)
    setWindows(prev => [...prev, live])
    setActiveWindowId(id)
  }, [createPaneInWindow])

  const closeWindow = useCallback(
    async (windowId: string) => {
      const live = windowsRef.current.find(w => w.id === windowId)
      if (!live) return
      const panes = listPaneLeaves(live.tree)
      for (const pane of panes) {
        if (pane.kind !== "terminal") continue
        const session = terminalSessionForTab(pane.ptyTabId)
        if (terminalSessionNeedsCloseConfirmation(session)) {
          const ok = await requestConfirm({
            title: `Close ${paneTitle(pane.ptyTabId)}?`,
            description: "Running shells in this window will be stopped.",
            confirmLabel: "Close Window",
            cancelLabel: "Keep Running",
            destructive: true,
          })
          if (!ok) return
          break
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
      setWindows(prev => {
        const next = prev.filter(w => w.id !== windowId)
        if (activeWindowIdRef.current === windowId) {
          setActiveWindowId(next[0]?.id ?? null)
        }
        return next
      })
    },
    [paneTitle, workspace],
  )

  const closePane = useCallback(
    async (windowId: string, panelId: PanelId, tabId: string) => {
      const live = windowsRef.current.find(w => w.id === windowId)
      if (!live) return
      const isTerminal = isTerminalTabId(tabId)
      if (isTerminal) {
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
      const remaining = listPaneLeaves(live.tree).filter(
        p => p.ptyTabId !== tabId,
      )
      if (remaining.length === 0) {
        await closeWindow(windowId)
        return
      }
      if (isTerminal) {
        const ptyId = terminalPtyIdForTab(tabId)
        if (ptyId) void window.yaade?.terminal?.dispose(ptyId)
        clearTerminalSession(tabId)
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

  const splitPane = useCallback(
    (windowId: string, panelId: PanelId, edge: "right" | "bottom") => {
      updateWindow(windowId, w => createPaneInWindow(w, edge, panelId))
    },
    [createPaneInWindow, updateWindow],
  )

  const openGitInWindow = useCallback(
    (
      live: LiveWindow,
      focusPanel: PanelId | null = live.focusedPaneId,
      edge: Edge = "right",
    ): LiveWindow => {
      const tree = live.tree.clone()
      const tabId = gitTabId(`pane-${Date.now().toString(36)}`)
      workspace.registerTab({
        id: tabId,
        kind: "git",
        label: "Git",
      })
      const panelId = placePtyInTree(tree, tabId, focusPanel, edge)
      return {
        ...live,
        tree,
        focusedPaneId: panelId,
        zoomedPaneId: null,
      }
    },
    [workspace],
  )

  const openGitSplit = useCallback(
    (windowId: string, panelId: PanelId) => {
      updateWindow(windowId, w => openGitInWindow(w, panelId, "right"))
    },
    [openGitInWindow, updateWindow],
  )

  const openNeovimSplit = useCallback(
    (windowId: string, panelId: PanelId) => {
      updateWindow(windowId, w =>
        createPaneInWindow(w, "right", panelId, {
          launchCommand: "nvim",
          label: "Neovim",
        }),
      )
    },
    [createPaneInWindow, updateWindow],
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

  const openWorkspace = useCallback(
    async (folderPath: string) => {
      await workspace.openWorkspace(folderPath)
      const uri =
        workspace.manager.activeFolder?.root.uri ?? pathToFileUri(folderPath)
      setLastCwdUri(uri)
      setLayoutReady(true)
    },
    [workspace],
  )

  useEffect(() => {
    if (bootstrappedRef.current) return
    bootstrappedRef.current = true
    let cancelled = false
    void (async () => {
      try {
        if (window.yaade?.getHomeDir) {
          homeDirRef.current = await window.yaade.getHomeDir()
        }
      } catch {
        homeDirRef.current = ""
      }
      if (cancelled) return
      try {
        const cfg = window.yaade?.getLaunchConfig
          ? await window.yaade.getLaunchConfig()
          : null
        if (cfg?.workspacePath) {
          await openWorkspace(cfg.workspacePath)
        } else if (homeDirRef.current) {
          await openWorkspace(homeDirRef.current)
        } else {
          setLayoutReady(true)
        }
      } catch {
        setLayoutReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [openWorkspace])

  useEffect(() => {
    if (!layoutReady) return
    if (windowsRef.current.length > 0) return
    newWindow()
  }, [layoutReady, newWindow])

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
        const pty = activePtyInPanel(w.tree, panelId)
        return pty ? [pty] : []
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

  const newWindowRef = useRef(newWindow)
  newWindowRef.current = newWindow
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
        run(() => newWindowRef.current()),
        { id: "mux.newWindow", title: "New Window", category: "Terminal" },
      ),
      commands.register(
        "terminal.new",
        run(() => newWindowRef.current()),
        { id: "terminal.new", title: "New Terminal Window", category: "Terminal" },
      ),
      commands.register(
        "mux.closeWindow",
        run(() => {
          const id = activeWindowIdRef.current
          if (id) void closeWindowRef.current(id)
        }),
        { id: "mux.closeWindow", title: "Close Window", category: "Terminal" },
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
        "mux.toggleTabOrientation",
        run(() =>
          setOrientation(o => (o === "vertical" ? "horizontal" : "vertical")),
        ),
        {
          id: "mux.toggleTabOrientation",
          title: "Toggle Tab Orientation",
          category: "View",
        },
      ),
      commands.register(
        "terminal.show",
        run(() => {}),
        { id: "terminal.show", title: "Show Terminal", category: "Terminal" },
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
      bind("Mod-t", () => newWindow(), noOverlay),
      bind("Mod-n", () => newWindow(), noOverlay),
      bind(
        "Mod-w",
        () => {
          void executeCommand("mux.closePane")
        },
        noOverlay,
      ),
      bind("Mod-k", () => {
        void executeCommand("terminal.list")
      }, noOverlay),
      bind("Mod-Shift-p", () => {
        void executeCommand("ui.showCommandPalette")
      }, noOverlay),
      bind("Mod-,", () => setSettingsOpen(true), noOverlay),
      bind(
        "Mod-Shift-Enter",
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
        "Escape",
        () => {
          unzoomIfNeeded()
        },
        ctx => noOverlay(ctx),
      ),
    ])
  }, [executeCommand, keymaps, newWindow, unzoomIfNeeded])

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

  // Eagerly load overlays so Mod-k / Mod-Shift-p never race an unmounted tree.
  useEffect(() => {
    if (!layoutReady) return
    void import("./MuxOverlays.js")
  }, [layoutReady])

  const workspaceSurfaceRef = useRef<HTMLDivElement>(null)
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
  // Keep hosts for every window so switching tabs doesn't remount PTYs.
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

  const slotBoxes = useMuxTerminalSlotBoxes(
    workspaceSurfaceRef,
    activeWindow?.zoomedPaneId
      ? isTerminalTabId(activeWindow.zoomedPaneId)
        ? [activeWindow.zoomedPaneId]
        : []
      : activePtyIds,
    layoutEpoch,
  )

  const focusedPtyTabId = useMemo(() => {
    if (!activeWindow?.focusedPaneId) return null
    const leaf = activeLeaves.find(
      l => l.panelId.id === activeWindow.focusedPaneId!.id,
    )
    return leaf?.kind === "terminal" ? leaf.ptyTabId : null
  }, [activeWindow, activeLeaves])

  const overlayBlocksTerminalFocus =
    paletteOpen || terminalListOpen || settingsOpen || cdOpen

  const renderTerminal = useCallback(
    (ptyTabId: string, focused: boolean): ReactNode => {
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
            onPtyId={trackTerminalPtyId}
            onInput={recordTerminalUserInput}
            onOutput={recordTerminalOutput}
            onTitleChange={(id, title) => {
              workspace.tabRegistry.update(id, { label: title })
              bumpSessions()
              const winId = activeWindowIdRef.current
              if (!winId) return
              updateWindow(winId, w => {
                const leaves = listPaneLeaves(w.tree)
                if (leaves.length === 1 && leaves[0]?.ptyTabId === id) {
                  return { ...w, title }
                }
                return w
              })
            }}
            onFailed={() => markTerminalFailed(ptyTabId)}
            onRestart={() => {
              const ptyId = terminalPtyIdForTab(ptyTabId)
              if (ptyId) void window.yaade?.terminal?.dispose(ptyId)
              restartTerminalSession(ptyTabId)
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
              onSelect={() => splitPane(live.id, leaf.panelId, "right")}
            >
              Split Right
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => splitPane(live.id, leaf.panelId, "bottom")}
            >
              Split Down
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => openGitSplit(live.id, leaf.panelId)}
            >
              Open Git
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => openNeovimSplit(live.id, leaf.panelId)}
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
            <ContextMenuItem onSelect={newWindow}>New Window</ContextMenuItem>
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
      newWindow,
      openGitSplit,
      openNeovimSplit,
      overlayBlocksTerminalFocus,
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

  const tabItems = windows.map(w => ({ id: w.id, title: w.title }))

  return (
    <TooltipProvider>
      <AppShell>
        <TabDndRoot handlers={tabDnd}>
          <div
            className={
              orientation === "vertical"
                ? "flex h-full min-h-0 w-full flex-row"
                : "flex h-full min-h-0 w-full flex-col"
            }
            data-yaade-shell="mux"
            data-yaade-mux=""
            data-orientation={orientation}
          >
            <MuxTabStrip
              orientation={orientation}
              tabs={tabItems}
              activeId={activeWindow?.id ?? null}
              onSelect={setActiveWindowId}
              onClose={id => void closeWindow(id)}
              onNew={newWindow}
              onToggleOrientation={() =>
                setOrientation(o =>
                  o === "vertical" ? "horizontal" : "vertical",
                )
              }
              enableDragDock
            />
            <div
              ref={workspaceSurfaceRef}
              className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
            >
              {activeWindow ? (
                <MuxWindowView
                  key={activeWindow.id}
                  tree={activeWindow.tree}
                  focusedPanelId={activeWindow.focusedPaneId}
                  zoomedPaneId={activeWindow.zoomedPaneId}
                  paneTitle={paneTitle}
                  onFocusPanel={panelId => {
                    const pty = listPaneLeaves(activeWindow.tree).find(
                      p => p.panelId.id === panelId.id,
                    )
                    focusPane(activeWindow.id, panelId, pty?.ptyTabId)
                  }}
                  onEvent={event => handlePanelEvent(activeWindow.id, event)}
                  tabDnd={tabDnd}
                  onSplit={(panelId, edge) =>
                    splitPane(activeWindow.id, panelId, edge)
                  }
                  onOpenGit={panelId =>
                    openGitSplit(activeWindow.id, panelId)
                  }
                  onOpenNeovim={panelId =>
                    openNeovimSplit(activeWindow.id, panelId)
                  }
                  onZoom={ptyTabId => zoomPane(activeWindow.id, ptyTabId)}
                  onClosePane={(panelId, ptyTabId) =>
                    void closePane(activeWindow.id, panelId, ptyTabId)
                  }
                  onNewWindow={newWindow}
                  gitRootUri={cwdUri() || null}
                  theme={activeTheme as YaadeTheme}
                  empty={
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      No terminal panes
                    </div>
                  }
                />
              ) : (
                <div
                  className="flex h-full flex-col items-center justify-center gap-3"
                  data-yaade-mux-empty=""
                >
                  <p className="text-sm text-muted-foreground">No windows open</p>
                  <button
                    type="button"
                    data-yaade-mux-new-tab=""
                    className="rounded-md border border-border bg-card/70 px-3 py-1.5 text-xs"
                    onClick={newWindow}
                  >
                    New window
                  </button>
                </div>
              )}
              <MuxTerminalLayer
                ptyTabIds={allPtyIds}
                boxes={slotBoxes}
                focusedPtyTabId={focusedPtyTabId}
                renderTerminal={renderTerminal}
              />
            </div>
          </div>
        </TabDndRoot>

        {layoutReady ? (
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
        ) : null}

        <ConfirmDialogHost />
        <LiquidGlassFilter />
        <Toaster position="bottom-right" />
      </AppShell>
    </TooltipProvider>
  )
}
