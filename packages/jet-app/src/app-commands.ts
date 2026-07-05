import type { EditorView } from "@codemirror/view"
import {
  toggleComment,
  copyLineUp,
  copyLineDown,
  moveLineUp,
  moveLineDown,
  addCursorAbove,
  addCursorBelow,
  cursorMatchingBracket,
  selectLine,
  indentMore,
  indentLess,
  undo,
  redo,
  undoSelection,
  selectParentSyntax,
  simplifySelection,
} from "@codemirror/commands"
import { selectNextOccurrence, selectSelectionMatches } from "@codemirror/search"
import type { JetPanelTree } from "@jet/workspace"
import type { PanelEvent } from "@jet/panels"
import type { PanelId } from "@jet/shared"
import { basename, fileUriToPath, isUntitledUri, pathToFileUri } from "@jet/shared"
import type { JetCommandContext, JetCommands, JetCommandFn, ListItem, WorkspaceService } from "@jet/workspace"
import { PROBLEMS_TAB_ID, EXPLORER_TAB_ID } from "@jet/workspace"
import { problemsToListItems } from "@jet/ui"
import { openJetSearch } from "@jet/codemirror"
import {
  fetchDocumentOutline,
  runFindReferences,
  runFormatDocument,
  runParameterHints,
  runRenameSymbol,
  runGoToDefinition,
  runGoToDeclaration,
  runGoToTypeDefinition,
  runGoToImplementation,
  runTriggerSuggest,
  runShowHover,
  lspPluginForView,
  type OutlineSymbol,
} from "@jet/codemirror"
import { scheduleCodeActions, applyCodeAction } from "@jet/lsp"
import type { OutlineEntry } from "@jet/ui"
import { getEditorView, showEditorContextMenuAt, destroyEditorBuffer } from "@jet/ui"
import {
  getActiveEditorFileUri,
  getAllLeafPanels,
  resolveEditorPanel,
  resolveTargetPanel,
  panelHasExplorerTab,
  closePanelIfEmpty,
} from "./panel-routing.js"
import {
  openExplorerTab,
  openOutputTab,
  openProblemsTab,
  openSearchTab,
  openTabInAuxiliaryPanel,
} from "./tab-routing.js"
import { confirmCloseBuffer } from "./close-buffer.js"

export type BuildAppCommandsDeps = {
  workspace: WorkspaceService
  getPanelTree: () => JetPanelTree
  getFocusedPanel: () => PanelId | null
  setPaletteOpen: (open: boolean) => void
  setQuickOpenOpen: (open: boolean) => void
  setBufferListOpen: (open: boolean) => void
  setOpenFileOpen: (open: boolean) => void
  setCdOpen: (open: boolean) => void
  setProjectSwitcherOpen: (open: boolean) => void
  setGotoLineOpen: (open: boolean) => void
  setMessage: (msg: string) => void
  setFocusedPanel: (panel: PanelId) => void
  cloneTree: () => JetPanelTree
  commitTree: (tree: JetPanelTree) => void
  openWorkspaceFolder: (path: string) => void
  handlePanelEvent: (event: PanelEvent) => void
  openFileInEditor: (uri: string, path: string, line?: number, column?: number, pushJump?: boolean) => void
  openListItem: (item: ListItem) => void
  syncProblemsToListTab: () => void
  editorPanelRef: { current: PanelId | null }
  isWebMode: boolean
  setZoomLevel: (delta: number) => void
  handlePanelNavigation: (action: string) => void
  setOutlineOpen: (open: boolean) => void
  setOutlineSymbols: (symbols: OutlineEntry[]) => void
  pushJumpFromActiveEditor: (label?: string) => void
  projectRegistry: import("@jet/workspace").ProjectRegistry
  refreshProjects: () => Promise<number>
  focusExplorer?: () => void
}

