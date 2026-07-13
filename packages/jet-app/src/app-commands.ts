import type { EditorView } from "@codemirror/view"
import type { TransactionSpec } from "@codemirror/state"
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
import type { PanelId, Edge } from "@jet/shared"
import { basename, fileUriToPath, isUntitledUri, pathToFileUri } from "@jet/shared"
import type {
  JetCommandContext,
  JetCommands,
  JetCommandFn,
  ListItem,
  WorkspaceFolder,
  WorkspaceFolderPicker,
  WorkspaceService,
} from "@jet/workspace"
import { folderForFileUri, resolveWorkspaceFolder } from "@jet/workspace"
import { PROBLEMS_TAB_ID, panelTabIds } from "@jet/workspace"
import { problemsToListItems } from "@jet/ui"
import { openJetSearch } from "@jet/codemirror"
import {
  fetchDocumentOutline,
  requestFindReferences,
  runFormatDocument,
  runParameterHints,
  runRenameSymbol,
  requestGoToDefinition,
  runGoToDeclaration,
  runGoToTypeDefinition,
  runGoToImplementation,
  runTriggerSuggest,
  runShowHover,
  lspPluginForView,
  skipNextOccurrence,
  symbolTextAt,
  type OutlineSymbol,
} from "@jet/codemirror"
import { scheduleCodeActions, applyCodeAction } from "@jet/lsp"
import type { OutlineEntry } from "@jet/ui"
import { getEditorView, showEditorContextMenuAt, destroyEditorBuffer, lspLocationsToListItems } from "@jet/ui"
import {
  getActiveEditorFileUri,
  getAllLeafPanels,
  resolveEditorPanel,
  resolveTargetPanel,
  closePanelIfEmpty,
} from "./panel-routing.js"
import { resolveFolderForActiveTab } from "./resolve-tab-workspace.js"
import {
  openAgentExplorerTab,
  openOutputTab,
  openProblemsTab,
  openSearchTab,
  openTabInAuxiliaryPanel,
  openTerminalTab,
  listTerminalTabs,
  isActiveTerminalTab,
} from "./tab-routing.js"
import { confirmCloseBuffer } from "./close-buffer.js"
import type { JetSidebarView } from "@jet/ui"
import {
  anyOverlayOpen,
  bind,
  type JetKeyBinding,
  type KeymapContext,
} from "@jet/workspace"
import { terminalAtIndex } from "./terminal-explorer.js"

export type BuildAppCommandsDeps = {
  workspace: WorkspaceService
  getPanelTree: () => JetPanelTree
  getFocusedPanel: () => PanelId | null
  setPaletteOpen: (open: boolean) => void
  setQuickOpenOpen: (open: boolean) => void
  setBufferListOpen: (open: boolean) => void
  setTerminalListOpen: (open: boolean) => void
  setOpenFileOpen: (open: boolean) => void
  setCdOpen: (open: boolean) => void
  setAddWorkspaceOpen: (open: boolean) => void
  setProjectSwitcherOpen: (open: boolean) => void
  setSwitchFolderOpen: (open: boolean) => void
  pickWorkspaceFolder: WorkspaceFolderPicker
  setGotoLineOpen: (open: boolean) => void
  setMessage: (msg: string) => void
  setFocusedPanel: (panel: PanelId) => void
  cloneTree: () => JetPanelTree
  commitTree: (tree: JetPanelTree, preferFocus?: PanelId | null) => void
  openWorkspaceFolder: (path: string, opts?: { replace?: boolean }) => void | Promise<void>
  addWorkspaceFolder: (path: string) => void
  removeWorkspaceFolder: (folderId: string) => Promise<boolean>
  setActiveWorkspaceFolder: (folderId: string) => void
  handlePanelEvent: (event: PanelEvent) => void
  openFileInEditor: (uri: string, path: string, line?: number, column?: number, pushJump?: boolean) => void
  openListItem: (item: ListItem) => void
  syncProblemsToListTab: () => void
  editorPanelRef: { current: PanelId | null }
  setZoomLevel: (delta: number) => void
  handlePanelNavigation: (action: string) => void
  setOutlineOpen: (open: boolean) => void
  setOutlineSymbols: (symbols: OutlineEntry[]) => void
  pushJumpFromActiveEditor: (label?: string) => void
  projectRegistry: import("@jet/workspace").ProjectRegistry
  refreshProjects: () => Promise<number>
  focusExplorer?: () => void
  focusTerminalExplorer?: () => void
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  setSidebarView: (view: JetSidebarView) => void
  getSidebarView: () => JetSidebarView
  openAgentExplorer: () => Promise<void>
  openTerminalExplorer: () => void
  createAgentThread: (rootUri: string, rootPath: string) => Promise<void>
  archiveActiveAgentThread: () => Promise<void>
  unarchiveActiveAgentThread: () => Promise<void>
  getSearchSupported: () => boolean
  getContextFolder: () => WorkspaceFolder | null
  getActiveTerminalTabId: () => string | null
  closeTerminalTab: (panelId: PanelId, tabId: string) => void
  getTerminalExplorerGroups: () => import("./terminal-explorer.js").TerminalExplorerGroup[]
  focusTerminalTab: (panelId: PanelId, tabId: string) => void
}

