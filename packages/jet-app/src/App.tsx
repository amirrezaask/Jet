import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
  useDeferredValue,
} from "react"
import type { PanelEvent } from "@jet/panels"
import type { PanelId, PanelView } from "@jet/shared"
import { pathToFileUri, isUntitledUri, fileUriToPath } from "@jet/shared"
import {
  WorkspaceService,
  CommandRegistry,
  KeymapService,
  keyEventMatchesBinding,
  isChordBinding,
  resolveKeydownBinding,
  createChordState,
  anyOverlayOpen,
  createDefaultKeybindings,
  isEditorKeyBinding,
  parseBindingKey,
  CHORD_TIMEOUT_MS,
  type KeymapContext,
  type JetCommandContext,
  type JetKeyBinding,
  type LaunchConfig,
  type LocationItem,
  ProjectRegistry,
  JetPanelTree,
  type JetProject,
} from "@jet/workspace"
import { LanguageServerManager, LspClientPool } from "@jet/lsp"
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
  PanelDock,
  PanelBody,
  PanelHeader,
  CommandPalette,
  StatusBar,
  themeForScheme,
  GotoLineModal,
  OutlineOverlay,
  QuickOpenOverlay,
  BufferListOverlay,
  OpenFileOverlay,
  CdOverlay,
  ProjectSwitcherOverlay,
  getEditorView,
  getAllEditorViews,
  syncAllEditorThemes,
  destroyEditorPanel,
  setEditorCursor,
  formatKeyBinding,
  problemsToLocationItems,
  WhichKeyPanel,
  type OutlineEntry,
  type WhichKeyEntry,
  TooltipProvider,
  ConfirmDialogHost,
  Toaster,
  showJetToast,
  requestConfirm,
  AppShell,
  focusExplorerPanel,
  getListPanel,
  JetTitleBar,
  type JetTitleBarMenu,
  FindReplaceDrawer,
  WelcomeView,
} from "@jet/ui"
import type { JetProblem } from "@jet/shared"
import { APP_COMMAND_REGISTRY, buildAppCommands } from "./app-commands.js"
import {
  panelViewKind,
  getAllLeafPanels,
  resolveEditorPanel,
  getActiveEditorFileUri,
} from "./panel-routing.js"
import { loadWorkspaceInit, type JetInitContext } from "./load-workspace-init.js"
import { loadGlobalJetrc } from "./load-global-jetrc.js"
import { bootstrapFromLaunch } from "./launch-bootstrap.js"
import { useFileDrop } from "./use-file-drop.js"