export function buildAppCommands(deps: BuildAppCommandsDeps): JetCommands {
  const currentPanelTree = () => deps.getPanelTree()
  const currentFocusedPanel = () => deps.getFocusedPanel()

  const openFolder: JetCommandFn = async () => {
    const folderPath = await window.jet?.fs.showOpenFolderDialog()
    if (!folderPath) {
      if (deps.isWebMode) {
        deps.setMessage("Browser mode: use ?workspace=… URL or window.__jetAgent.openWorkspace()")
      }
      return
    }
    deps.openWorkspaceFolder(folderPath)
  }

  function runCmCmd(ctx: JetCommandContext, fn: (v: EditorView) => boolean): void {
    const view = ctx.getActiveEditorView() as EditorView | null
    if (view) fn(view)
  }

  function flattenOutline(symbols: OutlineSymbol[], depth = 0): OutlineEntry[] {
    const out: OutlineEntry[] = []
    for (const sym of symbols) {
      out.push({ name: sym.name, line: sym.line, depth })
      out.push(...flattenOutline(sym.children, depth + 1))
    }
    return out
  }

  function lspUnavailable(ctx: JetCommandContext): boolean {
    if (!window.jet?.lsp) {
      ctx.ui.showMessage("LSP not available in browser mode")
      return true
    }
    return false
  }

  function activeEditorPanel(): PanelId | null {
    return resolveEditorPanel(
      currentPanelTree(),
      deps.editorPanelRef.current,
      currentFocusedPanel(),
    )
  }

  const named: JetCommands = {
    palette: () => deps.setPaletteOpen(true),
    quickOpen: () => deps.setQuickOpenOpen(true),
    bufferList: () => deps.setBufferListOpen(true),
    openFile: ctx => {
      if (!deps.workspace.root) {
        void openFolder(ctx)
        return
      }
      deps.setOpenFileOpen(true)
    },
    openFolder,
    cd: () => deps.setCdOpen(true),
    switchProject: () => deps.setProjectSwitcherOpen(true),
    refreshProjects: async ctx => {
      const count = await deps.refreshProjects()
      ctx.ui.showMessage(count === 0 ? "No git projects found" : `Found ${count} projects`)
    },
    save: async ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!view) return
      const panel = currentFocusedPanel()
      const fileUri = panel && getActiveEditorFileUri(currentPanelTree(), panel)
      if (!fileUri) return
      const content = view.state.doc.toString()
      if (isUntitledUri(fileUri)) {
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
        const tree = deps.cloneTree()
        if (panel) {
          deps.workspace.promoteUntitled(fileUri, uri, savePath)
          deps.workspace.assignEditorPanel(tree, panel, uri, savePath, { replaceUri: fileUri })
          destroyEditorBuffer(panel, fileUri)
          deps.commitTree(tree)
        }
        deps.setMessage(`Saved ${basename(savePath)}`)
        return
      }
      await deps.workspace.writeFile(fileUri, content)
      deps.setMessage("Saved")
    },
    newFile: () => {
      const tree = deps.cloneTree()
      const panel = activeEditorPanel()
      if (!panel) return
      deps.editorPanelRef.current = panel
      deps.workspace.openUntitledInPanel(tree, panel)
      deps.setFocusedPanel(panel)
      deps.commitTree(tree)
      requestAnimationFrame(() => getEditorView(panel)?.focus())
    },
    closeBuffer: async () => {
      const panel = currentFocusedPanel()
      const fileUri = panel && getActiveEditorFileUri(currentPanelTree(), panel)
      if (!fileUri || !panel) return
      if (!(await confirmCloseBuffer(deps.workspace, fileUri))) return
      deps.workspace.clearDirtyState(fileUri)
      destroyEditorBuffer(panel, fileUri)
      deps.workspace.closeBuffer(fileUri)
      deps.workspace.disposeTab(fileUri)
      const tree = deps.cloneTree()
      deps.workspace.popPanelBuffer(tree, panel, fileUri)
      closePanelIfEmpty(tree, panel)
      deps.commitTree(tree)
    },
    find: ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      const panel = currentFocusedPanel()
      if (view) openJetSearch(view, "find", panel?.id)
    },
    replace: ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      const panel = currentFocusedPanel()
      if (view) openJetSearch(view, "replace", panel?.id)
    },
    gotoLine: () => deps.setGotoLineOpen(true),
    locationList: () => {
      const tree = deps.cloneTree()
      const { panelId } = openSearchTab(deps.workspace, tree, currentFocusedPanel())
      deps.setFocusedPanel(panelId)
      deps.commitTree(tree)
    },
    locationListSearch: () => {
      deps.syncProblemsToListTab()
      const tree = deps.cloneTree()
      const { panelId } = openSearchTab(deps.workspace, tree, currentFocusedPanel())
      deps.setFocusedPanel(panelId)
      deps.commitTree(tree)
    },
    locationListProblems: () => {
      deps.syncProblemsToListTab()
      const tree = deps.cloneTree()
      const { panelId } = openProblemsTab(deps.workspace, tree, currentFocusedPanel())
      deps.setFocusedPanel(panelId)
      deps.commitTree(tree)
    },
    output: () => {
      const tree = deps.cloneTree()
      const target = resolveTargetPanel(tree, currentFocusedPanel()) ?? deps.editorPanelRef.current
      if (!target) return
      const { panelId } = openOutputTab(deps.workspace, tree, target)
      deps.setFocusedPanel(panelId)
      deps.commitTree(tree)
    },
    explorer: () => {
      const tree = deps.cloneTree()
      const { panelId } = openExplorerTab(deps.workspace, tree, currentFocusedPanel())
      deps.setFocusedPanel(panelId)
      deps.commitTree(tree)
      deps.focusExplorer?.()
    },
    jumpBack: ctx => {
      const panel = currentFocusedPanel()
      const fileUri = panel && getActiveEditorFileUri(currentPanelTree(), panel)
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!fileUri || !view) return
      const pos = view.state.selection.main.head
      const line = view.state.doc.lineAt(pos)
      const current = {
        fileUri,
        line: line.number,
        column: pos - line.from + 1,
        panelId: panel ?? undefined,
      }
      const entry = deps.workspace.jumpStack.popBack(current)
      if (!entry) return
      deps.openFileInEditor(entry.fileUri, fileUriToPath(entry.fileUri), entry.line, entry.column, false)
    },
    jumpForward: ctx => {
      const panel = currentFocusedPanel()
      const fileUri = panel && getActiveEditorFileUri(currentPanelTree(), panel)
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!fileUri || !view) return
      const pos = view.state.selection.main.head
      const line = view.state.doc.lineAt(pos)
      const current = {
        fileUri,
        line: line.number,
        column: pos - line.from + 1,
        panelId: panel ?? undefined,
      }
      const entry = deps.workspace.jumpStack.popForward(current)
      if (!entry) return
      deps.openFileInEditor(entry.fileUri, fileUriToPath(entry.fileUri), entry.line, entry.column, false)
    },
    runTask: async ctx => {
      const tasks = deps.workspace.taskRunner.tasks
      if (!tasks.length) {
        ctx.ui.showMessage("No tasks — add .jet/tasks.json or register in editorrc")
        return
      }
      const task = tasks[0]!
      if (!deps.workspace.root) return
      void deps.workspace.taskRunner.runTask(task, deps.workspace.root.path, deps.workspace.root.path)
      const tree = deps.cloneTree()
      const target = resolveTargetPanel(tree, currentFocusedPanel()) ?? deps.editorPanelRef.current
      if (target) {
        const { panelId } = openOutputTab(deps.workspace, tree, target)
        deps.setFocusedPanel(panelId)
        deps.commitTree(tree)
      }
      const run = deps.workspace.taskRunner.activeRun()
      if (run?.errors.length) {
        const doc = deps.workspace.createTaskErrorsList(
          `Task: ${task.label}`,
          run.errors,
          task.label,
          run.status,
        )
        const errTree = deps.cloneTree()
        const { panelId } = openTabInAuxiliaryPanel(
          deps.workspace,
          errTree,
          currentFocusedPanel(),
          doc,
        )
        deps.setFocusedPanel(panelId)
        deps.commitTree(errTree)
      }
    },
    runBuild: async ctx => {
      const build = deps.workspace.taskRunner.tasks.find(t => t.group === "build") ?? deps.workspace.taskRunner.tasks[0]
      if (!build) {
        ctx.ui.showMessage("No build task configured")
        return
      }
      if (!deps.workspace.root) return
      void deps.workspace.taskRunner.runTask(build, deps.workspace.root.path, deps.workspace.root.path)
      const tree = deps.cloneTree()
      const target = resolveTargetPanel(tree, currentFocusedPanel()) ?? deps.editorPanelRef.current
      if (target) {
        const { panelId } = openOutputTab(deps.workspace, tree, target)
        deps.setFocusedPanel(panelId)
        deps.commitTree(tree)
      }
    },

    toggleComment: ctx => runCmCmd(ctx, toggleComment),
    copyLineUp: ctx => runCmCmd(ctx, copyLineUp),
    copyLineDown: ctx => runCmCmd(ctx, copyLineDown),
    moveLineUp: ctx => runCmCmd(ctx, moveLineUp),
    moveLineDown: ctx => runCmCmd(ctx, moveLineDown),
    addCursorAbove: ctx => runCmCmd(ctx, addCursorAbove),
    addCursorBelow: ctx => runCmCmd(ctx, addCursorBelow),
    jumpToBracket: ctx => runCmCmd(ctx, cursorMatchingBracket),
    expandLineSelection: ctx => runCmCmd(ctx, selectLine),
    indentMore: ctx => runCmCmd(ctx, indentMore),
    indentLess: ctx => runCmCmd(ctx, indentLess),
    selectNextOccurrence: ctx => runCmCmd(ctx, selectNextOccurrence),
    selectAllOccurrences: ctx => runCmCmd(ctx, selectSelectionMatches),
    undo: ctx => runCmCmd(ctx, undo),
    redo: ctx => runCmCmd(ctx, redo),
    cursorUndo: ctx => runCmCmd(ctx, undoSelection),
    smartSelectExpand: ctx => runCmCmd(ctx, selectParentSyntax),
    smartSelectShrink: ctx => runCmCmd(ctx, simplifySelection),

    nextBuffer: () => {
      const buffers = deps.workspace.openBuffers
      if (buffers.length < 2) return
      const panel = activeEditorPanel()
      if (!panel) return
      const current = getActiveEditorFileUri(currentPanelTree(), panel)
      const idx = current ? buffers.indexOf(current) : -1
      const next = buffers[(idx + 1) % buffers.length]!
      deps.openFileInEditor(next, fileUriToPath(next), undefined, undefined, false)
    },
    prevBuffer: () => {
      const buffers = deps.workspace.openBuffers
      if (buffers.length < 2) return
      const panel = activeEditorPanel()
      if (!panel) return
      const current = getActiveEditorFileUri(currentPanelTree(), panel)
      const idx = current ? buffers.indexOf(current) : 0
      const prev = buffers[(idx - 1 + buffers.length) % buffers.length]!
      deps.openFileInEditor(prev, fileUriToPath(prev), undefined, undefined, false)
    },
    focusSidebar: () => {
      const tree = deps.cloneTree()
      for (const panel of getAllLeafPanels(tree)) {
        if (panelHasExplorerTab(tree, panel)) {
          deps.workspace.focusTabInPanel(tree, panel, EXPLORER_TAB_ID)
          deps.setFocusedPanel(panel)
          deps.commitTree(tree)
          deps.focusExplorer?.()
          return
        }
      }
      const { panelId } = openExplorerTab(deps.workspace, tree, currentFocusedPanel())
      deps.setFocusedPanel(panelId)
      deps.commitTree(tree)
      deps.focusExplorer?.()
    },
    focusEditorGroup: () => {
      const panel = activeEditorPanel()
      if (panel) {
        deps.setFocusedPanel(panel)
        requestAnimationFrame(() => getEditorView(panel)?.focus())
      }
    },
    lastEditorGroup: () => {
      const panelTree = currentPanelTree()
      const panels = getAllLeafPanels(panelTree).filter(p => panelTree.getView(p)?.kind === "tabs")
      if (panels.length > 0) deps.setFocusedPanel(panels[panels.length - 1]!)
    },
    splitEditorRight: () => {
      const tree = deps.cloneTree()
      const target = currentFocusedPanel() ?? deps.editorPanelRef.current
      if (!target) return
      const newPanel = tree.splitAtEdge(target, "right")
      const view = tree.getView(target)
      if (view?.kind === "tabs") {
        tree.setView(newPanel, view)
      }
      deps.setFocusedPanel(newPanel)
      deps.commitTree(tree)
    },
    toggleEditorLayout: () => {
      const tree = deps.cloneTree()
      const root = (tree as unknown as { root: { kind: string } }).root
      root.kind = root.kind === "row" ? "column" : "row"
      deps.commitTree(tree)
    },
    zoomIn: () => deps.setZoomLevel(1),
    zoomOut: () => deps.setZoomLevel(-1),
    toggleDevTools: () => {},
    toggleFullScreen: () => {
      if (document.fullscreenElement) document.exitFullscreen()
      else document.body.requestFullscreen()
    },
    quit: () => {},
    closeQuickOpen: () => {
      deps.setPaletteOpen(false)
      deps.setQuickOpenOpen(false)
      deps.setBufferListOpen(false)
      deps.setOpenFileOpen(false)
      deps.setGotoLineOpen(false)
      deps.setOutlineOpen(false)
    },

    quickOutline: async ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!view) return
      if (lspUnavailable(ctx)) return
      try {
        const symbols = await fetchDocumentOutline(view)
        deps.setOutlineSymbols(flattenOutline(symbols))
        deps.setOutlineOpen(true)
      } catch {
        ctx.ui.showMessage("Quick outline failed")
      }
    },
    formatDocument: ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!view) return
      if (lspUnavailable(ctx)) return
      if (!runFormatDocument(view)) ctx.ui.showMessage("Format not available for this file")
    },
    rename: ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!view) return
      if (lspUnavailable(ctx)) return
      if (!runRenameSymbol(view)) ctx.ui.showMessage("Rename not available for this symbol")
    },
    goToReferences: ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!view) return
      if (lspUnavailable(ctx)) return
      deps.pushJumpFromActiveEditor("references")
      if (!runFindReferences(view)) ctx.ui.showMessage("Find references not available")
    },
    triggerParameterHints: ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!view) return
      if (lspUnavailable(ctx)) return
      if (!runParameterHints(view)) ctx.ui.showMessage("Parameter hints not available")
    },
    goToDefinition: ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!view) return
      if (lspUnavailable(ctx)) return
      deps.pushJumpFromActiveEditor("definition")
      if (!runGoToDefinition(view)) ctx.ui.showMessage("Go to definition not available")
    },
    goToDeclaration: ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!view) return
      if (lspUnavailable(ctx)) return
      deps.pushJumpFromActiveEditor("definition")
      if (!runGoToDeclaration(view)) ctx.ui.showMessage("Go to declaration not available")
    },
    goToTypeDefinition: ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!view) return
      if (lspUnavailable(ctx)) return
      deps.pushJumpFromActiveEditor("definition")
      if (!runGoToTypeDefinition(view)) ctx.ui.showMessage("Go to type definition not available")
    },
    goToImplementation: ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!view) return
      if (lspUnavailable(ctx)) return
      deps.pushJumpFromActiveEditor("definition")
      if (!runGoToImplementation(view)) ctx.ui.showMessage("Go to implementation not available")
    },
    triggerSuggest: ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!view) {
        ctx.ui.showMessage("No active editor")
        return
      }
      if (!runTriggerSuggest(view)) {
        ctx.ui.showMessage(
          lspPluginForView(view)
            ? "Suggest not available at cursor"
            : "No suggestions available — is the language server connected?",
        )
      }
    },
    showHover: ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!view) return
      if (lspUnavailable(ctx)) return
      if (!runShowHover(view)) ctx.ui.showMessage("Hover not available")
    },
    quickFix: async ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!view) return
      if (lspUnavailable(ctx)) return
      const actions = await scheduleCodeActions(view, true)
      if (!actions.length) {
        ctx.ui.showMessage("No quick fixes available")
        return
      }
      if (actions.length === 1) {
        await applyCodeAction(view, actions[0]!)
        return
      }
      ctx.ui.showMessage(`Quick fixes: ${actions.map(a => a.title).join(", ")}`)
    },
    showContextMenu: ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!view) return
      const pos = view.state.selection.main.head
      const coords = view.coordsAtPos(pos)
      if (coords) showEditorContextMenuAt(coords.left, coords.bottom)
    },

    listFocusNext: () => deps.handlePanelNavigation("focusNext"),
    listFocusPrev: () => deps.handlePanelNavigation("focusPrev"),
    listFocusActivate: () => deps.handlePanelNavigation("activate"),
    listFocusPageUp: () => deps.handlePanelNavigation("focusPageUp"),
    listFocusPageDown: () => deps.handlePanelNavigation("focusPageDown"),
    listFocusFirst: () => deps.handlePanelNavigation("focusFirstItem"),
    listFocusLast: () => deps.handlePanelNavigation("focusLastItem"),
  }

  return named as JetCommands
}

