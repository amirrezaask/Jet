import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react"
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
  type JetCommandContext,
  type JetKeyBinding,
} from "@jet/workspace"
import { LanguageServerManager, LspClientPool } from "@jet/lsp"
import { createAgentBridge, openWorkspaceFromQuery } from "@jet/browser"
import type { Extension } from "@codemirror/state"
import { applyJetThemeCss, defaultJetTheme, jumpToLine, collectProblemsFromViews, setPendingEditorNavigation, type JetTheme } from "@jet/codemirror"
import { PanelDock, CommandPalette, StatusBar, WelcomeView, bundledThemes, GotoLineModal, QuickOpenOverlay, OpenFileOverlay, getEditorView, getAllEditorViews } from "@jet/ui"
import { indexWorkspaceFiles } from "@jet/workspace"
import type { JetProblem } from "@jet/shared"
import { APP_COMMAND_REGISTRY, buildAppCommands } from "./app-commands.js"
import {
  activeTabKind,
  getAllLeafPanels,
  moveEditorTabsToMain,
  resolveEditorPanel,
  resolveTargetPanel,
} from "./panel-routing.js"
import { loadWorkspaceInit, type JetInitContext } from "./load-workspace-init.js"

const THEME_STORAGE_KEY = "jet-theme-id"

const isWebMode = Boolean(import.meta.env.VITE_JET_WEB)
const hasWorkspaceQuery =
  isWebMode && new URLSearchParams(window.location.search).has("workspace")

