import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react"
import { PanelTree, type PanelEvent } from "@jet/panels"
import type { PanelId, TabId } from "@jet/shared"
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
  type JetCommandContext,
  type JetKeyBinding,
} from "@jet/workspace"
import { LanguageServerManager, LspClientPool } from "@jet/lsp"
import { createAgentBridge, openWorkspaceFromQuery, resolveDevWorkspacePath } from "@jet/browser"
import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { applyJetThemeCss, defaultJetTheme, jumpToLine, collectProblemsFromViews, problemsFingerprint, setPendingEditorNavigation, type JetTheme } from "@jet/codemirror"
import { PanelDock, CommandPalette, StatusBar, bundledThemes, GotoLineModal, OutlineOverlay, QuickOpenOverlay, OpenFileOverlay, CdOverlay, getEditorView, getAllEditorViews, setEditorCursor, type OutlineEntry } from "@jet/ui"
import { indexWorkspaceFiles } from "@jet/workspace"
import type { JetProblem } from "@jet/shared"
import { APP_COMMAND_REGISTRY, buildAppCommands } from "./app-commands.js"
import {
  loadWorkspaceSession,
  restoreWorkspaceSession,
  saveWorkspaceSession,
} from "./session-storage.js"
import { confirmCloseEditorTab } from "./tab-close.js"
import {
  activeTabKind,
  getAllLeafPanels,
  resolveEditorPanel,
  resolveTargetPanel,
} from "./panel-routing.js"
import { loadWorkspaceInit, type JetInitContext } from "./load-workspace-init.js"
import { bootstrapFromLaunch } from "./launch-bootstrap.js"

const THEME_STORAGE_KEY = "jet-theme-id"

const isWebMode = Boolean(import.meta.env.VITE_JET_WEB)
const hasWorkspaceQuery =
  isWebMode && new URLSearchParams(window.location.search).has("workspace")

function initialEditorLayout() {
  return PanelTree.editorOnlyLayout()
}

function loadStoredTheme(): JetTheme {
  const id = localStorage.getItem(THEME_STORAGE_KEY)
  if (id && bundledThemes[id]) return bundledThemes[id]!
  return defaultJetTheme
}

