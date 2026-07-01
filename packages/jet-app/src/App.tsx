import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
  useDeferredValue,
} from "react"
import { PanelTree, type PanelEvent } from "@jet/panels"
import type { PanelId } from "@jet/shared"
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
  type JetProject,
} from "@jet/workspace"
import { LanguageServerManager, LspClientPool } from "@jet/lsp"
import { createAgentBridge, openWorkspaceFromQuery, resolveDevWorkspacePath } from "@jet/browser"
import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import {
  applyJetThemeCss,
  defaultJetTheme,
  jumpToLine,
  collectProblemsFromViews,
  problemsFingerprint,
  setPendingEditorNavigation,
  setPendingInitialContent,
  type JetTheme,
} from "@jet/codemirror"
import {
  PanelDock,
  CommandPalette,
  StatusBar,
  bundledThemes,
  GotoLineModal,
  OutlineOverlay,
  QuickOpenOverlay,
  BufferListOverlay,
  OpenFileOverlay,
  CdOverlay,
  ProjectSwitcherOverlay,
  getEditorView,
  getAllEditorViews,
  setEditorCursor,
  formatKeyBinding,
  problemsToLocationItems,
  WhichKeyPanel,
  type OutlineEntry,
  type WhichKeyEntry,
} from "@jet/ui"
import { indexWorkspaceFiles } from "@jet/workspace"
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

const THEME_STORAGE_KEY = "jet-theme-id"
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
  return PanelTree.editorOnlyLayout()
}

