import type { EditorView } from "@codemirror/view"
import type { TransactionSpec } from "@codemirror/state"
import {
  toggleComment,
  copyLineDown,
  moveLineDown,
  indentMore,
  undo,
  redo,
  addCursorBelow,
} from "@codemirror/commands"
import { selectNextOccurrence, selectSelectionMatches } from "@codemirror/search"
import type { GharargahPanelTree } from "@gharargah/workspace"
import type { PanelEvent } from "@gharargah/panels"
import type { PanelId } from "@gharargah/shared"
import { basename, fileUriToPath, isUntitledUri, pathToFileUri } from "@gharargah/shared"
import type {
  JetCommandContext,
  JetCommands,
  JetCommandFn,
  WorkspaceFolderPicker,
  WorkspaceService,
} from "@gharargah/workspace"
import { panelTabIds } from "@gharargah/workspace"
import { openJetSearch } from "@gharargah/codemirror"
import {
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
  skipNextOccurrence,
} from "@gharargah/codemirror"
import { getEditorView, destroyEditorBuffer } from "@gharargah/ui"
import {
  getActiveEditorFileUri,
  getAllLeafPanels,
  resolveEditorPanel,
  closePanelIfEmpty,
} from "./panel-routing.js"
import { resolveFolderForActiveTab } from "./resolve-tab-workspace.js"
import {
  openTerminalTab,
  listTerminalTabs,
  isActiveTerminalTab,
} from "./tab-routing.js"
import { confirmCloseBuffer } from "./close-buffer.js"
import {
  anyOverlayOpen,
  bind,
  type JetKeyBinding,
  type KeymapContext,
} from "@gharargah/workspace"
import { terminalAtIndex } from "./terminal-explorer.js"

export type BuildAppCommandsDeps = {
  workspace: WorkspaceService
  getPanelTree: () => GharargahPanelTree
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
  cloneTree: () => GharargahPanelTree
  commitTree: (tree: GharargahPanelTree, preferFocus?: PanelId | null) => void
  openWorkspaceFolder: (path: string, opts?: { replace?: boolean }) => void | Promise<void>
  addWorkspaceFolder: (path: string) => void
  removeWorkspaceFolder: (folderId: string) => Promise<boolean>
  setActiveWorkspaceFolder: (folderId: string) => void
  handlePanelEvent: (event: PanelEvent) => void
  openFileInEditor: (uri: string, path: string, line?: number, column?: number) => void
  editorPanelRef: { current: PanelId | null }
  setZoomLevel: (delta: number) => void
  projectRegistry: import("@gharargah/workspace").ProjectRegistry
  refreshProjects: () => Promise<number>
  getActiveTerminalTabId: () => string | null
  closeTerminalTab: (panelId: PanelId, tabId: string) => void
  getTerminalExplorerGroups: () => import("./terminal-explorer.js").TerminalExplorerGroup[]
  focusTerminalTab: (panelId: PanelId, tabId: string) => void
  openTerminalModal: (panelId: PanelId, tabId: string) => void
  setSessionMode: (mode: "editor" | "terminal") => void
  getContextFolder: () => import("@gharargah/workspace").WorkspaceFolder | null
  getSearchSupported: () => boolean
  goHome: () => void
}