function normalizeAbsPath(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, "")
  return trimmed || p
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
  const [bootstrapping, setBootstrapping] = useState(hasWorkspaceQuery)
  const [activeTheme, setActiveTheme] = useState<JetTheme>(() => loadStoredTheme())
  const [gotoLineOpen, setGotoLineOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [outlineSymbols, setOutlineSymbols] = useState<OutlineEntry[]>([])
  const [quickOpenOpen, setQuickOpenOpen] = useState(false)
  const [openFileOpen, setOpenFileOpen] = useState(false)
  const [cdOpen, setCdOpen] = useState(false)
  const [gitBranch, setGitBranch] = useState<string | null>(null)
  const [fileIndex, setFileIndex] = useState<string[]>([])
  const [problems, setProblems] = useState<JetProblem[]>([])
  const [sessionRev, setSessionRev] = useState(0)
  const [tabMetaRev, setTabMetaRev] = useState(0)
  const [lspCrashed, setLspCrashed] = useState(false)
  const initialized = useRef(false)
  const queryBootstrapDone = useRef(false)
  const openWorkspaceRef = useRef<(folderPath: string) => void>(() => {})
  const handleOpenFileRef = useRef<(uri: string, path: string) => void>(() => {})
  const explorerTabRef = useRef<TabId | null>(null)
  const gitTabRef = useRef<TabId | null>(null)
  const editorPanelRef = useRef<PanelId | null>(initialLayout.editorPanel)
  const terminalTabRef = useRef<TabId | null>(null)
  const searchTabRef = useRef<TabId | null>(null)
  const problemsTabRef = useRef<TabId | null>(null)
  const workspaceInitGen = useRef(0)

  const workspace = useMemo(() => new WorkspaceService(jetPlatformFS()), [])
  const commands = useMemo(() => new CommandRegistry(), [])
  const keymaps = useMemo(() => new KeymapService(), [])

  const keymapBindings = useMemo(() => keymaps.allBindings(), [keymaps, keymapRevision])

  useEffect(() => {
    const sub = keymaps.onDidChange.event(() => setKeymapRevision(r => r + 1))
    return () => sub.dispose()
  }, [keymaps])

  const paletteCommands = useMemo(() => commands.list(), [commands, sessionRev, keymapRevision])

  const activeTabKindName = useMemo(
    () => (focusedPanel ? activeTabKind(panelTree, focusedPanel, workspace.tabRegistry) : undefined),
    [focusedPanel, panelTree, workspace.tabRegistry],
  )

  const keymapContext = useMemo(
    () => ({
      editorFocus: editorFocused,
      paletteOpen,
      quickOpenOpen,
      openFileOpen,
      cdOpen,
      gotoLineOpen,
      outlineOpen,
      workspaceOpen: workspace.root != null,
      explorerFocus: activeTabKindName === "explorer",
      gitFocus: activeTabKindName === "git",
      terminalFocus: activeTabKindName === "terminal",
      searchFocus: activeTabKindName === "search",
      problemsFocus: activeTabKindName === "problems",
      listFocus:
        activeTabKindName === "explorer" ||
        activeTabKindName === "git" ||
        activeTabKindName === "search" ||
        activeTabKindName === "problems",
    }),
    [editorFocused, paletteOpen, quickOpenOpen, openFileOpen, cdOpen, gotoLineOpen, outlineOpen, workspace.root, activeTabKindName],
  )

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

  const ensureLspForFile = useCallback(
    async (fileUri: string) => {
      if (!lspManager || !workspace.root || isUntitledUri(fileUri)) return
      const path = fileUriToPath(fileUri)
      const file = workspace.fileForUri(fileUri) ?? workspace.createWorkspaceFile(fileUri, path)
      const conn = await lspManager.ensureServerForFile(file, workspace.root.uri)
      if (conn) bumpLspRevision()
    },
    [lspManager, workspace, bumpLspRevision],
  )

  const lspStatus = useMemo((): "connected" | "off" | "unavailable" => {
    if (!window.jet?.lsp) return "unavailable"
    if (lspCrashed) return "off"
    if (lspManager?.hasAnyConnection()) return "connected"
    if (workspace.root) return "off"
    return "off"
  }, [lspManager, workspace.root, lspCrashed, lspRevision])

  const cloneTree = useCallback(
    () => PanelTree.fromJSON(panelTree.toJSON()),
    [panelTree],
  )

  const commitTree = useCallback((tree: PanelTree) => {
    setPanelTree(PanelTree.fromJSON(tree.toJSON()))
  }, [])

  useEffect(() => {
    applyJetThemeCss(activeTheme)
  }, [activeTheme])

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
    const unsubIndex = window.jet.workspace.onFileIndex((rootUri, files) => {
      if (workspace.root?.uri !== rootUri) return
      setFileIndex(files)
    })
    const unsubBranch = window.jet.workspace.onGitBranch((rootUri, branch) => {
      if (workspace.root?.uri !== rootUri) return
      setGitBranch(branch)
    })
    return () => {
      unsubIndex()
      unsubBranch()
    }
  }, [workspace])

  const handleOpenFile = useCallback(
    (uri: string, path: string, line?: number, column?: number) => {
      const tree = cloneTree()
      const panel = resolveEditorPanel(
        tree,
        workspace.tabRegistry,
        editorPanelRef.current,
        focusedPanel,
      )
      if (!panel) return
      editorPanelRef.current = panel
      const tabId = workspace.openEditorTab(tree, panel, uri, path)
      if (line != null) setPendingEditorNavigation(tabId, line, column ?? 1)
      setFocusedPanel(panel)
      commitTree(tree)
      if (line != null) {
        requestAnimationFrame(() => {
          const view = getEditorView(tabId)
          if (view) jumpToLine(view, line, column ?? 1)
        })
      }
      void ensureLspForFile(uri)
    },
    [workspace, focusedPanel, cloneTree, commitTree, ensureLspForFile],
  )

  const handleOpenFileAt = useCallback(
    (uri: string, path: string, line: number, column: number) => {
      handleOpenFile(uri, path, line, column)
    },
    [handleOpenFile],
  )

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

  const openWorkspaceFolder = useCallback(
    (folderPath: string) => {
      const gen = ++workspaceInitGen.current

      void workspace.openWorkspace(folderPath)

      workspace.tabRegistry.clear()
      explorerTabRef.current = null
      gitTabRef.current = null
      terminalTabRef.current = null
      searchTabRef.current = null
      problemsTabRef.current = null

      // Instant shell — editor-only layout; session restore runs after first paint.
      const { tree, editorPanel } = PanelTree.editorOnlyLayout()
      editorPanelRef.current = editorPanel
      setPanelTree(tree)
      setFocusedPanel(editorPanel)
      setMessage(`Opened ${folderPath}`)
      setFileIndex([])
      setGitBranch(null)

      const finishOpen = () => {
        if (workspaceInitGen.current !== gen) return

        const session = loadWorkspaceSession(folderPath)
        if (session) {
          const restored = restoreWorkspaceSession(session, workspace)
          editorPanelRef.current = restored.editorPanel
          explorerTabRef.current =
            restored.singletons.explorer != null ? { id: restored.singletons.explorer } : null
          gitTabRef.current = restored.singletons.git != null ? { id: restored.singletons.git } : null
          terminalTabRef.current =
            restored.singletons.terminal != null ? { id: restored.singletons.terminal } : null
          searchTabRef.current =
            restored.singletons.search != null ? { id: restored.singletons.search } : null
          problemsTabRef.current =
            restored.singletons.problems != null ? { id: restored.singletons.problems } : null
          setPanelTree(restored.tree)
          setFocusedPanel(restored.focusedPanel ?? restored.editorPanel)
        }

        const rootUri = workspace.root?.uri
        if (!rootUri) return

        if (window.jet?.workspace) {
          void window.jet.workspace.activate(rootUri)
          return
        }

        void (async () => {
          if (workspaceInitGen.current !== gen) return
          if (window.jet?.git) {
            try {
              const repo = await window.jet.git.isRepo(rootUri)
              if (workspaceInitGen.current !== gen) return
              setGitBranch(repo ? await window.jet.git.branch(rootUri) : null)
            } catch {
              if (workspaceInitGen.current !== gen) return
              setGitBranch(null)
            }
          }
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

  const handlePanelEvent = useCallback(
    (event: PanelEvent) => {
      const tree = cloneTree()
      switch (event.type) {
        case "tabSelect":
          tree.setActiveTab(event.panelId, event.tabId)
          setFocusedPanel(event.panelId)
          commitTree(tree)
          if (workspace.tabRegistry.get(event.tabId)?.kind === "editor") {
            requestAnimationFrame(() => getEditorView(event.tabId)?.focus())
          }
          return
        case "tabClose": {
          if (!confirmCloseEditorTab(workspace, event.tabId)) return
          workspace.tabRegistry.delete(event.tabId)
          tree.removeTab(event.tabId)
          break
        }
        case "tabMoved": {
          tree.moveTab(event.tabId, event.targetPanelId, event.action, event.insertIndex)
          const dest = tree.findPanelForTab(event.tabId) ?? event.targetPanelId
          workspace.tabRegistry.setPanel(event.tabId, dest)
          setFocusedPanel(dest)
          break
        }
        case "splitResized":
          tree.resizeSplit(event.path, event.splitterIndex, event.deltaPx, event.viewport)
          break
        case "panelClose": {
          const leaf = tree.getLeaf(event.panelId)
          if (leaf) {
            for (const tab of [...leaf.group.tabs]) {
              if (!confirmCloseEditorTab(workspace, tab)) return
            }
            for (const tab of [...leaf.group.tabs]) {
              workspace.tabRegistry.delete(tab)
            }
          }
          tree.closePanel(event.panelId)
          const panels = getAllLeafPanels(tree)
          setFocusedPanel(panels[0] ?? null)
          break
        }
      }
      commitTree(tree)
    },
    [cloneTree, commitTree, workspace],
  )

  const showSingletonViewTab = useCallback(
    (
      kind: "search" | "problems",
      label: string,
      tabRef: MutableRefObject<TabId | null>,
    ) => {
      const tree = cloneTree()
      const target = resolveTargetPanel(tree, focusedPanel, workspace.tabRegistry)
      if (!target) return
      tabRef.current = workspace.ensureSingletonTab(
        tree,
        target,
        { kind },
        label,
        tabRef.current,
      )
      const tabPanel = workspace.tabRegistry.panelForTab(tabRef.current) ?? target
      tree.setActiveTab(tabPanel, tabRef.current)
      setFocusedPanel(tabPanel)
      commitTree(tree)
    },
    [cloneTree, commitTree, focusedPanel, workspace],
  )

  const keymapTargetViewRef = useRef<EditorView | null>(null)

  const getCommandContext = useCallback((): JetCommandContext => {
    return {
      workspace,
      ui: {
        showMessage: setMessage,
        showCommandPalette: () => setPaletteOpen(true),
        setCommandPaletteOpen: setPaletteOpen,
      },
      getActiveEditorView: () => {
        if (keymapTargetViewRef.current) return keymapTargetViewRef.current
        const leaf = focusedPanel && panelTree.getLeaf(focusedPanel)
        const tab = leaf?.group.tabs[leaf.group.active]
        return tab ? (getEditorView(tab) ?? null) : null
      },
    }
  }, [workspace, focusedPanel, panelTree])

  const handlePanelNavigation = useCallback(
    (action: string) => {
      const kind = activeTabKindName
      if (!kind || !["explorer", "git", "search", "problems"].includes(kind)) return
      const el = document.querySelector(`[data-jet-list-panel="${kind}"]`)
      if (!(el instanceof HTMLElement)) return
      const page = Math.max(80, Math.floor(el.clientHeight * 0.85))
      switch (action) {
        case "focusPageUp":
          el.scrollBy({ top: -page })
          break
        case "focusPageDown":
          el.scrollBy({ top: page })
          break
        case "focusFirst":
          el.scrollTop = 0
          break
        case "focusLast":
          el.scrollTop = el.scrollHeight
          break
      }
    },
    [activeTabKindName],
  )

  const handleZoom = useCallback((delta: number) => {
    const root = document.documentElement
    const cur = parseFloat(root.style.fontSize) || 14
    const next = Math.max(9, Math.min(28, cur + delta * 2))
    root.style.fontSize = `${next}px`
  }, [])

  const appCommands = useMemo(
    () =>
      buildAppCommands({
        workspace,
        panelTree,
        focusedPanel,
        setPaletteOpen,
        setQuickOpenOpen,
        setOpenFileOpen,
        setCdOpen,
        setGotoLineOpen,
        setMessage,
        setFocusedPanel,
        cloneTree,
        commitTree,
        openWorkspaceFolder,
        handlePanelEvent,
        showSingletonViewTab,
        searchTabRef,
        problemsTabRef,
        explorerTabRef,
        gitTabRef,
        terminalTabRef,
        editorPanelRef,
        isWebMode,
        setZoomLevel: handleZoom,
        handlePanelNavigation,
        activeTabKindName,
        setOutlineOpen,
        setOutlineSymbols,
      }),
    [
      workspace,
      panelTree,
      focusedPanel,
      cloneTree,
      commitTree,
      openWorkspaceFolder,
      handlePanelEvent,
      showSingletonViewTab,
      handleZoom,
      handlePanelNavigation,
      activeTabKindName,
    ],
  )

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

  const executeCommand = useCallback(
    async (name: string) => {
      if (!commands.has(name)) return
      await commands.execute(name, getCommandContext())
    },
    [commands, getCommandContext],
  )

  useEffect(() => {
    for (const entry of APP_COMMAND_REGISTRY) {
      const run = appCommands[entry.fn]
      if (!run) continue
      commands.register(entry.id, run, {
        id: entry.id,
        title: entry.title,
        category: entry.category,
      })
    }
    for (const [id, theme] of Object.entries(bundledThemes)) {
      commands.register(
        `ui.selectTheme.${id}`,
        () => {
          setActiveTheme(theme)
          applyJetThemeCss(theme)
          localStorage.setItem(THEME_STORAGE_KEY, id)
          setMessage(`Theme: ${theme.name}`)
        },
        { id: `ui.selectTheme.${id}`, title: `Theme: ${theme.name}`, category: "UI" },
      )
    }
    commands.register(
      "ui.selectTheme",
      () => setPaletteOpen(true),
      { id: "ui.selectTheme", title: "Select Theme", category: "UI" },
    )
  }, [commands, appCommands])

  useEffect(() => {
    return workspace.tabRegistry.onDidChange.event(() => setSessionRev(r => r + 1)).dispose
  }, [workspace])

  useEffect(() => {
    return workspace.onDidChangeDirty.event(() => setTabMetaRev(r => r + 1)).dispose
  }, [workspace])

  useEffect(() => {
    if (activeTabKindName !== "editor") setEditorCursor(null)
  }, [activeTabKindName])

  useEffect(() => {
    if (!workspace.root) return
    const id = window.setTimeout(() => {
      saveWorkspaceSession(
        workspace.root!.path,
        panelTree,
        workspace,
        editorPanelRef.current,
        focusedPanel,
        {
          explorer: explorerTabRef.current?.id,
          git: gitTabRef.current?.id,
          terminal: terminalTabRef.current?.id,
          search: searchTabRef.current?.id,
          problems: problemsTabRef.current?.id,
        },
      )
    }, 400)
    return () => window.clearTimeout(id)
  }, [workspace, panelTree, focusedPanel, sessionRev])

  const loadedInitFor = useRef<string | null>(null)
  const workspaceInitCtxRef = useRef({
    appCommands,
    getCommandContext,
    commands,
    handleOpenFile,
  })
  workspaceInitCtxRef.current = { appCommands, getCommandContext, commands, handleOpenFile }

  useEffect(() => {
    if (!workspace.root) {
      loadedInitFor.current = null
      keymaps.registerExtension([])
      setUserExtensions([])
      return
    }

    const jetDir = `${workspace.root.path}/.jet`
    if (loadedInitFor.current === jetDir) return
    loadedInitFor.current = jetDir

    keymaps.registerExtension([])
    setUserExtensions([])

    const ctx: JetInitContext = {
      workspace,
      get commands() {
        return workspaceInitCtxRef.current.commands
      },
      get appCommands() {
        return workspaceInitCtxRef.current.appCommands
      },
      getCommandContext: () => workspaceInitCtxRef.current.getCommandContext(),
      addKeybindings(bindings) {
        keymaps.registerExtension(bindings)
      },
      addEditorExtensions(ext) {
        setUserExtensions(prev => [...prev, ...ext])
      },
      openFile: async uri => {
        const path = uri.replace(/^file:\/\//, "")
        workspaceInitCtxRef.current.handleOpenFile(uri, decodeURIComponent(path))
      },
      showMessage: setMessage,
    }

    const runInit = () => void loadWorkspaceInit(jetDir, ctx)
    if (typeof requestIdleCallback === "function") requestIdleCallback(runInit)
    else setTimeout(runInit, 0)
  }, [workspace.root, keymaps, workspace])

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
    const finishBootstrap = (cfg: import("@jet/workspace").LaunchConfig | null) => {
      if (!cfg || queryBootstrapDone.current) return
      queryBootstrapDone.current = true
      setBootstrapping(true)
      bootstrapFromLaunch(path => openWorkspaceRef.current(path), openFile, cfg)
      queueMicrotask(() => setBootstrapping(false))
    }

    if (isWebMode && hasWorkspaceQuery) {
      queryBootstrapDone.current = true
      setBootstrapping(true)
      void openWorkspaceFromQuery(
        window.location.search,
        path => Promise.resolve(openWorkspaceRef.current(path)),
        openFile,
      )
        .catch(err => console.warn("Failed to open workspace from query:", err))
        .finally(() => setBootstrapping(false))
      return
    }

    if (!isWebMode && window.jet?.getLaunchConfig) {
      void window.jet.getLaunchConfig().then(finishBootstrap)
    }
  }, [layoutReady])

  useEffect(() => {
    if (!window.jet?.onLaunch) return
    return window.jet.onLaunch(config => {
      const openFile = (uri: string, path: string) => handleOpenFileRef.current(uri, path)
      if (!queryBootstrapDone.current) {
        queryBootstrapDone.current = true
        setBootstrapping(true)
        bootstrapFromLaunch(path => openWorkspaceRef.current(path), openFile, config)
        queueMicrotask(() => setBootstrapping(false))
        return
      }
      bootstrapFromLaunch(
        path => openWorkspaceRef.current(path),
        openFile,
        config,
      )
    })
  }, [])

  useEffect(() => {
    if (!window.jet?.lsp?.onCrashed) return
    return window.jet.lsp.onCrashed(id => {
      lspClientPool.releaseConnection(id)
      setLspCrashed(true)
      bumpLspRevision()
      setMessage("LSP crashed — will retry on next editor focus")
    })
  }, [lspClientPool, bumpLspRevision])

  useEffect(() => {
    if (!editorFocused || !lspCrashed || !lspManager || !workspace.root) return
    const retry = async () => {
      try {
        const leaf = focusedPanel && panelTree.getLeaf(focusedPanel)
        const tabId = leaf?.group.tabs[leaf.group.active]
        const kind = tabId ? workspace.tabRegistry.get(tabId) : null
        if (kind?.kind !== "editor") return
        await ensureLspForFile(kind.fileUri)
        setLspCrashed(false)
        setMessage("LSP reconnected")
      } catch {
        /* retry later */
      }
    }
    void retry()
  }, [editorFocused, lspCrashed, lspManager, workspace.root, focusedPanel, panelTree, workspace.tabRegistry, ensureLspForFile])

  const problemsFpRef = useRef("")

  useEffect(() => {
    const id = window.setInterval(() => {
      const views = getAllEditorViews(workspace.tabRegistry)
      const next = collectProblemsFromViews(views.map(v => ({ uri: v.uri, view: v.view })))
      const fp = problemsFingerprint(next)
      if (fp !== problemsFpRef.current) {
        problemsFpRef.current = fp
        setProblems(next)
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [workspace.tabRegistry, panelTree])

  const handleEditorFocusChange = useCallback((focused: boolean) => {
    setEditorFocused(focused)
    if (!focused) setEditorCursor(null)
  }, [])

  const handleEditorSelectionChange = useCallback((line: number, column: number) => {
    setEditorCursor({ line, column })
  }, [])

  const handleOpenProblem = useCallback(
    (p: JetProblem) => handleOpenFileAt(p.uri, fileUriToPath(p.uri), p.line, p.column),
    [handleOpenFileAt],
  )

  useEffect(() => {
    let lastCloseTabAt = 0
    const chordState = createChordState()
    const closeActiveTab = () => {
      if (!workspace.root || anyOverlayOpen(keymapContext)) return
      const now = Date.now()
      if (now - lastCloseTabAt < 100) return
      lastCloseTabAt = now
      void executeCommand("layout.closeTab")
    }

    const onCloseTabEvent = () => closeActiveTab()
    window.addEventListener("jet-close-tab", onCloseTabEvent)

    const onKey = (e: KeyboardEvent) => {
      if (anyOverlayOpen(keymapContext)) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (keyEventMatchesBinding(e, "Cmd-w")) {
        if (!workspace.root) return
        e.preventDefault()
        e.stopPropagation()
        closeActiveTab()
        return
      }

      const result = resolveKeydownBinding(
        e,
        keymapBindings,
        keymapContext,
        chordState,
      )

      if (result === "chord-started") {
        e.preventDefault()
        return
      }

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

      if (result && isEditorKeyBinding(result, keymapContext)) {
        return
      }

      if (result) {
        e.preventDefault()
        runKeyBinding(result)
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      window.removeEventListener("jet-close-tab", onCloseTabEvent)
      window.removeEventListener("keydown", onKey, true)
    }
  }, [keymapBindings, keymapContext, runKeyBinding, workspace.root])

  const handleCdSelectFolder = useCallback(
    (folderPath: string) => {
      const next = normalizeAbsPath(folderPath)
      const current = workspace.root?.path ? normalizeAbsPath(workspace.root.path) : null
      if (current === next) return
      openWorkspaceFolder(folderPath)
    },
    [workspace.root?.path, openWorkspaceFolder],
  )

  const resolveCdHomeDir = useCallback(async () => {
    if (window.jet?.getHomeDir) return window.jet.getHomeDir()
    const { path } = await resolveDevWorkspacePath(".")
    return path
  }, [])

  return (
    <div className="flex h-full flex-col bg-[var(--jet-bg)] text-[var(--jet-text)]">
      <header className="flex h-8 shrink-0 items-center border-b border-[var(--jet-border)] bg-[var(--jet-panel)] px-3 text-xs">
        <span className="font-semibold text-[var(--jet-accent)]">Jet</span>
        <span className="ml-3 text-[var(--jet-text-muted)]">
          {bootstrapping
            ? "Opening workspace…"
            : (workspace.root?.name ?? (isWebMode ? "No folder open" : "No folder open"))}
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="rounded px-2 py-0.5 hover:bg-[var(--jet-hover)]"
            onClick={() => void executeCommand("workspace.cd")}
          >
            cd
          </button>
          <button
            type="button"
            className="rounded px-2 py-0.5 hover:bg-[var(--jet-hover)]"
            onClick={() => executeCommand("workspace.openFolder")}
          >
            Open Folder
          </button>
          <button
            type="button"
            className="rounded px-2 py-0.5 hover:bg-[var(--jet-hover)]"
            onClick={() => setQuickOpenOpen(true)}
          >
            ⌘P
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1">
        <PanelDock
          tree={panelTree}
          registry={workspace.tabRegistry}
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
          onOpenFileAt={handleOpenFileAt}
          onBranchChange={setGitBranch}
          problems={problems}
          onOpenProblem={handleOpenProblem}
          keymapBindings={keymapBindings}
          userExtensions={userExtensions}
          keymapRevision={keymapRevision}
          keymapContext={keymapContext}
          tabMetaRev={tabMetaRev}
          onEditorFocusChange={handleEditorFocusChange}
          onEditorSelectionChange={handleEditorSelectionChange}
        />
      </main>

      <StatusBar
        message={message}
        lspStatus={lspStatus}
        workspaceName={workspace.root?.name}
        workspacePath={workspace.root?.path}
        gitBranch={gitBranch}
        showCursor={activeTabKindName === "editor"}
      />

      <GotoLineModal
        open={gotoLineOpen}
        onOpenChange={setGotoLineOpen}
        onSubmit={(line, column) => {
          const view = (() => {
            const leaf = focusedPanel && panelTree.getLeaf(focusedPanel)
            const tabId = leaf?.group.tabs[leaf.group.active]
            return tabId ? getEditorView(tabId) : null
          })()
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
        onSelectFolder={handleCdSelectFolder}
        resolveHomeDir={resolveCdHomeDir}
      />

      <OutlineOverlay
        open={outlineOpen}
        symbols={outlineSymbols}
        onOpenChange={setOutlineOpen}
        onSelect={line => {
          const view = (() => {
            const leaf = focusedPanel && panelTree.getLeaf(focusedPanel)
            const tabId = leaf?.group.tabs[leaf.group.active]
            return tabId ? getEditorView(tabId) : null
          })()
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