function loadStoredTheme(): JetTheme {
  const id = localStorage.getItem(THEME_STORAGE_KEY)
  if (id && bundledThemes[id]) return bundledThemes[id]!
  return bundledThemes.minim ?? defaultJetTheme
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
  const [message, setMessage] = useState<string | null>(null)
  const [lspRevision, setLspRevision] = useState(0)
  const [userExtensions, setUserExtensions] = useState<Extension[]>([])
  const [keymapRevision, setKeymapRevision] = useState(0)
  const [editorFocused, setEditorFocused] = useState(false)
  const [layoutReady, setLayoutReady] = useState(false)
  const [activeTheme, setActiveTheme] = useState<JetTheme>(() => loadStoredTheme())
  const [gotoLineOpen, setGotoLineOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [outlineSymbols, setOutlineSymbols] = useState<OutlineEntry[]>([])
  const [quickOpenOpen, setQuickOpenOpen] = useState(false)
  const [bufferListOpen, setBufferListOpen] = useState(false)
  const [openFileOpen, setOpenFileOpen] = useState(false)
  const [cdOpen, setCdOpen] = useState(false)
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false)
  const [projects, setProjects] = useState<JetProject[]>([])
  const [fileIndex, setFileIndex] = useState<string[]>([])
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
      workspaceOpen: workspace.root != null,
      explorerFocus: activePanelKind === "explorer",
      locationListFocus: activePanelKind === "locationlist",
      outputFocus: activePanelKind === "output",
      listFocus:
        activePanelKind === "explorer" || activePanelKind === "locationlist",
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
    () => PanelTree.fromJSON(appStateRef.current.panelTree.toJSON()),
    [],
  )

  const commitTree = useCallback((tree: PanelTree) => {
    setPanelTree(PanelTree.fromJSON(tree.toJSON()))
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
          setMessage(
            `Language server unavailable for ${file.name} — is ${file.languageId === "rust" ? "rust-analyzer" : "typescript-language-server"} on PATH?`,
          )
        }
      }
    },
    [lspManager, workspace],
  )

  useEffect(() => {
    applyJetThemeCss(activeTheme)
  }, [activeTheme])

  useEffect(() => {
    applyRootFontSize(fontSizeRef.current)
  }, [])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    setLayoutReady(true)
  }, [])

  useEffect(() => {
    if (!window.jet?.fs.onFileChanged) return
    return window.jet.fs.onFileChanged(uri => workspace.handleExternalFileChange(uri))
  }, [workspace])

  useEffect(() => {
    if (!window.jet?.workspace) return
    return window.jet.workspace.onFileIndex((rootUri, files) => {
      const current = workspace.root?.uri
      if (!current) return
      if (normalizeAbsPath(fileUriToPath(current)) !== normalizeAbsPath(fileUriToPath(rootUri))) return
      if (files.length > 0) setFileIndex(files)
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

      const { tree, editorPanel } = PanelTree.editorOnlyLayout()
      editorPanelRef.current = editorPanel
      tree.setView(editorPanel, { kind: "empty" })
      setPanelTree(tree)
      setFocusedPanel(editorPanel)
      setMessage(`Opened ${folderPath}`)
      setFileIndex([])

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
        void (async () => {
          if (workspaceInitGen.current !== gen) return
          try {
            const files = await indexWorkspaceFiles(
              jetPlatformFS(),
              rootUri,
              50_000,
              window.jet?.search?.listFiles,
            )
            if (workspaceInitGen.current !== gen) return
            setFileIndex(files)
          } catch {
            if (workspaceInitGen.current !== gen) return
            setFileIndex([])
          }
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
    setMessage,
    onDragOverChange: setFileDragOver,
  })

  const handlePanelEvent = useCallback(
    (event: PanelEvent) => {
      const tree = cloneTree()
      if (event.type === "splitResized") {
        tree.resizeSplit(event.path, event.splitterIndex, event.deltaPx, event.viewport)
      }
      commitTree(tree)
    },
    [cloneTree, commitTree, workspace],
  )

  const keymapTargetViewRef = useRef<EditorView | null>(null)

  const getCommandContext = useCallback((): JetCommandContext => {
    const currentTree = appStateRef.current.panelTree
    const currentFocusedPanel = appStateRef.current.focusedPanel
    return {
      workspace,
      ui: {
        showMessage: setMessage,
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
    if (!kind || !["explorer", "locationlist"].includes(kind)) return
    const el = document.querySelector(`[data-jet-list-panel="${kind}"]`)
    if (!(el instanceof HTMLElement)) return
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
        setMessage,
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
  }, [commands, deferredPanelRev, appCommands, keybindingByFn, fnByCommandId, getCommandContext, recentCommands])

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
      showMessage: setMessage,
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
    for (const [id, theme] of Object.entries(bundledThemes)) {
      disposables.push(
        commands.register(
          `ui.selectTheme.${id}`,
          () => {
            setActiveTheme(theme)
            applyJetThemeCss(theme)
            localStorage.setItem(THEME_STORAGE_KEY, id)
            setMessage(`Theme: ${theme.name}`)
          },
          { id: `ui.selectTheme.${id}`, title: `Theme: ${theme.name}`, category: "UI", aliases: ["theme"] },
        ),
      )
    }
    disposables.push(
      commands.register("ui.selectTheme", () => setPaletteOpen(true), {
        id: "ui.selectTheme",
        title: "Select Theme",
        category: "UI",
        aliases: ["theme"],
      }),
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
      message,
      layoutReady,
      executeCommand,
      openWorkspace: folderPath => Promise.resolve(openWorkspaceFolder(folderPath)),
      openFile: handleOpenFile,
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
    message,
    layoutReady,
    executeCommand,
    openWorkspaceFolder,
    handleOpenFile,
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
      setMessage("LSP crashed — will retry on next editor focus")
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

  return (
    <div
      className="flex h-full flex-col bg-[var(--jet-bg)] text-[var(--jet-text)]"
      data-drag-over={fileDragOver || undefined}
    >
      <main className="min-h-0 flex-1">
        <PanelDock
          tree={panelTree}
          workspace={workspace}
          theme={activeTheme}
          focusedPanelId={focusedPanel}
          onFocusPanel={setFocusedPanel}
          onEvent={handlePanelEvent}
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
          panelRev={panelRev}
          onEditorFocusChange={setEditorFocused}
          onEditorSelectionChange={(line, column, rangeCount) =>
            setEditorCursor({ line, column, rangeCount })
          }
          onLspAttachFailed={handleLspAttachFailed}
          onProblemsChange={refreshProblems}
        />
      </main>

      {pendingChordPrefix && (
        <WhichKeyPanel prefix={formatKeyBinding(pendingChordPrefix)} entries={whichKeyEntries} />
      )}

      <StatusBar
        message={message}
        lspStatus={lspStatus}
        workspaceName={workspace.root?.name}
        workspacePath={workspace.root?.path}
        hasWorkspace={Boolean(workspace.root)}
        activeFileName={activeEditorFile?.name ?? null}
        activeLanguageId={activeEditorFile?.languageId ?? null}
        activeFileDirty={activeEditorFile?.isDirty ?? false}
      />

      <GotoLineModal
        open={gotoLineOpen}
        onOpenChange={setGotoLineOpen}
        onSubmit={(line, column) => {
          const panel = focusedPanel
          const view = panel ? getEditorView(panel) : null
          if (view) jumpToLine(view, line, column)
        }}
      />

      <QuickOpenOverlay
        open={quickOpenOpen}
        onOpenChange={setQuickOpenOpen}
        files={fileIndex}
        onSelect={rel => {
          if (!workspace.root) return
          const fullPath = `${workspace.root.path}/${rel.replace(/^\/+/, "")}`
          handleOpenFile(pathToFileUri(fullPath), fullPath)
        }}
      />

      <BufferListOverlay
        open={bufferListOpen}
        onOpenChange={setBufferListOpen}
        workspace={workspace}
        onSelect={uri => handleOpenFile(uri, fileUriToPath(uri))}
      />

      <OpenFileOverlay
        open={openFileOpen}
        onOpenChange={setOpenFileOpen}
        workspace={workspace}
        onOpenFile={handleOpenFile}
      />

      <CdOverlay
        open={cdOpen}
        onOpenChange={setCdOpen}
        initialPath={workspace.root?.path ?? null}
        onSelectFolder={path => openWorkspaceFolder(path)}
        resolveHomeDir={async () =>
          window.jet?.getHomeDir ? window.jet.getHomeDir() : (await resolveDevWorkspacePath(".")).path
        }
      />

      <ProjectSwitcherOverlay
        open={projectSwitcherOpen}
        onOpenChange={setProjectSwitcherOpen}
        projects={projects}
        onSelect={path => openWorkspaceFolder(path)}
      />

      <OutlineOverlay
        open={outlineOpen}
        symbols={outlineSymbols}
        onOpenChange={setOutlineOpen}
        onSelect={line => {
          const panel = focusedPanel
          const view = panel ? getEditorView(panel) : null
          if (view) jumpToLine(view, line, 1)
        }}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={paletteCommands}
        onRun={id => executeCommand(id)}
      />
    </div>
  )
}
