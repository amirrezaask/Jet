import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useDeferredValue,
} from "react"
import type { PanelId, PanelView } from "@gharargah/shared"
import { pathToFileUri } from "@gharargah/shared"
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
} from "@gharargah/workspace"
import { createAgentBridge } from "./agent-bridge.js"
import {
  TabStore,
  TabTypeRegistry,
  PanelBody,
  StatusBar,
  bundledThemeList,
  getThemeById,
  siblingThemeForScheme,
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
  GharargahTitleBar,
  GharargahHome,
  TerminalSessionModal,
} from "@gharargah/ui"
import { APP_COMMAND_REGISTRY, buildAppCommands, buildMacTerminalQuickSwitchBindings } from "./app-commands.js"
import { registerBuiltinTabTypes } from "./tabs/index.js"
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
  getAllLeafPanels,
  resolveEditorPanel,
  getActiveTabId,
  closePanelIfEmpty,
} from "./panel-routing.js"
import { openTerminalTab } from "./tab-routing.js"
import { buildTerminalExplorerGroups, nextTerminalLabel } from "./terminal-explorer.js"
import { loadGlobalJetrc } from "./load-global-gharargahrc.js"
import { WorkspaceLayoutStore } from "./workspace-layout-store.js"
import { swapWorkspaceLayout } from "./swap-workspace-layout.js"
import { readProjectCatalog, writeProjectCatalog } from "./project-catalog-store.js"
import { useAppearanceSettings } from "./hooks/useAppearanceSettings.js"
import { usePanelLayout } from "./hooks/usePanelLayout.js"
import OverlayHost from "./OverlayHost.js"
import { useTerminalLifecycle } from "./hooks/useTerminalLifecycle.js"
import { useOverlayState } from "./hooks/useOverlayState.js"
import { useGlobalKeymap } from "./hooks/useGlobalKeymap.js"
import { createTabContributorBridge } from "./hooks/tab-contributor-bridge.js"
import type { TabContributorDeps } from "./tabs/deps.js"
import { OverlayControllerSync } from "./hooks/OverlayControllerSync.js"
import {
  OverlayControllerProvider,
  type OverlayHandlers,
} from "./hooks/OverlayController.js"

type ColorScheme = "dark" | "light"