export function buildAppCommands(deps: BuildAppCommandsDeps): JetCommands {
  const currentPanelTree = () => deps.getPanelTree()
  const currentFocusedPanel = () => deps.getFocusedPanel()

  const splitPanelAtEdge = (edge: Edge) => {
    const tree = deps.cloneTree()
    const target = currentFocusedPanel() ?? deps.editorPanelRef.current
    if (!target) return
    const newPanel = tree.splitAtEdge(target, edge)
    deps.setFocusedPanel(newPanel)
    deps.commitTree(tree, newPanel)
  }

  const openFolder: JetCommandFn = async () => {
    deps.setCdOpen(true)
  }

  const addFolder: JetCommandFn = async () => {
    deps.setAddWorkspaceOpen(true)
  }

  const removeFolder: JetCommandFn = async () => {
    const active = deps.workspace.manager.activeFolder
    if (!active) {
      deps.setMessage("No workspace folder to remove")
      return
    }
    const ok = await deps.removeWorkspaceFolder(active.id)
    if (!ok) return
  }

  const focusFolder: JetCommandFn = async ctx => {
    const folders = deps.workspace.manager.folders
    if (folders.length < 2) {
      ctx.ui.showMessage("Only one workspace folder open")
      return
    }
    const activeIdx = folders.findIndex(f => f.id === deps.workspace.manager.activeFolder?.id)
    const next = folders[(activeIdx + 1) % folders.length]!
    deps.setActiveWorkspaceFolder(next.id)
    ctx.ui.showMessage(`Active folder: ${next.root.name}`)
  }

  const switchFolder: JetCommandFn = async () => {
    deps.setSwitchFolderOpen(true)
  }

  async function resolveCommandFolder(
    preferredFileUri?: string | null,
  ): Promise<WorkspaceFolder | null> {
    const preferred = preferredFileUri
      ? folderForFileUri(deps.workspace, preferredFileUri)?.id
      : undefined
    return resolveWorkspaceFolder(deps.workspace, deps.pickWorkspaceFolder, {
      preferredFolderId: preferred,
    })
  }

  function terminalCwdRootUri(): string | undefined {
    const folder = resolveFolderForActiveTab(
      currentPanelTree(),
      currentFocusedPanel(),
      deps.workspace.tabRegistry,
      deps.workspace,
    )
    return folder?.root.uri ?? deps.workspace.manager.activeFolder?.root.uri
  }

  async function resolveTerminalCwdRootUri(): Promise<string | undefined> {
    // Terminal commands are scoped to the active project runtime. A multi-project
    // terminal multiplexer must not interrupt a command with a folder picker or
    // accidentally create the PTY under another project's panel tree.
    return terminalCwdRootUri()
  }

  function runCmCmd(ctx: JetCommandContext, fn: (v: EditorView) => boolean): void {
    const view = ctx.getActiveEditorView()
    if (view) fn(view)
  }

  /** @codemirror/search commands destructure `{ state, dispatch }` — pass bound dispatch. */
  function runCmStateCmd(
    ctx: JetCommandContext,
    fn: (target: { state: EditorView["state"]; dispatch: (tr: TransactionSpec) => void }) => boolean,
  ): void {
    const view = ctx.getActiveEditorView()
    if (view) {
      fn({
        state: view.state,
        dispatch: spec => {
          view.dispatch(spec)
        },
      })
    }
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

  async function gitSearchUnavailable(ctx: JetCommandContext): Promise<boolean> {
    const folder = deps.getContextFolder()
    if (!folder) {
      ctx.ui.showMessage("Quick open and project search require an open workspace")
      return true
    }
    if (deps.getSearchSupported()) return false
    try {
      if (await window.jet?.search?.isSupported?.(folder.root.uri)) return false
    } catch {
      // Fall through to the same user-facing unavailable state as browser mode.
    }
    ctx.ui.showMessage("Quick open and project search require a git repository")
    return true
  }

  function activeEditorPanel(): PanelId | null {
    return resolveEditorPanel(
      currentPanelTree(),
      deps.editorPanelRef.current,
      currentFocusedPanel(),
    )
  }

  function sameFileUri(a: string, b: string): boolean {
    return fileUriToPath(a) === fileUriToPath(b)
  }

  function listEditorTabIds(panel: PanelId): string[] {
    const view = currentPanelTree().getView(panel)
    if (view?.kind !== "tabs") return []
    return panelTabIds(view).filter(id => id.startsWith("file:") || id.startsWith("untitled:"))
  }

  function cycleEditorBuffer(delta: 1 | -1): void {
    const panel = activeEditorPanel()
    if (!panel) return
    const tabs = listEditorTabIds(panel)
    if (tabs.length < 2) return
    const current = getActiveEditorFileUri(currentPanelTree(), panel)
    let idx = current != null ? tabs.findIndex(t => sameFileUri(t, current)) : -1
    if (idx < 0) idx = 0
    const target = tabs[(idx + delta + tabs.length) % tabs.length]!
    deps.workspace.touchBuffer(target)
    deps.handlePanelEvent({ type: "tabActivate", panelId: panel, tabId: target })
  }

  function syncOpenBuffersFromPanels(): void {
    const tree = currentPanelTree()
    const uris: string[] = []
    for (const panel of getAllLeafPanels(tree)) {
      const view = tree.getView(panel)
      if (view?.kind !== "tabs") continue
      for (const id of panelTabIds(view)) {
        if (!id.startsWith("file:") && !id.startsWith("untitled:")) continue
        if (!uris.some(u => sameFileUri(u, id))) uris.push(id)
      }
    }
    for (let i = uris.length - 1; i >= 0; i--) {
      deps.workspace.touchBuffer(uris[i]!)
    }
  }

  const showProjectSearch: JetCommandFn = async ctx => {
    if (await gitSearchUnavailable(ctx)) return
    deps.syncProblemsToListTab()
    const tree = deps.cloneTree()
    const { panelId } = openSearchTab(deps.workspace, tree, currentFocusedPanel())
    deps.commitTree(tree, panelId)
  }

  function activeTerminalTab(): { panelId: PanelId; tabId: string } | null {
    const tabId = deps.getActiveTerminalTabId()
    if (!tabId) return null
    const panel = currentFocusedPanel()
    if (!panel) return null
    return { panelId: panel, tabId }
  }

  const closeTab: JetCommandFn = async () => {
    const terminal = activeTerminalTab()
    if (terminal) {
      deps.closeTerminalTab(terminal.panelId, terminal.tabId)
      return
    }
    const panel = activeEditorPanel()
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
  }

  const named: JetCommands = {
    palette: () => deps.setPaletteOpen(true),
    quickOpen: async ctx => {
      if (await gitSearchUnavailable(ctx)) return
      deps.setQuickOpenOpen(true)
    },
    bufferList: () => {
      syncOpenBuffersFromPanels()
      deps.setBufferListOpen(true)
    },
    terminalList: () => deps.setTerminalListOpen(true),
    openFile: () => {
      deps.setOpenFileOpen(true)
    },
    openFolder,
    addFolder,
    removeFolder,
    focusFolder,
    switchFolder,
    cd: () => deps.setCdOpen(true),
    switchProject: () => deps.setProjectSwitcherOpen(true),
    refreshProjects: async ctx => {
      const count = await deps.refreshProjects()
      ctx.ui.showMessage(count === 0 ? "No git projects found" : `Found ${count} projects`)
    },
    save: async ctx => {
      const view = ctx.getActiveEditorView()
      if (!view) return
      const panel = currentFocusedPanel()
      const fileUri = panel && getActiveEditorFileUri(currentPanelTree(), panel)
      if (!fileUri) return
      const content = view.state.doc.toString()
      if (isUntitledUri(fileUri)) {
        const folder = await resolveCommandFolder(fileUri)
        if (!folder) return
        const savePath = (await window.jet?.fs.showSaveFileDialog()) ?? null
        if (!savePath) return
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
      deps.commitTree(tree, panel)
      requestAnimationFrame(() => getEditorView(panel)?.focus())
    },
    closeBuffer: closeTab,
    closeTab,
    find: ctx => {
      const view = ctx.getActiveEditorView()
      const panel = currentFocusedPanel()
      if (view) openJetSearch(view, "find", panel?.id)
    },
    replace: ctx => {
      const view = ctx.getActiveEditorView()
      const panel = currentFocusedPanel()
      if (view) openJetSearch(view, "replace", panel?.id)
    },
    gotoLine: () => deps.setGotoLineOpen(true),
    search: showProjectSearch,
    locationList: async ctx => {
      if (await gitSearchUnavailable(ctx)) return
      const tree = deps.cloneTree()
      const { panelId } = openSearchTab(deps.workspace, tree, currentFocusedPanel())
      deps.commitTree(tree, panelId)
    },
    locationListSearch: showProjectSearch,
    locationListProblems: () => {
      deps.syncProblemsToListTab()
      const tree = deps.cloneTree()
      const { panelId } = openProblemsTab(deps.workspace, tree, currentFocusedPanel())
      deps.commitTree(tree, panelId)
    },
    output: () => {
      const tree = deps.cloneTree()
      const target = resolveTargetPanel(tree, currentFocusedPanel()) ?? deps.editorPanelRef.current
      if (!target) return
      const { panelId } = openOutputTab(deps.workspace, tree, target)
      deps.commitTree(tree, panelId)
    },
    terminal: async () => {
      const tree = deps.cloneTree()
      const focused = currentFocusedPanel()

      if (isActiveTerminalTab(tree, focused)) {
        const editorPanel = resolveEditorPanel(tree, deps.editorPanelRef.current, focused)
        if (editorPanel) {
          const view = tree.getView(editorPanel)
          if (view?.kind === "tabs") {
            const editorTabId =
              getActiveEditorFileUri(tree, editorPanel) ??
              panelTabIds(view).find(id => id.startsWith("file:") || id.startsWith("untitled:"))
            if (editorTabId) {
              deps.workspace.focusTabInPanel(tree, editorPanel, editorTabId)
            }
          }
          deps.setFocusedPanel(editorPanel)
          deps.commitTree(tree, editorPanel)
        }
        return
      }

      const terminals = listTerminalTabs(tree)
      if (terminals.length > 0) {
        const last = terminals[terminals.length - 1]!
        deps.workspace.focusTabInPanel(tree, last.panelId, last.tabId)
        deps.setFocusedPanel(last.panelId)
        deps.commitTree(tree, last.panelId)
        return
      }

      const cwdRootUri = await resolveTerminalCwdRootUri()
      const { panelId } = openTerminalTab(deps.workspace, tree, focused, {
        cwdRootUri,
      })
      deps.setFocusedPanel(panelId)
      deps.commitTree(tree, panelId)
    },
    terminalNew: async () => {
      const tree = deps.cloneTree()
      const count = listTerminalTabs(tree).length
      const label = count === 0 ? "Terminal" : `Terminal ${count + 1}`
      const cwdRootUri = await resolveTerminalCwdRootUri()
      const { panelId } = openTerminalTab(deps.workspace, tree, currentFocusedPanel(), {
        label,
        cwdRootUri,
      })
      deps.setFocusedPanel(panelId)
      deps.commitTree(tree, panelId)
    },
    explorer: () => {
      deps.setSidebarOpen(true)
      deps.setSidebarView("explorer")
      deps.focusExplorer?.()
    },
    toggleSidebar: () => {
      deps.toggleSidebar()
    },
    agents: async ctx => {
      if (!deps.workspace.manager.hasFolders()) {
        await openFolder(ctx)
        return
      }
      await deps.openAgentExplorer()
    },
    newAgent: async ctx => {
      const folder = deps.workspace.manager.activeFolder
      if (!folder) {
        await openFolder(ctx)
        return
      }
      await deps.openAgentExplorer()
      await deps.createAgentThread(folder.root.uri, folder.root.path)
    },
    terminalExplorer: () => {
      if (!deps.workspace.manager.hasFolders()) {
        deps.setMessage("Open a workspace folder first")
        return
      }
      deps.openTerminalExplorer()
    },
    archiveAgent: async () => {
      await deps.archiveActiveAgentThread()
    },
    unarchiveAgent: async () => {
      await deps.unarchiveActiveAgentThread()
    },
    jumpBack: ctx => {
      const panel = currentFocusedPanel()
      const fileUri = panel && getActiveEditorFileUri(currentPanelTree(), panel)
      const view = ctx.getActiveEditorView()
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
      const view = ctx.getActiveEditorView()
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
      const folder = await resolveCommandFolder()
      if (!folder) return
      void deps.workspace.taskRunner.runTask(
        task,
        folder.root.path,
        folder.root.path,
        { folderId: folder.id, folderName: folder.root.name },
      )
      const tree = deps.cloneTree()
      const target = resolveTargetPanel(tree, currentFocusedPanel()) ?? deps.editorPanelRef.current
      if (target) {
        const { panelId } = openOutputTab(deps.workspace, tree, target)
        deps.commitTree(tree, panelId)
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
        deps.commitTree(errTree, panelId)
      }
    },
    runBuild: async ctx => {
      const build = deps.workspace.taskRunner.tasks.find(t => t.group === "build") ?? deps.workspace.taskRunner.tasks[0]
      if (!build) {
        ctx.ui.showMessage("No build task configured")
        return
      }
      const folder = await resolveCommandFolder()
      if (!folder) return
      void deps.workspace.taskRunner.runTask(
        build,
        folder.root.path,
        folder.root.path,
        { folderId: folder.id, folderName: folder.root.name },
      )
      const tree = deps.cloneTree()
      const target = resolveTargetPanel(tree, currentFocusedPanel()) ?? deps.editorPanelRef.current
      if (target) {
        const { panelId } = openOutputTab(deps.workspace, tree, target)
        deps.commitTree(tree, panelId)
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
    selectNextOccurrence: ctx => runCmStateCmd(ctx, selectNextOccurrence),
    selectAllOccurrences: ctx => runCmStateCmd(ctx, selectSelectionMatches),
    skipNextOccurrence: ctx => runCmCmd(ctx, skipNextOccurrence),
    undo: ctx => runCmCmd(ctx, undo),
    redo: ctx => runCmCmd(ctx, redo),
    cursorUndo: ctx => runCmCmd(ctx, undoSelection),
    smartSelectExpand: ctx => runCmCmd(ctx, selectParentSyntax),
    smartSelectShrink: ctx => runCmCmd(ctx, simplifySelection),

    nextBuffer: () => cycleEditorBuffer(1),
    prevBuffer: () => cycleEditorBuffer(-1),
    focusSidebar: () => {
      deps.setSidebarOpen(true)
      requestAnimationFrame(() => {
        if (deps.getSidebarView() === "terminal-explorer") {
          deps.focusTerminalExplorer?.()
        } else {
          deps.focusExplorer?.()
        }
      })
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
    splitEditorRight: () => splitPanelAtEdge("right"),
    splitEditorBottom: () => splitPanelAtEdge("bottom"),
    toggleEditorLayout: () => {
      const tree = deps.cloneTree()
      tree.toggleRootOrientation()
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
      const view = ctx.getActiveEditorView()
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
      const view = ctx.getActiveEditorView()
      if (!view) return
      if (lspUnavailable(ctx)) return
      if (!runFormatDocument(view)) ctx.ui.showMessage("Format not available for this file")
    },
    rename: ctx => {
      const view = ctx.getActiveEditorView()
      if (!view) return
      if (lspUnavailable(ctx)) return
      if (!runRenameSymbol(view)) ctx.ui.showMessage("Rename not available for this symbol")
    },
    goToReferences: async ctx => {
      const view = ctx.getActiveEditorView()
      if (!view) return
      if (lspUnavailable(ctx)) return
      deps.pushJumpFromActiveEditor("references")
      const locs = await requestFindReferences(view)
      if (!locs.length) {
        ctx.ui.showMessage("No references found")
        return
      }
      const symbol = symbolTextAt(view.state, view.state.selection.main.head) ?? "symbol"
      const items = lspLocationsToListItems(locs, symbol)
      const doc = deps.workspace.createReferencesList(`References: ${symbol}`, items)
      const tree = deps.cloneTree()
      const { panelId } = openTabInAuxiliaryPanel(deps.workspace, tree, currentFocusedPanel(), doc)
      deps.commitTree(tree, panelId)
    },
    triggerParameterHints: ctx => {
      const view = ctx.getActiveEditorView()
      if (!view) return
      if (lspUnavailable(ctx)) return
      if (!runParameterHints(view)) ctx.ui.showMessage("Parameter hints not available")
    },
    goToDefinition: async ctx => {
      const view = ctx.getActiveEditorView()
      if (!view) return
      if (lspUnavailable(ctx)) return
      deps.pushJumpFromActiveEditor("definition")
      const locs = await requestGoToDefinition(view)
      if (!locs.length) {
        ctx.ui.showMessage("No definition found")
        return
      }
      if (locs.length === 1) {
        const loc = locs[0]!
        deps.openFileInEditor(
          loc.uri,
          fileUriToPath(loc.uri),
          loc.range.start.line + 1,
          loc.range.start.character + 1,
          false,
        )
        return
      }
      const symbol = symbolTextAt(view.state, view.state.selection.main.head) ?? "symbol"
      const items = lspLocationsToListItems(locs, symbol)
      const doc = deps.workspace.createDefinitionsList(`Definitions: ${symbol}`, items)
      const tree = deps.cloneTree()
      const { panelId } = openTabInAuxiliaryPanel(deps.workspace, tree, currentFocusedPanel(), doc)
      deps.commitTree(tree, panelId)
    },
    goToDeclaration: ctx => {
      const view = ctx.getActiveEditorView()
      if (!view) return
      if (lspUnavailable(ctx)) return
      deps.pushJumpFromActiveEditor("definition")
      if (!runGoToDeclaration(view)) ctx.ui.showMessage("Go to declaration not available")
    },
    goToTypeDefinition: ctx => {
      const view = ctx.getActiveEditorView()
      if (!view) return
      if (lspUnavailable(ctx)) return
      deps.pushJumpFromActiveEditor("definition")
      if (!runGoToTypeDefinition(view)) ctx.ui.showMessage("Go to type definition not available")
    },
    goToImplementation: ctx => {
      const view = ctx.getActiveEditorView()
      if (!view) return
      if (lspUnavailable(ctx)) return
      deps.pushJumpFromActiveEditor("definition")
      if (!runGoToImplementation(view)) ctx.ui.showMessage("Go to implementation not available")
    },
    triggerSuggest: ctx => {
      const view = ctx.getActiveEditorView()
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
      const view = ctx.getActiveEditorView()
      if (!view) return
      if (lspUnavailable(ctx)) return
      if (!runShowHover(view)) ctx.ui.showMessage("Hover not available")
    },
    quickFix: async ctx => {
      const view = ctx.getActiveEditorView()
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
      const view = ctx.getActiveEditorView()
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

export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}

/** macOS: Cmd+1..9 → Nth terminal in active workspace; Ctrl+1..9 → Nth workspace + its first terminal. */
export function buildMacTerminalQuickSwitchBindings(opts: {
  workspace: WorkspaceService
  getTerminalExplorerGroups: () => import("./terminal-explorer.js").TerminalExplorerGroup[]
  focusTerminalTab: (panelId: PanelId, tabId: string) => void
  setMessage: (msg: string) => void
}): JetKeyBinding[] {
  if (!isMacPlatform()) return []

  const when = (ctx: KeymapContext) => ctx.workspaceOpen && !anyOverlayOpen(ctx)

  const focusActiveWorkspaceTerminal = (index: number): JetCommandFn => () => {
    const rootUri = opts.workspace.root?.uri
    if (!rootUri) return
    const entry = terminalAtIndex(opts.getTerminalExplorerGroups(), rootUri, index)
    if (!entry) {
      opts.setMessage(`No terminal ${index} in this workspace`)
      return
    }
    opts.focusTerminalTab(entry.panelId, entry.tabId)
  }

  const focusWorkspaceFolderTerminal = (index: number): JetCommandFn => () => {
    const folder = opts.workspace.folders[index - 1]
    if (!folder) {
      opts.setMessage(`No workspace ${index}`)
      return
    }
    const focusFirstTerminal = () => {
      const entry = terminalAtIndex(opts.getTerminalExplorerGroups(), folder.root.uri, 1)
      if (entry) opts.focusTerminalTab(entry.panelId, entry.tabId)
    }
    if (folder.root.uri !== opts.workspace.root?.uri) {
      opts.workspace.setActiveFolder(folder.id)
      requestAnimationFrame(() => requestAnimationFrame(focusFirstTerminal))
    } else {
      focusFirstTerminal()
    }
  }

  const bindings: JetKeyBinding[] = []
  for (let index = 1; index <= 9; index++) {
    bindings.push(bind(`Cmd-${index}`, focusActiveWorkspaceTerminal(index), when))
    bindings.push(bind(`Ctrl-${index}`, focusWorkspaceFolderTerminal(index), when))
  }
  return bindings
}

export const APP_COMMAND_REGISTRY = [
  { id: "ui.showCommandPalette", fn: "palette", title: "Show Command Palette", category: "UI", aliases: ["commands", "palette", "help"] },
  { id: "workspace.quickOpen", fn: "quickOpen", title: "Quick Open File", category: "Workspace", aliases: ["files", "open quickly"] },
  { id: "workspace.bufferList", fn: "bufferList", title: "Buffer List", category: "Workspace", aliases: ["open buffers", "switch buffer"] },
  { id: "terminal.list", fn: "terminalList", title: "Terminal List", category: "View", aliases: ["switch terminal", "terminal lister"] },
  { id: "workspace.saveFile", fn: "save", title: "Save File", category: "Workspace", aliases: ["write"] },
  { id: "workspace.openFile", fn: "openFile", title: "Open File", category: "Workspace", aliases: ["browse file"] },
  { id: "workspace.openFolder", fn: "openFolder", title: "Open Folder", category: "Workspace", aliases: ["open workspace"] },
  { id: "workspace.addFolder", fn: "addFolder", title: "Add Folder to Workspace", category: "Workspace", aliases: ["add root", "multi-root"] },
  { id: "workspace.removeFolder", fn: "removeFolder", title: "Remove Folder from Workspace", category: "Workspace", aliases: ["close folder root"] },
  { id: "workspace.focusFolder", fn: "focusFolder", title: "Focus Next Workspace Folder", category: "Workspace", aliases: ["switch root"] },
  { id: "workspace.switchFolder", fn: "switchFolder", title: "Switch Workspace Folder…", category: "Workspace", aliases: ["pick root", "active folder"] },
  { id: "workspace.cd", fn: "cd", title: "Change Directory", category: "Workspace", aliases: ["switch workspace"] },
  { id: "workspace.switchProject", fn: "switchProject", title: "Switch Project", category: "Workspace", aliases: ["projects", "project"] },
  { id: "workspace.refreshProjects", fn: "refreshProjects", title: "Refresh Projects", category: "Workspace" },
  { id: "workspace.newFile", fn: "newFile", title: "New File", category: "Workspace", aliases: ["untitled"] },
  { id: "workspace.closeBuffer", fn: "closeBuffer", title: "Close Buffer", category: "Workspace", aliases: ["close file"] },
  { id: "layout.closeTab", fn: "closeTab", title: "Close Tab", category: "Layout", aliases: ["close"] },
  { id: "navigation.jumpBack", fn: "jumpBack", title: "Jump Back", category: "Navigation", aliases: ["back"] },
  { id: "navigation.jumpForward", fn: "jumpForward", title: "Jump Forward", category: "Navigation", aliases: ["forward"] },
  { id: "editor.find", fn: "find", title: "Find in Editor", category: "Editor" },
  { id: "editor.replace", fn: "replace", title: "Replace in Editor", category: "Editor" },
  { id: "editor.gotoLine", fn: "gotoLine", title: "Go to Line…", category: "Editor" },
  { id: "locationlist.show", fn: "locationList", title: "Show Location List", category: "View" },
  { id: "search.show", fn: "search", title: "Show Search", category: "View", aliases: ["project search", "find in files"] },
  { id: "locationlist.showSearch", fn: "locationListSearch", title: "Location List: Search", category: "View" },
  { id: "locationlist.showProblems", fn: "locationListProblems", title: "Location List: Problems", category: "View" },
  { id: "output.show", fn: "output", title: "Show Output", category: "View" },
  { id: "terminal.show", fn: "terminal", title: "Toggle Terminal", category: "View", aliases: ["shell", "integrated terminal"] },
  { id: "terminal.new", fn: "terminalNew", title: "New Terminal", category: "View" },
  { id: "terminal.explorer.show", fn: "terminalExplorer", title: "Show Terminal Explorer", category: "View", aliases: ["terminals", "terminal list"] },
  { id: "task.run", fn: "runTask", title: "Run Task", category: "Tasks" },
  { id: "task.runBuild", fn: "runBuild", title: "Run Build Task", category: "Tasks" },
  { id: "explorer.show", fn: "explorer", title: "Show Explorer", category: "View", aliases: ["files tree", "sidebar"] },
  { id: "workbench.action.toggleSidebarVisibility", fn: "toggleSidebar", title: "Toggle Sidebar", category: "View", aliases: ["hide sidebar", "show sidebar", "cmd b"] },
  { id: "agents.show", fn: "agents", title: "Show Agents", category: "View", aliases: ["agent explorer", "chat sidebar"] },
  { id: "agent.new", fn: "newAgent", title: "New Agent", category: "Agents", aliases: ["new chat", "new assistant"] },
  { id: "agent.archive", fn: "archiveAgent", title: "Archive Agent", category: "Agents", aliases: ["archive chat"] },
  { id: "agent.unarchive", fn: "unarchiveAgent", title: "Unarchive Agent", category: "Agents", aliases: ["unarchive chat"] },
  { id: "editor.toggleComment", fn: "toggleComment", title: "Toggle Comment", category: "Editor" },
  { id: "editor.copyLineDown", fn: "copyLineDown", title: "Copy Line Down", category: "Editor" },
  { id: "editor.moveLineDown", fn: "moveLineDown", title: "Move Line Down", category: "Editor" },
  { id: "editor.indentMore", fn: "indentMore", title: "Indent Line", category: "Editor" },
  { id: "editor.addCursorBelow", fn: "addCursorBelow", title: "Add Cursor Below", category: "Editor" },
  { id: "editor.selectNextOccurrence", fn: "selectNextOccurrence", title: "Select Next Occurrence", category: "Editor" },
  { id: "editor.selectAllOccurrences", fn: "selectAllOccurrences", title: "Select All Occurrences", category: "Editor" },
  { id: "editor.skipNextOccurrence", fn: "skipNextOccurrence", title: "Skip Next Occurrence", category: "Editor" },
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
  { id: "editor.action.triggerParameterHints", fn: "triggerParameterHints", title: "Trigger Parameter Hints", category: "Editor", aliases: ["signature help", "parameter hints"] },
  { id: "list.focusDown", fn: "listFocusNext", title: "List Focus Down", category: "List" },
  { id: "list.focusUp", fn: "listFocusPrev", title: "List Focus Up", category: "List" },
  { id: "list.open", fn: "listFocusActivate", title: "Open Focused List Item", category: "List" },
] as const
