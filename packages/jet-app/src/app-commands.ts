import type { EditorView } from "@codemirror/view"
import type { PanelTree } from "@jet/panels"
import type { PanelId, TabId } from "@jet/shared"
import { basename, isUntitledUri, pathToFileUri } from "@jet/shared"
import type { JetCommandContext, JetCommands, JetCommandFn, WorkspaceService } from "@jet/workspace"
import { withVscodeStubs, VSCODE_COMMAND_IDS } from "@jet/workspace"
import { openReplaceSearchPanel, openSearchPanel } from "@jet/codemirror"
import { getEditorView } from "@jet/ui"
import { resolveEditorPanel, resolveTargetPanel } from "./panel-routing.js"

export type BuildAppCommandsDeps = {
  workspace: WorkspaceService
  panelTree: PanelTree
  focusedPanel: PanelId | null
  setPaletteOpen: (open: boolean) => void
  setQuickOpenOpen: (open: boolean) => void
  setOpenFileOpen: (open: boolean) => void
  setGotoLineOpen: (open: boolean) => void
  setMessage: (msg: string) => void
  setFocusedPanel: (panel: PanelId) => void
  cloneTree: () => PanelTree
  commitTree: (tree: PanelTree) => void
  openWorkspaceFolder: (path: string) => Promise<void>
  handlePanelEvent: (event: { type: "tabClose"; tabId: TabId }) => void
  showSingletonViewTab: (
    kind: "search" | "problems",
    label: string,
    tabRef: { current: TabId | null },
  ) => void
  searchTabRef: { current: TabId | null }
  problemsTabRef: { current: TabId | null }
  explorerTabRef: { current: TabId | null }
  gitTabRef: { current: TabId | null }
  terminalTabRef: { current: TabId | null }
  editorPanelRef: { current: PanelId | null }
  isWebMode: boolean
}