function loadStoredTheme(): JetTheme {
  const id = localStorage.getItem(THEME_STORAGE_KEY)
  if (id && bundledThemes[id]) return bundledThemes[id]!
  return defaultJetTheme
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
  const [panelTree, setPanelTree] = useState(() => PanelTree.defaultLayout())
  const [focusedPanel, setFocusedPanel] = useState<PanelId | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [lspRevision, setLspRevision] = useState(0)
  const [userExtensions, setUserExtensions] = useState<Extension[]>([])
  const [keymapRevision, setKeymapRevision] = useState(0)
  const [editorFocused, setEditorFocused] = useState(false)
  const [layoutReady, setLayoutReady] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(hasWorkspaceQuery)
  const [activeTheme, setActiveTheme] = useState<JetTheme>(() => loadStoredTheme())
  const [cursorPos, setCursorPos] = useState<{ line: number; column: number } | null>(null)
  const [gotoLineOpen, setGotoLineOpen] = useState(false)
  const [quickOpenOpen, setQuickOpenOpen] = useState(false)
  const [openFileOpen, setOpenFileOpen] = useState(false)
  const [gitBranch, setGitBranch] = useState<string | null>(null)
  const [fileIndex, setFileIndex] = useState<string[]>([])
  const [problems, setProblems] = useState<JetProblem[]>([])
  const [lspCrashed, setLspCrashed] = useState(false)
  const initialized = useRef(false)
  const queryBootstrapDone = useRef(false)
  const openWorkspaceRef = useRef<(folderPath: string) => Promise<void>>(async () => {})
  const handleOpenFileRef = useRef<(uri: string, path: string) => void>(() => {})
  const explorerTabRef = useRef<TabId | null>(null)
  const gitTabRef = useRef<TabId | null>(null)
  const editorPanelRef = useRef<PanelId | null>(null)
  const terminalTabRef = useRef<TabId | null>(null)
  const searchTabRef = useRef<TabId | null>(null)
  const problemsTabRef = useRef<TabId | null>(null)

  const workspace = useMemo(() => new WorkspaceService(jetPlatformFS()), [])
  const commands = useMemo(() => new CommandRegistry(), [])
  const keymaps = useMemo(() => new KeymapService(), [])

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
      gotoLineOpen,
      workspaceOpen: workspace.root != null,
      explorerFocus: activeTabKindName === "explorer",
      gitFocus: activeTabKindName === "git",
      terminalFocus: activeTabKindName === "terminal",
      searchFocus: activeTabKindName === "search",
    }),
    [editorFocused, paletteOpen, quickOpenOpen, openFileOpen, gotoLineOpen, workspace.root, activeTabKindName],
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

  const openWorkspaceFolder = useCallback(
    async (folderPath: string) => {
      await workspace.openWorkspace(folderPath)

      workspace.tabRegistry.clear()
      explorerTabRef.current = null
      gitTabRef.current = null
      terminalTabRef.current = null
      searchTabRef.current = null
      problemsTabRef.current = null

      const { tree, sidebarPanel, editorPanel } = PanelTree.workspaceLayout()
      editorPanelRef.current = editorPanel
      if (sidebarPanel) {
        explorerTabRef.current = workspace.ensureSingletonTab(
          tree,
          sidebarPanel,
          { kind: "explorer" },
          "Explorer",
          null,
        )
        gitTabRef.current = workspace.ensureSingletonTab(
          tree,
          sidebarPanel,
          { kind: "git" },
          "Git",
          null,
        )
      }
      setPanelTree(tree)
      setFocusedPanel(editorPanel)
      moveEditorTabsToMain(tree, workspace.tabRegistry, sidebarPanel, editorPanel)

      setMessage(`Opened ${folderPath}`)

      if (window.jet?.git) {
        const repo = await window.jet.git.isRepo(workspace.root!.uri)
        if (repo) {
          setGitBranch(await window.jet.git.branch(workspace.root!.uri))
        } else {
          setGitBranch(null)
        }
      }

      try {
        const files = await indexWorkspaceFiles(
          jetPlatformFS(),
          workspace.root!.uri,
          50_000,
          window.jet?.search?.listFiles,
        )
        setFileIndex(files)
      } catch {
        setFileIndex([])
      }

      if (window.jet?.fs.onFileChanged) {
        window.jet.fs.onFileChanged(uri => workspace.handleExternalFileChange(uri))
      }
      await window.jet?.fs.watchWorkspace?.(workspace.root!.uri)

      if (lspManager && workspace.root) {
        try {
          const probeUri = pathToFileUri(`${folderPath}/package.json`)
          await ensureLspForFile(probeUri)
        } catch {
          /* no lsp */
        }
      }
    },
    [workspace, lspManager, handleOpenFile, ensureLspForFile],
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
          const kind = workspace.tabRegistry.get(event.tabId)
          if (kind?.kind === "editor") {
            const file = workspace.fileForUri(kind.fileUri)
            if (file?.isDirty) {
              const label = workspace.tabRegistry.meta(event.tabId).label
              if (!window.confirm(`"${label}" has unsaved changes. Close anyway?`)) return
            }
          }
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

  const getCommandContext = useCallback((): JetCommandContext => {
    return {
      workspace,
      ui: {
        showMessage: setMessage,
        showCommandPalette: () => setPaletteOpen(true),
        setCommandPaletteOpen: setPaletteOpen,
      },
      getActiveEditorView: () => {
        const leaf = focusedPanel && panelTree.getLeaf(focusedPanel)
        const tab = leaf?.group.tabs[leaf.group.active]
        return tab ? (getEditorView(tab) ?? null) : null
      },
    }
  }, [workspace, focusedPanel, panelTree])

  const appCommands = useMemo(
    () =>
      buildAppCommands({
        workspace,
        panelTree,
        focusedPanel,
        setPaletteOpen,
        setQuickOpenOpen,
        setOpenFileOpen,
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
    ],
  )

  const runKeyBinding = useCallback(
    (binding: JetKeyBinding) => {
      void binding.run(getCommandContext())
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

  const loadedInitFor = useRef<string | null>(null)

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
      commands,
      appCommands,
      getCommandContext,
      addKeybindings(bindings) {
        keymaps.registerExtension(bindings)
        setKeymapRevision(r => r + 1)
      },
      addEditorExtensions(ext) {
        setUserExtensions(prev => [...prev, ...ext])
      },
      openFile: async uri => {
        const path = uri.replace(/^file:\/\//, "")
        handleOpenFile(uri, decodeURIComponent(path))
      },
      showMessage: setMessage,
    }

    void loadWorkspaceInit(jetDir, ctx)
  }, [workspace.root, appCommands, getCommandContext, commands, keymaps, handleOpenFile])

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
      openWorkspace: openWorkspaceFolder,
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
    if (!isWebMode || !layoutReady || queryBootstrapDone.current) return
    queryBootstrapDone.current = true
    void openWorkspaceFromQuery(
      window.location.search,
      path => openWorkspaceRef.current(path),
      (uri, path) => handleOpenFileRef.current(uri, path),
    )
      .catch(err => console.warn("Failed to open workspace from query:", err))
      .finally(() => setBootstrapping(false))
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

  useEffect(() => {
    const id = window.setInterval(() => {
      const views = getAllEditorViews(workspace.tabRegistry)
      setProblems(collectProblemsFromViews(views.map(v => ({ uri: v.uri, view: v.view }))))
    }, 1000)
    return () => window.clearInterval(id)
  }, [workspace.tabRegistry, panelTree, keymapRevision])

  useEffect(() => {
    if (activeTabKindName !== "editor" || !focusedPanel) {
      setCursorPos(null)
      return
    }
    const syncCursor = () => {
      const leaf = panelTree.getLeaf(focusedPanel)
      const tabId = leaf?.group.tabs[leaf.group.active]
      if (!tabId) return
      const view = getEditorView(tabId)
      if (!view) return
      const pos = view.state.selection.main.head
      const line = view.state.doc.lineAt(pos)
      setCursorPos({ line: line.number, column: pos - line.from + 1 })
    }
    syncCursor()
    const id = window.setInterval(syncCursor, 300)
    return () => window.clearInterval(id)
  }, [activeTabKindName, focusedPanel, panelTree, keymapRevision])

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
        keymaps.allBindings(),
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

      if (editorFocused) return

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
  }, [keymaps, keymapContext, editorFocused, runKeyBinding, workspace.root])

  const showWorkspace = workspace.root != null

  return (
    <div className="flex h-full flex-col bg-[var(--jet-bg)] text-[var(--jet-text)]">
      <header className="flex h-8 shrink-0 items-center border-b border-[var(--jet-border)] bg-[var(--jet-panel)] px-3 text-xs">
        <span className="font-semibold text-[var(--jet-accent)]">Jet</span>
        <span className="ml-3 text-[var(--jet-text-muted)]">
          {workspace.root?.name ??
            (isWebMode
              ? "No folder open — use ?workspace=fixtures/sample-workspace"
              : "No folder open — use Open Folder")}
        </span>
        <div className="ml-auto flex gap-2">
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
        {showWorkspace ? (
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
            onOpenProblem={p => handleOpenFileAt(p.uri, fileUriToPath(p.uri), p.line, p.column)}
            keymapBindings={keymaps.allBindings()}
            userExtensions={userExtensions}
            keymapRevision={keymapRevision}
            keymapContext={keymapContext}
            onEditorFocusChange={focused => {
              setEditorFocused(focused)
              if (!focused) setCursorPos(null)
            }}
            onEditorSelectionChange={(line, column) => setCursorPos({ line, column })}
          />
        ) : (
          <WelcomeView
            isWebMode={isWebMode}
            bootstrapping={bootstrapping}
            onOpenFolder={() => void executeCommand("workspace.openFolder")}
          />
        )}
      </main>

      <StatusBar
        message={message}
        lspStatus={lspStatus}
        workspaceName={workspace.root?.name}
        workspacePath={workspace.root?.path}
        gitBranch={gitBranch}
        line={activeTabKindName === "editor" ? cursorPos?.line : undefined}
        column={activeTabKindName === "editor" ? cursorPos?.column : undefined}
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

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={commands.list()}
        onRun={id => executeCommand(id)}
      />
    </div>
  )
}