const COMMAND_RECENTS_STORAGE_KEY = "jet-command-recents"

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
    setPaletteOpen,
    setTerminalListOpen,
    setCdOpen,
    setAddWorkspaceOpen,
    setSettingsOpen,
    setProjectSwitcherOpen,
    setSwitchFolderOpen,
    setFolderPickerOpen,
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
  const showWindowChrome = useMemo(() => detectWindowChrome(), [])
  const [, setTerminalSessionRevision] = useState(0)
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
  } = usePanelLayout(workspace, tabStore, appStateRef as never)

  const [keymapRevision, setKeymapRevision] = useState(0)
  const keymapBindings = useMemo(() => keymaps.allBindings(), [keymaps, keymapRevision])

  useEffect(() => {
    const sub = keymaps.onDidChange.event(() => setKeymapRevision(r => r + 1))
    return () => sub.dispose()
  }, [keymaps])

  useEffect(() => {
    const mirror = (id: string) => {
      const desc = workspace.tabRegistry.get(id)
      if (!desc) {
        tabStore.dispose(id)
        return
      }
      if (desc.kind === "terminal") {
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

  const openTerminalModal = useCallback((panelId: PanelId, tabId: string) => {
    setTerminalModalPanelId(panelId)
    setTerminalModalTabId(tabId)
  }, [])

  const closeTerminalModal = useCallback(() => {
    setTerminalModalTabId(null)
    setTerminalModalPanelId(null)
  }, [])

  const focusTerminalTab = useCallback(
    (panelId: PanelId, tabId: string) => {
      const focus = () => {
        const tree = cloneTree()
        const owningPanel = findPanelWithTab(tree, tabId) ?? panelId
        workspace.focusTabInPanel(tree, owningPanel, tabId)
        setFocusedPanel(owningPanel)
        commitTree(tree, owningPanel)
        openTerminalModal(owningPanel, tabId)
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
          launchCommand: shortcut.command,
        })
        openTerminalModal(panelId, tabId)
      } catch (err) {
        console.error("[gharargah] launchAgentFromHome failed", err)
        showGharargahToast(err instanceof Error ? err.message : String(err), { variant: "destructive" })
        closeTerminalModal()
      }
    },
    [openTerminalInWorkspace, openTerminalModal, closeTerminalModal],
  )

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
    },
    [workspace],
  )

  const tabContributorRef = useRef<TabContributorDeps>(null!)
  const tabContributorBridge = useMemo(
    () => createTabContributorBridge(() => tabContributorRef.current),
    [],
  )

  useEffect(() => {
    registerBuiltinTabTypes(tabTypeRegistry, tabContributorBridge)
  }, [tabTypeRegistry, tabContributorBridge])

  tabContributorRef.current = {
    workspace,
    getTheme: () => activeThemeRef.current,
    closeTerminalTab,
    onTerminalTitleChange,
  }

  const activeTabKindName = useMemo(() => {
    if (!focusedPanel) return undefined
    const view = panelTree.getView(focusedPanel)
    if (view?.kind !== "tabs") return undefined
    return workspace.tabRegistry.kindFor(view.activeTabId)
  }, [focusedPanel, panelTree, workspace])

  const keymapContext = useMemo(
    () => ({
      editorFocus: false,
      paletteOpen,
      quickOpenOpen: false,
      bufferListOpen: false,
      openFileOpen: false,
      cdOpen,
      projectSwitcherOpen,
      gotoLineOpen: false,
      outlineOpen: false,
      workspaceOpen: workspace.manager.hasFolders(),
      explorerFocus: false,
      terminalExplorerFocus: false,
      outputFocus: false,
      terminalFocus: activeTabKindName === "terminal" || terminalModalTabId != null,
      agentChatFocus: false,
      listFocus: false,
    }),
    [
      paletteOpen,
      cdOpen,
      projectSwitcherOpen,
      workspace.root,
      activeTabKindName,
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
        showGharargahToast(`Added ${folder.root.name}`)
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
          showGharargahToast(`Opened ${folderPath}`)
        } else {
          showGharargahToast(`Added ${folder.root.name}`)
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

  const getCommandContext = useCallback((): JetCommandContext => {
    return {
      workspace,
      ui: {
        showMessage: showGharargahToast,
        showCommandPalette: () => setPaletteOpen(true),
        setCommandPaletteOpen: setPaletteOpen,
      },
      getActiveEditorView: () => null,
    }
  }, [workspace, setPaletteOpen])

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
        setTerminalListOpen,
        setCdOpen,
        setAddWorkspaceOpen,
        setProjectSwitcherOpen,
        setSwitchFolderOpen,
        pickWorkspaceFolder,
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
        editorPanelRef,
        setZoomLevel: handleZoom,
        projectRegistry,
        refreshProjects,
        getActiveTerminalTabId,
        closeTerminalTab,
        getTerminalExplorerGroups,
        focusTerminalTab,
        openTerminalModal,
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
    (binding: JetKeyBinding) => {
      void binding.run(getCommandContext())
    },
    [getCommandContext],
  )

  const executeCommandRef = useRef<(name: string) => Promise<void>>(() => Promise.resolve())

  useEffect(() => {
    const noOverlay = (ctx: KeymapContext) => !anyOverlayOpen(ctx)
    const whenWorkspace = (ctx: KeymapContext) => ctx.workspaceOpen && noOverlay(ctx)
    keymaps.registerUser([
      bind("Cmd-p", appCommands.palette, noOverlay),
      bind("Cmd-Shift-p", appCommands.palette, noOverlay),
      bind("Cmd-k Cmd-o", appCommands.openFolder, noOverlay),
      bind("Cmd-w", appCommands.closeTab, whenWorkspace),
      bind("Ctrl-`", appCommands.terminal, whenWorkspace),
      bind("Cmd-=", appCommands.zoomIn, noOverlay),
      bind("Cmd--", appCommands.zoomOut, noOverlay),
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
        "ui.toggleColorScheme",
        () => {
          setAppearanceSettings(prev => {
            const current = getThemeById(prev.themeId)
            const nextScheme: ColorScheme = current.scheme === "light" ? "dark" : "light"
            const next = siblingThemeForScheme(prev.themeId, nextScheme)
            showGharargahToast(`Theme: ${next.name}`)
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
    )
    disposables.push(
      commands.register(
        "ui.setColorScheme.dark",
        () => {
          setAppearanceSettings(prev => {
            const next = siblingThemeForScheme(prev.themeId, "dark")
            showGharargahToast(`Theme: ${next.name}`)
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
            showGharargahToast(`Theme: ${next.name}`)
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
    }))
    return () => {
      delete window.__gharargahAgent
    }
  }, [workspace, commands, paletteOpen, layoutReady, executeCommand, setFontSize])

  useEffect(() => {
    if (!layoutReady || queryBootstrapDone.current) return
    queryBootstrapDone.current = true
    void (async () => {
      const cfg = window.gharargah?.getLaunchConfig ? await window.gharargah.getLaunchConfig() : null
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
    })()
  }, [layoutReady, workspace])

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
        paletteCommands={paletteCommands}
        terminalGroups={getTerminalExplorerGroups()}
      />
      <TooltipProvider>
        <AppShell
          footer={
            <>
              {pendingChordPrefix && (
                <WhichKeyPanel prefix={formatKeyBinding(pendingChordPrefix)} entries={whichKeyEntries} />
              )}
              <StatusBar
                lspStatus="off"
                workspaceFolderCount={workspace.folders.length}
                workspaceFolderNames={workspace.folders.map(folder => folder.root.name)}
                hasWorkspace={workspace.manager.hasFolders()}
              />
            </>
          }
        >
          <div className="flex h-full min-h-0 w-full flex-col" data-gharargah-shell="home">
            <GharargahTitleBar
              showWindowChrome={showWindowChrome}
              crumb={null}
              onHome={goHome}
            />

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
                  })),
                }))}
                onOpenTerminal={openTerminalFromHome}
                onNewTerminal={rootUri => void newTerminalFromHome(rootUri)}
                onLaunchAgentTerminal={(rootUri, shortcut) => void launchAgentFromHome(rootUri, shortcut)}
                onAddProject={() => setAddWorkspaceOpen(true)}
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
                  const label = workspace.tabRegistry.get(terminalModalTabId)?.label ?? "Terminal"
                  const rootUri = terminalCwdForTab(terminalModalTabId)
                  const project = workspace.folders.find(f => f.root.uri === rootUri)?.root.name
                  return project ? `${project} / ${label}` : label
                })()}
              >
                <PanelBody
                  panelId={terminalModalPanelId}
                  view={{
                    kind: "tabs",
                    activeTabId: terminalModalTabId,
                    tabIds: [terminalModalTabId],
                  } as PanelView}
                  store={tabStore}
                  registry={tabTypeRegistry}
                  focused
                />
              </TerminalSessionModal>
            ) : null}
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