export function buildAppCommands(deps: BuildAppCommandsDeps): JetCommands {
  const openFolder: JetCommandFn = async () => {
    const folderPath = await window.jet?.fs.showOpenFolderDialog()
    if (!folderPath) {
      if (deps.isWebMode) {
        deps.setMessage("Browser mode: use ?workspace=… URL or window.__jetAgent.openWorkspace()")
      }
      return
    }
    await deps.openWorkspaceFolder(folderPath)
  }

  const named: JetCommands = {
    palette: () => deps.setPaletteOpen(true),
    quickOpen: () => deps.setQuickOpenOpen(true),
    openFile: ctx => {
      if (!deps.workspace.root) {
        void openFolder(ctx)
        return
      }
      deps.setOpenFileOpen(true)
    },
    openFolder,
    save: async ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!view) return
      const leaf = deps.focusedPanel && deps.panelTree.getLeaf(deps.focusedPanel)
      const tabId = leaf?.group.tabs[leaf.group.active]
      if (!tabId) return
      const kind = deps.workspace.tabRegistry.get(tabId)
      if (kind?.kind !== "editor") return
      const content = view.state.doc.toString()
      if (isUntitledUri(kind.fileUri)) {
        if (!deps.workspace.root) return
        let savePath: string | null = null
        if (deps.isWebMode) {
          const rel = window.prompt("Save as (relative to workspace root):", "untitled.ts")
          if (!rel) return
          savePath = `${deps.workspace.root.path}/${rel.replace(/^\/+/, "")}`
        } else {
          savePath = (await window.jet?.fs.showSaveFileDialog()) ?? null
          if (!savePath) return
        }
        const uri = pathToFileUri(savePath)
        await deps.workspace.writeFile(uri, content)
        deps.workspace.promoteUntitledTab(tabId, uri, savePath)
        deps.setMessage(`Saved ${basename(savePath)}`)
        return
      }
      await deps.workspace.writeFile(kind.fileUri, content)
      deps.setMessage("Saved")
    },
    newFile: () => {
      const tree = deps.cloneTree()
      const panel = resolveEditorPanel(
        tree,
        deps.workspace.tabRegistry,
        deps.editorPanelRef.current,
        deps.focusedPanel,
      )
      if (!panel) return
      deps.editorPanelRef.current = panel
      const tabId = deps.workspace.openUntitledTab(tree, panel)
      deps.setFocusedPanel(panel)
      deps.commitTree(tree)
      requestAnimationFrame(() => getEditorView(tabId)?.focus())
    },
    closeTab: () => {
      const leaf = deps.focusedPanel && deps.panelTree.getLeaf(deps.focusedPanel)
      const tabId = leaf?.group.tabs[leaf.group.active]
      if (tabId) deps.handlePanelEvent({ type: "tabClose", tabId })
    },
    find: ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (view) openSearchPanel(view)
    },
    replace: ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (view) openReplaceSearchPanel(view)
    },
    gotoLine: () => deps.setGotoLineOpen(true),
    search: () => deps.showSingletonViewTab("search", "Search", deps.searchTabRef),
    problems: () => deps.showSingletonViewTab("problems", "Problems", deps.problemsTabRef),
    explorer: () => {
      const tree = deps.cloneTree()
      const target = resolveTargetPanel(tree, deps.focusedPanel, deps.workspace.tabRegistry)
      if (!target) return
      if (!deps.explorerTabRef.current) {
        deps.explorerTabRef.current = deps.workspace.ensureSingletonTab(
          tree,
          target,
          { kind: "explorer" },
          "Explorer",
          null,
        )
      }
      const tabPanel =
        deps.workspace.tabRegistry.panelForTab(deps.explorerTabRef.current) ?? target
      tree.setActiveTab(tabPanel, deps.explorerTabRef.current)
      deps.setFocusedPanel(tabPanel)
      deps.commitTree(tree)
    },
    git: () => {
      const tree = deps.cloneTree()
      const target = resolveTargetPanel(tree, deps.focusedPanel, deps.workspace.tabRegistry)
      if (!target) return
      if (!deps.gitTabRef.current) {
        deps.gitTabRef.current = deps.workspace.ensureSingletonTab(
          tree,
          target,
          { kind: "git" },
          "Git",
          null,
        )
      }
      const tabPanel = deps.workspace.tabRegistry.panelForTab(deps.gitTabRef.current) ?? target
      tree.setActiveTab(tabPanel, deps.gitTabRef.current)
      deps.setFocusedPanel(tabPanel)
      deps.commitTree(tree)
    },
    terminal: () => {
      const tree = deps.cloneTree()
      const target = resolveTargetPanel(tree, deps.focusedPanel, deps.workspace.tabRegistry)
      if (!target) return
      deps.terminalTabRef.current = deps.workspace.ensureSingletonTab(
        tree,
        target,
        { kind: "terminal", terminalId: "main" },
        "Terminal",
        deps.terminalTabRef.current,
      )
      const tabPanel =
        deps.workspace.tabRegistry.panelForTab(deps.terminalTabRef.current) ?? target
      tree.setActiveTab(tabPanel, deps.terminalTabRef.current)
      deps.setFocusedPanel(tabPanel)
      deps.commitTree(tree)
    },
  }

  return withVscodeStubs(named, VSCODE_COMMAND_IDS)
}

/** Palette / agent command ids mapped to app command functions. */
export const APP_COMMAND_REGISTRY = [
  { id: "ui.showCommandPalette", fn: "palette", title: "Show Command Palette", category: "UI" },
  { id: "workspace.quickOpen", fn: "quickOpen", title: "Quick Open File", category: "Workspace" },
  { id: "workspace.saveFile", fn: "save", title: "Save File", category: "Workspace" },
  { id: "workspace.openFile", fn: "openFile", title: "Open File", category: "Workspace" },
  { id: "workspace.openFolder", fn: "openFolder", title: "Open Folder", category: "Workspace" },
  { id: "workspace.newFile", fn: "newFile", title: "New File", category: "Workspace" },
  { id: "layout.closeTab", fn: "closeTab", title: "Close Tab", category: "Layout" },
  { id: "editor.find", fn: "find", title: "Find in Editor", category: "Editor" },
  { id: "editor.replace", fn: "replace", title: "Replace in Editor", category: "Editor" },
  { id: "editor.gotoLine", fn: "gotoLine", title: "Go to Line…", category: "Editor" },
  { id: "search.show", fn: "search", title: "Show Search", category: "View" },
  { id: "git.showChanges", fn: "git", title: "Show Git Changes", category: "Git" },
  { id: "explorer.show", fn: "explorer", title: "Show Explorer", category: "View" },
  { id: "terminal.show", fn: "terminal", title: "Show Terminal", category: "View" },
  { id: "problems.show", fn: "problems", title: "Show Problems", category: "View" },
] as const