const COLOR_SCHEME_KEY = "jet-color-scheme"
const COMMAND_RECENTS_STORAGE_KEY = "jet-command-recents"
const FONT_SIZE_STORAGE_KEY = "jet-font-size"
const DEFAULT_FONT_SIZE = 13
const FONT_SIZE_STEP = 2

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
  const [projects, setProjects] = useState<JetProject[]>([])
  const [searchScanReady, setSearchScanReady] = useState(false)
  const [problems, setProblems] = useState<JetProblem[]>([])
  const [panelRev, setPanelRev] = useState(0)
  const [lspCrashed, setLspCrashed] = useState(false)
  const [fileDragOver, setFileDragOver] = useState(false)
  const [recentCommands, setRecentCommands] = useState<string[]>(() => loadRecentCommands())
  const [pendingChordPrefix, setPendingChordPrefix] = useState<string | null>(null)
  const fontSizeRef = useRef(loadStoredFontSize())
  const initialized = useRef(false)
  const queryBootstrapDone = useRef(false)
  const openWorkspaceRef = useRef<(folderPath: string) => void>(() => {})
  const handleOpenFileRef = useRef<(uri: string, path: string) => void>(() => {})
  const editorPanelRef = useRef<PanelId | null>(initialLayout.editorPanel)
  const workspaceInitGen = useRef(0)
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

  const workspace = useMemo(() => new WorkspaceService(jetPlatformFS()), [])
  const commands = useMemo(() => new CommandRegistry(), [])
  const keymaps = useMemo(() => new KeymapService(), [])

  const keymapBindings = useMemo(() => keymaps.allBindings(), [keymaps, keymapRevision])

  useEffect(() => {
    const sub = keymaps.onDidChange.event(() => setKeymapRevision(r => r + 1))
    return () => sub.dispose()
  }, [keymaps])

  useEffect(() => {
    const sub = workspace.onDidChangeDirty.event(() => setPanelRev(r => r + 1))
    return () => sub.dispose()
  }, [workspace])

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

  const activeEditorFile = useMemo(() => {
    if (!focusedPanel) return null
    const view = panelTree.getView(focusedPanel)
    if (!view || view.kind !== "editor") return null
    const file = workspace.fileForUri(view.fileUri)
    if (!file) return null
    return { name: file.name, languageId: file.languageId, isDirty: file.isDirty }
  }, [focusedPanel, panelTree, workspace, panelRev])

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
      workspaceOpen: workspace.root != null,
      explorerFocus: activePanelKind === "explorer",
      locationListFocus: activePanelKind === "locationlist",
      outputFocus: activePanelKind === "output",
      listFocus:
        activePanelKind === "explorer" ||
        activePanelKind === "locationlist",
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
      if (!lspManager || !workspace.root) return null
      const path = isUntitledUri(fileUri) ? "" : fileUriToPath(fileUri)
      const file = workspace.fileForUri(fileUri) ?? workspace.createWorkspaceFile(fileUri, path)
      const conn = await lspManager.ensureServerForFile(file, workspace.root.uri)
      if (!conn) return null
      return lspClientPool.getOrCreateClient(conn)
    },
    [lspManager, workspace, lspClientPool],
  )

  const cloneTree = useCallback(
    () => JetPanelTree.jetFromJSON(appStateRef.current.panelTree.toJSON()),
    [],
  )

  const commitTree = useCallback((tree: JetPanelTree) => {
    setPanelTree(JetPanelTree.jetFromJSON(tree.toJSON()))
    setPanelRev(r => r + 1)
  }, [])

  const ensureLspForFile = useCallback(
    async (fileUri: string) => {
      if (!lspManager || !workspace.root || isUntitledUri(fileUri)) return
      const path = fileUriToPath(fileUri)
      const file = workspace.fileForUri(fileUri) ?? workspace.createWorkspaceFile(fileUri, path)
      const conn = await lspManager.ensureServerForFile(file, workspace.root.uri)
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
    if (!window.jet?.workspace?.onSearchReady) return
    return window.jet.workspace.onSearchReady(rootUri => {
      const current = workspace.root?.uri
      if (!current) return
      if (normalizeAbsPath(fileUriToPath(current)) !== normalizeAbsPath(fileUriToPath(rootUri))) return
      setSearchScanReady(true)
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

  const quickOpenSearch = useCallback(
    async (query: string) => {
      const root = workspace.root
      if (!root?.uri || !window.jet?.search?.fileSearch) return []
      const panel = focusedPanel
      const activeUri = panel ? getActiveEditorFileUri(panelTree, panel) : null
      let currentFile: string | undefined
      if (activeUri) {
        const abs = fileUriToPath(activeUri)
        const rootPath = normalizeAbsPath(root.path)
        const prefix = `${rootPath}/`
        currentFile = abs.startsWith(prefix) ? abs.slice(prefix.length) : abs
      }
      return window.jet.search.fileSearch(root.uri, query, {
        pageSize: 100,
        currentFile,
      })
    },
    [workspace, focusedPanel, panelTree],
  )

  const openLocationItem = useCallback(
    (item: LocationItem) => {
      pushJumpFromActiveEditor(item.source)
      handleOpenFileAt(item.fileUri, fileUriToPath(item.fileUri), item.line, item.column)
    },
    [handleOpenFileAt, pushJumpFromActiveEditor],
  )

  const syncProblemsToLocationList = useCallback(() => {
    const other = workspace.locationList.items.filter(i => i.source !== "problems")
    workspace.locationList.setItems([...other, ...problemsToLocationItems(problems)])
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

  const openWorkspaceFolder = useCallback(
    (folderPath: string) => {
      const gen = ++workspaceInitGen.current
      void workspace.openWorkspace(folderPath)
      workspaceRootPathRef.current = folderPath

      const { tree, sidebarPanel, editorPanel } = JetPanelTree.workspaceLayout()
      tree.setView(sidebarPanel, { kind: "explorer" })
      tree.setView(editorPanel, { kind: "empty" })
      editorPanelRef.current = editorPanel
      setPanelTree(tree)
      setFocusedPanel(editorPanel)
      showJetToast(`Opened ${folderPath}`)
      setSearchScanReady(false)

      const jetDir = `${folderPath.replace(/[/\\]+$/, "")}/.jet`
      const initCtx = workspaceInitCtxRef.current
      if (initCtx) {
        void loadWorkspaceInit(jetDir, initCtx).catch(err =>
          console.warn("Workspace init failed:", err),
        )
      }

      const finishOpen = () => {
        if (workspaceInitGen.current !== gen) return
        const rootUri = workspace.root?.uri
        if (!rootUri) return
        if (window.jet?.workspace) void window.jet.workspace.activate(rootUri)
        void window.jet?.search?.fileSearch(rootUri, "", { pageSize: 1 }).catch(() => {})
        void (async () => {
          for (let attempt = 0; attempt < 120; attempt++) {
            if (workspaceInitGen.current !== gen) return
            const ready = await window.jet?.search?.isScanReady?.(rootUri)
            if (ready) {
              setSearchScanReady(true)
              return
            }
            await new Promise(resolve => window.setTimeout(resolve, 250))
          }
          if (workspaceInitGen.current !== gen) return
          setSearchScanReady(true)
        })()
      }
      setTimeout(finishOpen, 0)
    },
    [workspace],
  )

  openWorkspaceRef.current = openWorkspaceFolder
  handleOpenFileRef.current = handleOpenFile

  const bootstrapFromLaunchForDrop = useCallback((config: LaunchConfig) => {
    bootstrapFromLaunch(
      path => openWorkspaceRef.current(path),
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
    workspaceRootPath: workspace.root?.path ?? workspaceRootPathRef.current,
    normalizePath: normalizeAbsPath,
    openWorkspace: path => openWorkspaceRef.current(path),
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
        const view = tree.getView(event.panelId)
        if (view?.kind === "editor") {
          destroyEditorPanel(event.panelId)
        }
        tree.closePanel(event.panelId)
        const leaves = getAllLeafPanels(tree)
        if (leaves.length > 0) {
          const closingId = event.panelId.id
          const next =
            leaves.find(p => p.id !== closingId) ??
            leaves[0]
          if (next) setFocusedPanel(next)
        }
      } else if (event.type === "panelDrop") {
        const sourceView = tree.getView(event.source)
        const moved = tree.applyDrop(event.source, event.target, event.action)
        if (!moved) {
          changed = false
        } else {
          if (sourceView?.kind === "editor") destroyEditorPanel(event.source)
          const leaves = getAllLeafPanels(tree)
          const next = leaves.find(p => p.id === event.target.id) ?? leaves[0]
          if (next) setFocusedPanel(next)
        }
      }
      if (changed) commitTree(tree)
    },
    [cloneTree, commitTree, setFocusedPanel],
  )

  const keymapTargetViewRef = useRef<EditorView | null>(null)

  const getCommandContext = useCallback((): JetCommandContext => {
    const currentFocusedPanel = appStateRef.current.focusedPanel
    return {
      workspace,
      ui: {
        showMessage: showJetToast,
        showCommandPalette: () => setPaletteOpen(true),
        setCommandPaletteOpen: setPaletteOpen,
      },
      getActiveEditorView: () => {
        if (keymapTargetViewRef.current) return keymapTargetViewRef.current
        const panel = currentFocusedPanel
        return panel ? (getEditorView(panel) ?? null) : null
      },
    }
  }, [workspace])

  const handlePanelNavigation = useCallback((action: string) => {
    const kind = appStateRef.current.activePanelKind
    if (kind !== "explorer" && kind !== "locationlist") return
    const el = getListPanel(kind)
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
  }, [])

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
        setGotoLineOpen,
        setMessage: showJetToast,
        setFocusedPanel,
        cloneTree,
        commitTree,
        openWorkspaceFolder,
        handlePanelEvent,
        openFileInEditor,
        openLocationItem,
        syncProblemsToLocationList,
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
      }),
    [
      workspace,
      cloneTree,
      commitTree,
      openWorkspaceFolder,
      handlePanelEvent,
      openFileInEditor,
      openLocationItem,
      syncProblemsToLocationList,
      handleZoom,
      handlePanelNavigation,
      pushJumpFromActiveEditor,
      projectRegistry,
      refreshProjects,
    ],
  )

  const deferredPanelRev = useDeferredValue(panelRev)
  const paletteCommands = useMemo(() => {
    if (!paletteOpen) return []
    return commands
      .list(getCommandContext())
      .map(cmd => {
        const fnName = fnByCommandId.get(cmd.id)
        const run = fnName ? appCommands[fnName as keyof typeof appCommands] : undefined
        const key = run ? keybindingByFn.get(run) : undefined
        return {
          ...cmd,
          keybinding: key ? formatKeyBinding(key) : undefined,
          recent: recentCommands.includes(cmd.id),
        }
      })
      .sort((a, b) => {
        const recentDelta = Number(b.recent) - Number(a.recent)
        if (recentDelta !== 0) return recentDelta
        return a.title.localeCompare(b.title)
      })
  }, [paletteOpen, commands, deferredPanelRev, appCommands, keybindingByFn, fnByCommandId, getCommandContext, recentCommands])

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
    keymaps.registerUser(createDefaultKeybindings(appCommands))
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
    if (!isWebMode) return
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
      openWorkspace: folderPath => Promise.resolve(openWorkspaceFolder(folderPath)),
      openFile: handleOpenFile,
      setFontSize,
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
        path => Promise.resolve(openWorkspaceRef.current(path)),
        openFile,
      )
        .catch(err => console.warn("Failed to open workspace from query:", err))
    } else if (!isWebMode && window.jet?.getLaunchConfig) {
      void window.jet.getLaunchConfig().then(cfg => {
        if (!cfg || queryBootstrapDone.current) return
        queryBootstrapDone.current = true
        bootstrapFromLaunch(path => openWorkspaceRef.current(path), openFile, cfg)
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
    const views = getAllEditorViews(panelTree)
    const next = collectProblemsFromViews(views.map(v => ({ uri: v.uri, view: v.view })))
    const fp = problemsFingerprint(next)
    if (fp === problemsFpRef.current) return
    problemsFpRef.current = fp
    startTransition(() => setProblems(next))
  }, [panelTree])

  useEffect(() => {
    if (problemsRafRef.current != null) return
    problemsRafRef.current = requestAnimationFrame(() => {
      problemsRafRef.current = null
      refreshProblems()
    })
  }, [panelRev, refreshProblems])

  useEffect(() => {
    syncProblemsToLocationList()
  }, [problems, syncProblemsToLocationList])

  const handleLspAttachFailed = useCallback(
    (fileUri: string) => {
      void ensureLspForFile(fileUri)
    },
    [ensureLspForFile],
  )

  useEffect(() => {
    if (activePanelKind !== "editor") setEditorCursor(null)
  }, [activePanelKind])

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
      if (!workspace.root || anyOverlayOpen(keymapContext)) return
      const now = Date.now()
      if (now - lastCloseAt < 100) return
      lastCloseAt = now
      void executeCommand("workspace.closeBuffer")
    }
    const onKey = (e: KeyboardEvent) => {
      if (anyOverlayOpen(keymapContext)) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (keyEventMatchesBinding(e, "Cmd-w")) {
        if (!workspace.root) return
        e.preventDefault()
        e.stopPropagation()
        closeBuffer()
        return
      }
      const hadPendingChord = chordState.prefix != null
      const result = resolveKeydownBinding(e, keymapBindings, keymapContext, chordState)
      if (result === "chord-started") {
        e.preventDefault()
        setPendingChordPrefix(chordState.prefix)
        if (chordTimeout != null) window.clearTimeout(chordTimeout)
        chordTimeout = window.setTimeout(clearPendingChord, CHORD_TIMEOUT_MS)
        return
      }
      if (hadPendingChord && chordState.prefix == null) clearPendingChord()
      if (result && isChordBinding(result.key)) {
        e.preventDefault()
        runKeyBinding(result)
        return
      }
      if (result && !isEditorKeyBinding(result, keymapContext)) {
        e.preventDefault()
        e.stopPropagation()
        runKeyBinding(result)
        return
      }
      if (result && isEditorKeyBinding(result, keymapContext)) return
      if (result) {
        e.preventDefault()
        runKeyBinding(result)
      }
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
        ],
      },
      {
        id: "view",
        label: "View",
        items: [
          { id: "palette", label: "Command Palette…", shortcut: shortcutFor("palette"), onSelect: () => void executeCommand("ui.showCommandPalette") },
          { id: "quickOpen", label: "Quick Open…", shortcut: shortcutFor("quickOpen"), onSelect: () => void executeCommand("workspace.quickOpen") },
          { id: "explorer", label: "Show Explorer", shortcut: shortcutFor("explorer"), onSelect: () => void executeCommand("explorer.show") },
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
            hasWorkspace={Boolean(workspace.root)}
            activeFileName={activeEditorFile?.name ?? null}
            activeLanguageId={activeEditorFile?.languageId ?? null}
            activeFileDirty={activeEditorFile?.isDirty ?? false}
          />
        </>
      }
    >
      {!workspace.root && !hasWorkspaceQuery ? (
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
          renderHeader={(view, panelId, meta) => (
            <PanelHeader
              panelId={panelId}
              view={view}
              workspace={workspace}
              focused={meta.focused}
              onClose={meta.onClose}
              onSplitEditor={
                view.kind === "editor"
                  ? () => void executeCommand("view.splitEditor")
                  : undefined
              }
            />
          )}
          renderContent={(view, panelId, meta) => (
            <PanelBody
              panelId={panelId}
              view={view}
              workspace={workspace}
              theme={activeTheme}
              resolveLspClient={resolveLspClient}
              lspRevision={lspRevision}
              executeCommand={executeCommand}
              runKeyBinding={runKeyBinding}
              onOpenFile={handleOpenFile}
              onOpenLocationItem={openLocationItem}
              keymapBindings={keymapBindings}
              userExtensions={userExtensions}
              keymapRevision={keymapRevision}
              keymapContext={keymapContext}
              onEditorFocusChange={setEditorFocused}
              onEditorSelectionChange={(line: number, column: number, rangeCount: number) =>
                setEditorCursor({ line, column, rangeCount })
              }
              onLspAttachFailed={handleLspAttachFailed}
              onProblemsChange={refreshProblems}
              autoFocus={meta.focused && view.kind === "editor"}
            />
          )}
        />
      )}

      <GotoLineModal
        open={gotoLineOpen}
        onOpenChange={setGotoLineOpen}
        onSubmit={(line, column) => {
          const panel = focusedPanel
          const view = panel ? getEditorView(panel) : null
          if (view) jumpToLine(view, line, column)
        }}
      />

      {quickOpenOpen && (
        <QuickOpenOverlay
          open
          onOpenChange={setQuickOpenOpen}
          scanReady={searchScanReady}
          onSearch={quickOpenSearch}
          onSelect={(rel, query) => {
            if (!workspace.root) return
            void window.jet?.search?.trackFileAccess?.(workspace.root.uri, query, rel)
            const fullPath = `${workspace.root.path}/${rel.replace(/^\/+/, "")}`
            handleOpenFile(pathToFileUri(fullPath), fullPath)
          }}
        />
      )}

      {bufferListOpen && (
        <BufferListOverlay
          open
          onOpenChange={setBufferListOpen}
          workspace={workspace}
          onSelect={uri => handleOpenFile(uri, fileUriToPath(uri))}
        />
      )}

      {openFileOpen && (
        <OpenFileOverlay
          open
          onOpenChange={setOpenFileOpen}
          workspace={workspace}
          onOpenFile={handleOpenFile}
        />
      )}

      {cdOpen && (
        <CdOverlay
          open
          onOpenChange={setCdOpen}
          initialPath={workspace.root?.path ?? null}
          onSelectFolder={path => openWorkspaceFolder(path)}
          resolveHomeDir={async () =>
            window.jet?.getHomeDir ? window.jet.getHomeDir() : (await resolveDevWorkspacePath(".")).path
          }
        />
      )}

      {projectSwitcherOpen && (
        <ProjectSwitcherOverlay
          open
          onOpenChange={setProjectSwitcherOpen}
          projects={projects}
          onSelect={path => openWorkspaceFolder(path)}
        />
      )}

      {outlineOpen && (
        <OutlineOverlay
          open
          symbols={outlineSymbols}
          onOpenChange={setOutlineOpen}
          onSelect={line => {
            const panel = focusedPanel
            const view = panel ? getEditorView(panel) : null
            if (view) jumpToLine(view, line, 1)
          }}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          open
          onOpenChange={setPaletteOpen}
          commands={paletteCommands}
          onRun={id => executeCommand(id)}
        />
      )}
      <FindReplaceDrawer />
      <ConfirmDialogHost />
      <Toaster position="bottom-right" />
    </AppShell>
    </div>
    </TooltipProvider>
  )
}