export const APP_COMMAND_REGISTRY = [
  { id: "ui.showCommandPalette", fn: "palette", title: "Show Command Palette", category: "UI", aliases: ["commands", "palette", "help"] },
  { id: "workspace.quickOpen", fn: "quickOpen", title: "Quick Open File", category: "Workspace", aliases: ["files", "open quickly"] },
  { id: "workspace.bufferList", fn: "bufferList", title: "Buffer List", category: "Workspace", aliases: ["open buffers", "switch buffer"] },
  { id: "workspace.saveFile", fn: "save", title: "Save File", category: "Workspace", aliases: ["write"] },
  { id: "workspace.openFile", fn: "openFile", title: "Open File", category: "Workspace", aliases: ["browse file"] },
  { id: "workspace.openFolder", fn: "openFolder", title: "Open Folder", category: "Workspace", aliases: ["open workspace"] },
  { id: "workspace.cd", fn: "cd", title: "Change Directory", category: "Workspace", aliases: ["switch workspace"] },
  { id: "workspace.switchProject", fn: "switchProject", title: "Switch Project", category: "Workspace", aliases: ["projects", "project"] },
  { id: "workspace.refreshProjects", fn: "refreshProjects", title: "Refresh Projects", category: "Workspace" },
  { id: "workspace.newFile", fn: "newFile", title: "New File", category: "Workspace", aliases: ["untitled"] },
  { id: "workspace.closeBuffer", fn: "closeBuffer", title: "Close Buffer", category: "Workspace", aliases: ["close file"] },
  { id: "navigation.jumpBack", fn: "jumpBack", title: "Jump Back", category: "Navigation", aliases: ["back"] },
  { id: "navigation.jumpForward", fn: "jumpForward", title: "Jump Forward", category: "Navigation", aliases: ["forward"] },
  { id: "editor.find", fn: "find", title: "Find in Editor", category: "Editor" },
  { id: "editor.replace", fn: "replace", title: "Replace in Editor", category: "Editor" },
  { id: "editor.gotoLine", fn: "gotoLine", title: "Go to Line…", category: "Editor" },
  { id: "locationlist.show", fn: "locationList", title: "Show Location List", category: "View" },
  { id: "locationlist.showSearch", fn: "locationListSearch", title: "Location List: Search", category: "View" },
  { id: "locationlist.showProblems", fn: "locationListProblems", title: "Location List: Problems", category: "View" },
  { id: "output.show", fn: "output", title: "Show Output", category: "View" },
  { id: "task.run", fn: "runTask", title: "Run Task", category: "Tasks" },
  { id: "task.runBuild", fn: "runBuild", title: "Run Build Task", category: "Tasks" },
  { id: "explorer.show", fn: "explorer", title: "Show Explorer", category: "View", aliases: ["files tree", "sidebar"] },
  { id: "editor.toggleComment", fn: "toggleComment", title: "Toggle Comment", category: "Editor" },
  { id: "editor.copyLineDown", fn: "copyLineDown", title: "Copy Line Down", category: "Editor" },
  { id: "editor.moveLineDown", fn: "moveLineDown", title: "Move Line Down", category: "Editor" },
  { id: "editor.indentMore", fn: "indentMore", title: "Indent Line", category: "Editor" },
  { id: "editor.addCursorBelow", fn: "addCursorBelow", title: "Add Cursor Below", category: "Editor" },
  { id: "editor.nextEditor", fn: "nextBuffer", title: "Next Buffer", category: "Editor" },
  { id: "editor.previousEditor", fn: "prevBuffer", title: "Previous Buffer", category: "Editor" },
  { id: "view.splitEditor", fn: "splitEditorRight", title: "Split Editor Right", category: "View" },
  { id: "ui.zoomIn", fn: "zoomIn", title: "Zoom In", category: "UI", aliases: ["font larger"] },
  { id: "ui.zoomOut", fn: "zoomOut", title: "Zoom Out", category: "UI", aliases: ["font smaller"] },
  { id: "workbench.action.focusSideBar", fn: "focusSidebar", title: "Focus Sidebar", category: "View" },
  { id: "workbench.action.focusFirstEditorGroup", fn: "focusEditorGroup", title: "Focus Editor", category: "View" },
  { id: "editor.action.quickOutline", fn: "quickOutline", title: "Quick Outline", category: "Editor" },
  { id: "editor.action.formatDocument", fn: "formatDocument", title: "Format Document", category: "Editor" },
  { id: "editor.action.rename", fn: "rename", title: "Rename Symbol", category: "Editor" },
  { id: "editor.action.goToReferences", fn: "goToReferences", title: "Go to References", category: "Editor" },
  { id: "editor.action.revealDefinition", fn: "goToDefinition", title: "Go to Definition", category: "Editor" },
  { id: "list.focusDown", fn: "listFocusNext", title: "List Focus Down", category: "List" },
  { id: "list.open", fn: "listFocusActivate", title: "Open Focused List Item", category: "List" },
] as const
