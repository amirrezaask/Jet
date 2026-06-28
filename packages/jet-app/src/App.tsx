import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react"
import { PanelTree, type PanelEvent } from "@jet/panels"
import type { EditorView } from "@codemirror/view"
import type { PanelId, TabId, PanelNode } from "@jet/shared"
import { pathToFileUri, isUntitledUri, basename } from "@jet/shared"
import {
  WorkspaceService,
  CommandRegistry,
  KeymapService,
  keyEventMatchesBinding,
  matchesWhen,
  defaultKeybindings,
  type TabRegistry,
  type TabKind,
} from "@jet/workspace"
import { LanguageServerManager } from "@jet/lsp"
import { createJetAPI, loadEditorRc } from "@jet/extension-host"
import { createAgentBridge, openWorkspaceFromQuery } from "@jet/browser"
import type { Extension } from "@codemirror/state"
import { applyJetThemeCss, defaultJetTheme, openSearchPanel, type JetTheme } from "@jet/codemirror"
import { PanelDock, CommandPalette, StatusBar, WelcomeView, bundledThemes } from "@jet/ui"
import { getEditorView } from "@jet/ui"

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
  const [lspUrl, setLspUrl] = useState<string | null>(null)
  const [userExtensions, setUserExtensions] = useState<Extension[]>([])
  const [keymapRevision, setKeymapRevision] = useState(0)
  const [editorFocused, setEditorFocused] = useState(false)
  const [layoutReady, setLayoutReady] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(hasWorkspaceQuery)
  const [activeTheme, setActiveTheme] = useState<JetTheme>(() => loadStoredTheme())
  const [cursorPos, setCursorPos] = useState<{ line: number; column: number } | null>(null)
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
      workspaceOpen: workspace.root != null,
      explorerFocus: activeTabKindName === "explorer",
      gitFocus: activeTabKindName === "git",
      terminalFocus: activeTabKindName === "terminal",
      searchFocus: activeTabKindName === "search",
    }),
    [editorFocused, paletteOpen, workspace.root, activeTabKindName],
  )

  const lspStatus = useMemo((): "connected" | "off" | "unavailable" => {
    if (isWebMode) return "unavailable"
    if (lspUrl) return "connected"
    if (workspace.root) return "off"
    return "off"
  }, [lspUrl, workspace.root])

  const lspManager = useMemo(
    () => (!isWebMode && window.jet ? new LanguageServerManager(window.jet.lsp) : null),
    [],
  )

  const cloneTree = useCallback(
    () => PanelTree.fromJSON(panelTree.toJSON()),
    [panelTree],
  )

  const commitTree = useCallback((tree: PanelTree) => {
    setPanelTree(PanelTree.fromJSON(tree.toJSON()))
  }, [])

  useEffect(() => {
    applyJetThemeCss(activeTheme)
    keymaps.registerUser(defaultKeybindings)
  }, [keymaps, activeTheme])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    setLayoutReady(true)
  }, [])

  const handleOpenFile = useCallback(
    (uri: string, path: string) => {
      const tree = cloneTree()
      const panel = resolveEditorPanel(
        tree,
        workspace.tabRegistry,
        editorPanelRef.current,
        focusedPanel,
      )
      if (!panel) return
      editorPanelRef.current = panel
      workspace.openEditorTab(tree, panel, uri, path)
      setFocusedPanel(panel)
      commitTree(tree)
    },
    [workspace, focusedPanel, cloneTree, commitTree],
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
      const jet = createJetAPI({
        workspace,
        commands,
        getActiveView: () => {
          const leaf = focusedPanel && panelTree.getLeaf(focusedPanel)
          const tab = leaf?.group.tabs[leaf.group.active]
          return tab ? (getEditorView(tab) ?? null) : null
        },
        showMessage: setMessage,
        registerKeymaps: bindings => {
          keymaps.registerExtension(bindings)
          setKeymapRevision(r => r + 1)
        },
        registerExtensions: ext => {
          setUserExtensions(prev => [...prev, ...ext])
        },
        openFile: async uri => {
          const path = uri.replace(/^file:\/\//, "")
          handleOpenFile(uri, decodeURIComponent(path))
        },
      })
      await loadEditorRc(`${folderPath}/.jet/editorrc.ts`, jet)
      if (lspManager && workspace.root) {
        try {
          const probeUri = pathToFileUri(`${folderPath}/package.json`)
          const file = workspace.createWorkspaceFile(probeUri, `${folderPath}/package.json`)
          const conn = await lspManager.ensureServerForFile(file, workspace.root.uri)
          setLspUrl(conn?.transportUrl ?? null)
        } catch {
          /* no lsp */
        }
      }
    },
    [workspace, commands, focusedPanel, keymaps, lspManager, handleOpenFile],
  )

  openWorkspaceRef.current = openWorkspaceFolder
  handleOpenFileRef.current = handleOpenFile

  const executeCommand = useCallback(
    async (name: string) => {
      await commands.execute(name, {
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
      })
    },
    [commands, workspace, focusedPanel, panelTree],
  )

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

  useEffect(() => {
    commands.register("ui.showCommandPalette", () => setPaletteOpen(true), {
      id: "ui.showCommandPalette",
      title: "Show Command Palette",
      category: "UI",
    })
    commands.register(
      "workspace.openFolder",
      async () => {
        const folderPath = await window.jet?.fs.showOpenFolderDialog()
        if (!folderPath) {
          if (isWebMode) {
            setMessage("Browser mode: use ?workspace=… URL or window.__jetAgent.openWorkspace()")
          }
          return
        }
        await openWorkspaceFolder(folderPath)
      },
      { id: "workspace.openFolder", title: "Open Folder", category: "Workspace" },
    )
    commands.register(
      "workspace.saveFile",
      async ctx => {
        const view = ctx.getActiveEditorView() as EditorView | null
        if (!view) return
        const leaf = focusedPanel && panelTree.getLeaf(focusedPanel)
        const tabId = leaf?.group.tabs[leaf.group.active]
        if (!tabId) return
        const kind = workspace.tabRegistry.get(tabId)
        if (kind?.kind !== "editor") return
        const content = view.state.doc.toString()
        if (isUntitledUri(kind.fileUri)) {
          if (!workspace.root) return
          let savePath: string | null = null
          if (isWebMode) {
            const rel = window.prompt("Save as (relative to workspace root):", "untitled.ts")
            if (!rel) return
            savePath = `${workspace.root.path}/${rel.replace(/^\/+/, "")}`
          } else {
            savePath = (await window.jet?.fs.showSaveFileDialog()) ?? null
            if (!savePath) return
          }
          const uri = pathToFileUri(savePath)
          await workspace.writeFile(uri, content)
          workspace.promoteUntitledTab(tabId, uri, savePath)
          setMessage(`Saved ${basename(savePath)}`)
          return
        }
        await workspace.writeFile(kind.fileUri, content)
        setMessage("Saved")
      },
      { id: "workspace.saveFile", title: "Save File", category: "Workspace" },
    )
    commands.register(
      "workspace.newFile",
      () => {
        const tree = cloneTree()
        const panel = resolveEditorPanel(
          tree,
          workspace.tabRegistry,
          editorPanelRef.current,
          focusedPanel,
        )
        if (!panel) return
        editorPanelRef.current = panel
        const tabId = workspace.openUntitledTab(tree, panel)
        setFocusedPanel(panel)
        commitTree(tree)
        requestAnimationFrame(() => getEditorView(tabId)?.focus())
      },
      { id: "workspace.newFile", title: "New File", category: "Workspace" },
    )
    commands.register(
      "explorer.show",
      () => {
        const tree = cloneTree()
        const target = resolveTargetPanel(tree, focusedPanel, workspace.tabRegistry)
        if (!target) return
        if (!explorerTabRef.current) {
          explorerTabRef.current = workspace.ensureSingletonTab(
            tree,
            target,
            { kind: "explorer" },
            "Explorer",
            null,
          )
        }
        const tabPanel =
          workspace.tabRegistry.panelForTab(explorerTabRef.current) ?? target
        tree.setActiveTab(tabPanel, explorerTabRef.current)
        setFocusedPanel(tabPanel)
        commitTree(tree)
      },
      { id: "explorer.show", title: "Show Explorer", category: "View" },
    )
    commands.register(
      "git.showChanges",
      () => {
        const tree = cloneTree()
        const target = resolveTargetPanel(tree, focusedPanel, workspace.tabRegistry)
        if (!target) return
        if (!gitTabRef.current) {
          gitTabRef.current = workspace.ensureSingletonTab(
            tree,
            target,
            { kind: "git" },
            "Git",
            null,
          )
        }
        const tabPanel = workspace.tabRegistry.panelForTab(gitTabRef.current) ?? target
        tree.setActiveTab(tabPanel, gitTabRef.current)
        setFocusedPanel(tabPanel)
        commitTree(tree)
      },
      { id: "git.showChanges", title: "Show Git Changes", category: "Git" },
    )
    commands.register(
      "terminal.show",
      () => {
        const tree = cloneTree()
        const target = resolveTargetPanel(tree, focusedPanel, workspace.tabRegistry)
        if (!target) return
        terminalTabRef.current = workspace.ensureSingletonTab(
          tree,
          target,
          { kind: "terminal", terminalId: "main" },
          "Terminal",
          terminalTabRef.current,
        )
        const tabPanel =
          workspace.tabRegistry.panelForTab(terminalTabRef.current) ?? target
        tree.setActiveTab(tabPanel, terminalTabRef.current)
        setFocusedPanel(tabPanel)
        commitTree(tree)
      },
      { id: "terminal.show", title: "Show Terminal", category: "View" },
    )
    commands.register(
      "layout.closeTab",
      () => {
        const leaf = focusedPanel && panelTree.getLeaf(focusedPanel)
        const tabId = leaf?.group.tabs[leaf.group.active]
        if (tabId) handlePanelEvent({ type: "tabClose", tabId })
      },
      { id: "layout.closeTab", title: "Close Tab", category: "Layout" },
    )
    commands.register(
      "editor.find",
      ctx => {
        const view = ctx.getActiveEditorView() as EditorView | null
        if (view) openSearchPanel(view)
      },
      { id: "editor.find", title: "Find in Editor", category: "Editor" },
    )
    commands.register(
      "search.show",
      () => showSingletonViewTab("search", "Search", searchTabRef),
      { id: "search.show", title: "Show Search", category: "View" },
    )
    commands.register(
      "problems.show",
      () => showSingletonViewTab("problems", "Problems", problemsTabRef),
      { id: "problems.show", title: "Show Problems", category: "View" },
    )
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
  }, [commands, workspace, focusedPanel, panelTree, cloneTree, commitTree, openWorkspaceFolder, handlePanelEvent, showSingletonViewTab])

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
    const onKey = (e: KeyboardEvent) => {
      if (paletteOpen) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      for (const binding of keymaps.allBindings()) {
        if (editorFocused) continue
        if (!matchesWhen(binding, keymapContext)) continue
        if (!keyEventMatchesBinding(e, binding.key)) continue
        e.preventDefault()
        void executeCommand(binding.command)
        return
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [keymaps, keymapContext, editorFocused, paletteOpen, executeCommand])

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
            onClick={() => setPaletteOpen(true)}
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
            lspTransportUrl={lspUrl}
            executeCommand={executeCommand}
            onOpenFile={handleOpenFile}
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
        line={activeTabKindName === "editor" ? cursorPos?.line : undefined}
        column={activeTabKindName === "editor" ? cursorPos?.column : undefined}
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

function resolveTargetPanel(
  tree: PanelTree,
  focused: PanelId | null,
  registry: TabRegistry,
): PanelId | null {
  if (focused) return focused
  return getAllLeafPanels(tree)[0] ?? null
}

function moveEditorTabsToMain(
  tree: PanelTree,
  registry: TabRegistry,
  sidebarPanel: PanelId,
  editorPanel: PanelId,
): void {
  const sidebarLeaf = tree.getLeaf(sidebarPanel)
  if (!sidebarLeaf) return
  for (const tab of [...sidebarLeaf.group.tabs]) {
    if (registry.get(tab)?.kind !== "editor") continue
    tree.removeTab(tab)
    tree.insertTab(editorPanel, tab)
    registry.setPanel(tab, editorPanel)
  }
}

/**
 * Pick the panel where a newly opened/created editor tab should land.
 * Deterministic, mirrors the RAD/imui "main content panel" idea:
 *   1. focused panel, if it already hosts editor tabs (split-editor case)
 *   2. the dedicated main editor panel, if it still exists
 *   3. any panel that already hosts an editor tab
 *   4. largest non-sidebar panel
 *   5. any leaf
 */
function resolveEditorPanel(
  tree: PanelTree,
  registry: TabRegistry,
  editorPanel: PanelId | null,
  focused: PanelId | null,
): PanelId | null {
  const panels = getAllLeafPanels(tree)
  if (panels.length === 0) return null

  if (focused && panelHasEditor(tree, focused, registry)) return focused

  if (editorPanel && panels.some(p => p.id === editorPanel.id)) return editorPanel

  const withEditor = panels.find(p => panelHasEditor(tree, p, registry))
  if (withEditor) return withEditor

  const nonSidebar = panels.filter(p => !isSidebarOnlyPanel(tree, p, registry))
  return pickLargestPanel(tree, nonSidebar.length > 0 ? nonSidebar : panels)
}

function panelHasEditor(tree: PanelTree, panel: PanelId, registry: TabRegistry): boolean {
  const leaf = tree.getLeaf(panel)
  if (!leaf) return false
  return leaf.group.tabs.some(t => registry.get(t)?.kind === "editor")
}

/** Panel whose tabs are all sidebar-kind (explorer/git/search/problems). Empty panel is not sidebar. */
function isSidebarOnlyPanel(tree: PanelTree, panel: PanelId, registry: TabRegistry): boolean {
  const leaf = tree.getLeaf(panel)
  if (!leaf || leaf.group.tabs.length === 0) return false
  return leaf.group.tabs.every(t => {
    const kind = registry.get(t)?.kind
    return kind === "explorer" || kind === "git" || kind === "search" || kind === "problems"
  })
}

const EDITOR_LAYOUT_VIEWPORT = { x: 0, y: 0, width: 1280, height: 800 }

function panelArea(tree: PanelTree, panel: PanelId): number {
  const rect = tree.computeRects(EDITOR_LAYOUT_VIEWPORT).get(panel.id)
  return rect ? rect.width * rect.height : 0
}

function pickLargestPanel(tree: PanelTree, panels: PanelId[]): PanelId | null {
  if (panels.length === 0) return null
  return panels.reduce((best, p) => (panelArea(tree, p) > panelArea(tree, best) ? p : best))
}

function activeTabKind(
  tree: PanelTree,
  panel: PanelId,
  registry: TabRegistry,
): TabKind["kind"] | undefined {
  const leaf = tree.getLeaf(panel)
  const tab = leaf?.group.tabs[leaf.group.active]
  return tab ? registry.get(tab)?.kind : undefined
}

function getAllLeafPanels(tree: PanelTree): PanelId[] {
  const result: PanelId[] = []
  walk(tree.root, node => {
    if (node.kind === "leaf") result.push(node.panelId)
  })
  return result
}

function walk(node: PanelNode, fn: (n: PanelNode) => void) {
  fn(node)
  if (node.kind !== "leaf") node.split.children.forEach((c: PanelNode) => walk(c, fn))
}
