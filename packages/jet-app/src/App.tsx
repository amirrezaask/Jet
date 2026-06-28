import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PanelTree, type PanelEvent } from "@jet/panels"
import type { EditorView } from "@codemirror/view"
import type { PanelId, TabId, PanelNode } from "@jet/shared"
import { pathToFileUri } from "@jet/shared"
import {
  WorkspaceService,
  CommandRegistry,
  KeymapService,
  defaultKeybindings,
} from "@jet/workspace"
import { LanguageServerManager } from "@jet/lsp"
import { createJetAPI, loadEditorRc } from "@jet/extension-host"
import type { Extension } from "@codemirror/state"
import { applyJetThemeCss, defaultJetTheme } from "@jet/codemirror"
import { PanelDock, CommandPalette, jetMotion } from "@jet/ui"
import { getEditorView } from "@jet/ui"
import { motion, AnimatePresence } from "motion/react"

function createBrowserFS(): import("@jet/workspace").FileSystemProvider {
  return {
    async readFile() {
      throw new Error("FS not available")
    },
    async writeFile() {
      throw new Error("FS not available")
    },
    async readDir() {
      return []
    },
    async stat(uri) {
      return { uri, isDirectory: false, size: 0 }
    },
  }
}

function electronFS(): import("@jet/workspace").FileSystemProvider {
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
  const initialized = useRef(false)
  const extensionExtensions = useRef<Extension[]>([])
  const explorerTabRef = useRef<TabId | null>(null)
  const gitTabRef = useRef<TabId | null>(null)
  const editorPanelRef = useRef<PanelId | null>(null)
  const explorerPanelRef = useRef<PanelId | null>(null)

  const workspace = useMemo(
    () => new WorkspaceService(window.jet ? electronFS() : createBrowserFS()),
    [],
  )
  const commands = useMemo(() => new CommandRegistry(), [])
  const keymaps = useMemo(() => new KeymapService(), [])

  const lspManager = useMemo(
    () => (window.jet ? new LanguageServerManager(window.jet.lsp) : null),
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
    applyJetThemeCss(defaultJetTheme)
    keymaps.registerUser(defaultKeybindings)
  }, [keymaps])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const tree = panelTree
    const panels = getAllLeafPanels(tree)
    explorerPanelRef.current = panels[0] ?? null
    editorPanelRef.current = panels[panels.length - 1] ?? panels[0] ?? null
    setFocusedPanel(editorPanelRef.current)

    if (explorerPanelRef.current) {
      explorerTabRef.current = workspace.ensureSingletonTab(
        tree,
        explorerPanelRef.current,
        { kind: "explorer" },
        "Explorer",
        explorerTabRef.current,
      )
    }
    if (editorPanelRef.current) {
      gitTabRef.current = workspace.ensureSingletonTab(
        tree,
        editorPanelRef.current,
        { kind: "git" },
        "Git",
        gitTabRef.current,
      )
    }
    commitTree(tree)
  }, [panelTree, workspace, commitTree])

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

  const handleOpenFile = useCallback(
    (uri: string, path: string) => {
      const tree = cloneTree()
      const panel = focusedPanel ?? editorPanelRef.current
      if (!panel) return
      workspace.openEditorTab(tree, panel, uri, path)
      commitTree(tree)
    },
    [workspace, focusedPanel, cloneTree, commitTree],
  )

  const handlePanelEvent = useCallback(
    (event: PanelEvent) => {
      const tree = cloneTree()
      switch (event.type) {
        case "tabSelect":
          tree.setActiveTab(event.panelId, event.tabId)
          setFocusedPanel(event.panelId)
          break
        case "tabClose":
          workspace.tabRegistry.delete(event.tabId)
          tree.removeTab(event.tabId)
          break
        case "tabMoved":
          tree.moveTab(event.tabId, event.targetPanelId, event.action, event.insertIndex)
          break
        case "splitResized":
          tree.resizeSplit(event.path, event.splitterIndex, event.deltaPx, {
            x: 0,
            y: 0,
            width: 1200,
            height: 800,
          })
          break
      }
      commitTree(tree)
    },
    [cloneTree, commitTree, workspace],
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
        if (!folderPath) return
        await workspace.openWorkspace(folderPath)
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
          registerKeymaps: bindings => keymaps.registerExtension(bindings),
          registerExtensions: ext => {
            extensionExtensions.current.push(...ext)
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
        await workspace.writeFile(kind.fileUri, view.state.doc.toString())
        setMessage("Saved")
      },
      { id: "workspace.saveFile", title: "Save File", category: "Workspace" },
    )
    commands.register(
      "explorer.show",
      () => {
        const tree = cloneTree()
        if (explorerTabRef.current && explorerPanelRef.current) {
          tree.setActiveTab(explorerPanelRef.current, explorerTabRef.current)
          setFocusedPanel(explorerPanelRef.current)
          commitTree(tree)
        }
      },
      { id: "explorer.show", title: "Show Explorer", category: "View" },
    )
    commands.register(
      "git.showChanges",
      () => {
        const tree = cloneTree()
        if (gitTabRef.current && editorPanelRef.current) {
          tree.setActiveTab(editorPanelRef.current, gitTabRef.current)
          setFocusedPanel(editorPanelRef.current)
          commitTree(tree)
        }
      },
      { id: "git.showChanges", title: "Show Git Changes", category: "Git" },
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
  }, [commands, workspace, focusedPanel, panelTree, cloneTree, commitTree, lspManager, keymaps, handleOpenFile, handlePanelEvent])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div className="flex h-full flex-col bg-[var(--jet-bg)] text-[var(--jet-text)]">
      <header className="flex h-8 shrink-0 items-center border-b border-[var(--jet-border)] bg-[var(--jet-panel)] px-3 text-xs">
        <span className="font-semibold text-[var(--jet-accent)]">Jet</span>
        <span className="ml-3 text-[var(--jet-text-muted)]">
          {workspace.root?.name ?? "No folder open — use Open Folder"}
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
        <PanelDock
          tree={panelTree}
          registry={workspace.tabRegistry}
          workspace={workspace}
          theme={defaultJetTheme}
          focusedPanelId={focusedPanel}
          onFocusPanel={setFocusedPanel}
          onEvent={handlePanelEvent}
          lspTransportUrl={lspUrl}
          executeCommand={executeCommand}
          onOpenFile={handleOpenFile}
          keymapBindings={keymaps.allBindings()}
        />
      </main>

      <footer className="flex h-6 shrink-0 items-center border-t border-[var(--jet-border)] bg-[var(--jet-panel)] px-2 text-[10px] text-[var(--jet-text-muted)]">
        {message ?? "Ready"}
      </footer>

      <AnimatePresence>
        {paletteOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={jetMotion.quickFade}
          >
            <CommandPalette
              open={paletteOpen}
              onOpenChange={setPaletteOpen}
              commands={commands.list()}
              onRun={id => executeCommand(id)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
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