export function buildAppCommands(deps: BuildAppCommandsDeps): JetCommands {
  const currentPanelTree = () => deps.getPanelTree()
  const currentFocusedPanel = () => deps.getFocusedPanel()

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
    await deps.removeWorkspaceFolder(active.id)
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

  function terminalCwdRootUri(): string | undefined {
    const folder = resolveFolderForActiveTab(
      currentPanelTree(),
      currentFocusedPanel(),
      deps.workspace.tabRegistry,
      deps.workspace,
    )
    return (
      folder?.root.uri ??
      deps.workspace.manager.activeFolder?.root.uri ??
      deps.workspace.folders[0]?.root.uri
    )
  }

  async function resolveTerminalCwdRootUri(): Promise<string | undefined> {
    return terminalCwdRootUri()
  }

  function runCmCmd(ctx: JetCommandContext, fn: (v: EditorView) => boolean): void {
    const view = ctx.getActiveEditorView()
    if (view) fn(view)
  }

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

  async function gitSearchUnavailable(ctx: JetCommandContext): Promise<boolean> {
    const folder = deps.getContextFolder()
    if (!folder) {
      ctx.ui.showMessage("Quick open requires an open workspace")
      return true
    }
    if (deps.getSearchSupported()) return false
    try {
      if (await window.gharargah?.search?.isSupported?.(folder.root.uri)) return false
    } catch {
      /* fall through */
    }
    ctx.ui.showMessage("Quick open requires a git repository")
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
      deps.setSessionMode("editor")
      deps.setQuickOpenOpen(true)
    },
    bufferList: () => {
      syncOpenBuffersFromPanels()
      deps.setSessionMode("editor")
      deps.setBufferListOpen(true)
    },
    terminalList: () => deps.setTerminalListOpen(true),
    openFile: () => {
      deps.setSessionMode("editor")
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
      const panel = activeEditorPanel()
      const fileUri = panel && getActiveEditorFileUri(currentPanelTree(), panel)
      if (!fileUri) return
      const content = view.state.doc.toString()
      if (isUntitledUri(fileUri)) {
        const savePath = (await window.gharargah?.fs.showSaveFileDialog()) ?? null
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
      deps.setSessionMode("editor")
      deps.commitTree(tree, panel)
      requestAnimationFrame(() => getEditorView(panel)?.focus())
    },
    closeBuffer: closeTab,
    closeTab,
    find: ctx => {
      const view = ctx.getActiveEditorView()
      const panel = activeEditorPanel()
      if (view) openJetSearch(view, "find", panel?.id)
    },
    replace: ctx => {
      const view = ctx.getActiveEditorView()
      const panel = activeEditorPanel()
      if (view) openJetSearch(view, "replace", panel?.id)
    },
    gotoLine: () => {
      deps.setSessionMode("editor")
      deps.setGotoLineOpen(true)
    },
    showEditor: () => deps.setSessionMode("editor"),
    showTerminal: () => deps.setSessionMode("terminal"),
    terminal: async () => {
      const tree = deps.cloneTree()
      const focused = currentFocusedPanel()

      if (isActiveTerminalTab(tree, focused)) {
        deps.goHome()
        return
      }

      const terminals = listTerminalTabs(tree)
      if (terminals.length > 0) {
        const last = terminals[terminals.length - 1]!
        deps.workspace.focusTabInPanel(tree, last.panelId, last.tabId)
        deps.setFocusedPanel(last.panelId)
        deps.commitTree(tree, last.panelId)
        deps.focusTerminalTab(last.panelId, last.tabId)
        deps.setSessionMode("terminal")
        return
      }

      const cwdRootUri = await resolveTerminalCwdRootUri()
      const { panelId, tabId } = openTerminalTab(deps.workspace, tree, focused, {
        cwdRootUri,
      })
      deps.setFocusedPanel(panelId)
      deps.commitTree(tree, panelId)
      deps.openTerminalModal(panelId, tabId)
      deps.setSessionMode("terminal")
    },
    terminalNew: async () => {
      const tree = deps.cloneTree()
      const count = listTerminalTabs(tree).length
      const label = count === 0 ? "Terminal" : `Terminal ${count + 1}`
      const cwdRootUri = await resolveTerminalCwdRootUri()
      const { panelId, tabId } = openTerminalTab(deps.workspace, tree, currentFocusedPanel(), {
        label,
        cwdRootUri,
      })
      deps.setFocusedPanel(panelId)
      deps.commitTree(tree, panelId)
      deps.openTerminalModal(panelId, tabId)
      deps.setSessionMode("terminal")
    },
    goHome: () => {
      deps.goHome()
    },
    zoomIn: () => deps.setZoomLevel(1),
    zoomOut: () => deps.setZoomLevel(-1),
    closeQuickOpen: () => {
      deps.setPaletteOpen(false)
      deps.setQuickOpenOpen(false)
    },
    toggleComment: ctx => runCmCmd(ctx, toggleComment),
    copyLineDown: ctx => runCmCmd(ctx, copyLineDown),
    moveLineDown: ctx => runCmCmd(ctx, moveLineDown),
    indentMore: ctx => runCmCmd(ctx, indentMore),
    undo: ctx => runCmCmd(ctx, undo),
    redo: ctx => runCmCmd(ctx, redo),
    addCursorBelow: ctx => runCmCmd(ctx, addCursorBelow),
    selectNextOccurrence: ctx => runCmStateCmd(ctx, selectNextOccurrence),
    selectAllOccurrences: ctx => runCmStateCmd(ctx, selectSelectionMatches),
    skipNextOccurrence: ctx => {
      const view = ctx.getActiveEditorView()
      if (view) skipNextOccurrence(view)
    },
    nextBuffer: () => {
      deps.setSessionMode("editor")
      cycleEditorBuffer(1)
    },
    prevBuffer: () => {
      deps.setSessionMode("editor")
      cycleEditorBuffer(-1)
    },
    formatDocument: ctx => {
      const view = ctx.getActiveEditorView()
      if (!view) return
      if (!runFormatDocument(view)) ctx.ui.showMessage("Format not available for this file")
    },
    rename: ctx => {
      const view = ctx.getActiveEditorView()
      if (!view) return
      if (!runRenameSymbol(view)) ctx.ui.showMessage("Rename not available for this symbol")
    },
    goToReferences: async ctx => {
      const view = ctx.getActiveEditorView()
      if (!view) return
      const locs = await requestFindReferences(view)
      if (!locs?.length) ctx.ui.showMessage("No references found")
    },
    parameterHints: ctx => {
      const view = ctx.getActiveEditorView()
      if (!view) return
      if (!runParameterHints(view)) ctx.ui.showMessage("Parameter hints not available")
    },
    goToDefinition: async ctx => {
      const view = ctx.getActiveEditorView()
      if (!view) return
      const locs = await requestGoToDefinition(view)
      if (!locs.length) {
        ctx.ui.showMessage("No definition found")
        return
      }
      const loc = locs[0]!
      deps.openFileInEditor(
        loc.uri,
        fileUriToPath(loc.uri),
        loc.range.start.line + 1,
        loc.range.start.character + 1,
      )
    },
    goToDeclaration: ctx => {
      const view = ctx.getActiveEditorView()
      if (!view) return
      if (!runGoToDeclaration(view)) ctx.ui.showMessage("Go to declaration not available")
    },
    goToTypeDefinition: ctx => {
      const view = ctx.getActiveEditorView()
      if (!view) return
      if (!runGoToTypeDefinition(view)) ctx.ui.showMessage("Go to type definition not available")
    },
    goToImplementation: ctx => {
      const view = ctx.getActiveEditorView()
      if (!view) return
      if (!runGoToImplementation(view)) ctx.ui.showMessage("Go to implementation not available")
    },
    triggerSuggest: ctx => {
      const view = ctx.getActiveEditorView()
      if (!view) return
      runTriggerSuggest(view)
    },
    showHover: ctx => {
      const view = ctx.getActiveEditorView()
      if (!view) return
      if (!runShowHover(view)) ctx.ui.showMessage("Hover not available")
    },
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
  { id: "terminal.list", fn: "terminalList", title: "Terminal List", category: "View", aliases: ["switch terminal", "terminal lister", "cmd-p"] },
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
  { id: "editor.find", fn: "find", title: "Find in Editor", category: "Editor" },
  { id: "editor.replace", fn: "replace", title: "Replace in Editor", category: "Editor" },
  { id: "editor.gotoLine", fn: "gotoLine", title: "Go to Line…", category: "Editor" },
  { id: "dialog.showEditor", fn: "showEditor", title: "Show Editor", category: "View", aliases: ["focus editor"] },
  { id: "dialog.showTerminal", fn: "showTerminal", title: "Show Terminal", category: "View", aliases: ["focus terminal"] },
  { id: "terminal.show", fn: "terminal", title: "Toggle Terminal", category: "View", aliases: ["shell", "integrated terminal"] },
  { id: "terminal.new", fn: "terminalNew", title: "New Terminal", category: "View" },
  { id: "gharargah.goHome", fn: "goHome", title: "Go Home", category: "View", aliases: ["mission control", "home"] },
  { id: "editor.toggleComment", fn: "toggleComment", title: "Toggle Comment", category: "Editor" },
  { id: "editor.copyLineDown", fn: "copyLineDown", title: "Copy Line Down", category: "Editor" },
  { id: "editor.moveLineDown", fn: "moveLineDown", title: "Move Line Down", category: "Editor" },
  { id: "editor.indentMore", fn: "indentMore", title: "Indent Line", category: "Editor" },
  { id: "editor.undo", fn: "undo", title: "Undo", category: "Editor" },
  { id: "editor.redo", fn: "redo", title: "Redo", category: "Editor" },
  { id: "editor.addCursorBelow", fn: "addCursorBelow", title: "Add Cursor Below", category: "Editor" },
  { id: "editor.selectNextOccurrence", fn: "selectNextOccurrence", title: "Select Next Occurrence", category: "Editor" },
  { id: "editor.selectAllOccurrences", fn: "selectAllOccurrences", title: "Select All Occurrences", category: "Editor" },
  { id: "editor.skipNextOccurrence", fn: "skipNextOccurrence", title: "Skip Next Occurrence", category: "Editor" },
  { id: "editor.nextEditor", fn: "nextBuffer", title: "Next Buffer", category: "Editor" },
  { id: "editor.previousEditor", fn: "prevBuffer", title: "Previous Buffer", category: "Editor" },
  { id: "editor.action.formatDocument", fn: "formatDocument", title: "Format Document", category: "Editor" },
  { id: "editor.action.rename", fn: "rename", title: "Rename Symbol", category: "Editor" },
  { id: "editor.action.goToReferences", fn: "goToReferences", title: "Go to References", category: "Editor" },
  { id: "editor.action.triggerParameterHints", fn: "parameterHints", title: "Parameter Hints", category: "Editor" },
  { id: "editor.action.revealDefinition", fn: "goToDefinition", title: "Go to Definition", category: "Editor" },
  { id: "editor.action.revealDeclaration", fn: "goToDeclaration", title: "Go to Declaration", category: "Editor" },
  { id: "editor.action.goToTypeDefinition", fn: "goToTypeDefinition", title: "Go to Type Definition", category: "Editor" },
  { id: "editor.action.goToImplementation", fn: "goToImplementation", title: "Go to Implementation", category: "Editor" },
  { id: "editor.action.triggerSuggest", fn: "triggerSuggest", title: "Trigger Suggest", category: "Editor" },
  { id: "editor.action.showHover", fn: "showHover", title: "Show Hover", category: "Editor" },
  { id: "ui.zoomIn", fn: "zoomIn", title: "Zoom In", category: "UI", aliases: ["font larger"] },
  { id: "ui.zoomOut", fn: "zoomOut", title: "Zoom Out", category: "UI", aliases: ["font smaller"] },
] as const
