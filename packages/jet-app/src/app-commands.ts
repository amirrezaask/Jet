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
import type { PanelTree } from "@jet/panels"
import type { PanelId, TabId } from "@jet/shared"
import { basename, isUntitledUri, pathToFileUri } from "@jet/shared"
import type { JetCommandContext, JetCommands, JetCommandFn, WorkspaceService } from "@jet/workspace"
import { openReplaceSearchPanel, openSearchPanel } from "@jet/codemirror"
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
import { getEditorView, showEditorContextMenuAt } from "@jet/ui"
import { getAllLeafPanels, resolveEditorPanel, resolveTargetPanel } from "./panel-routing.js"
import { confirmCloseEditorTab } from "./tab-close.js"

export type BuildAppCommandsDeps = {
  workspace: WorkspaceService
  panelTree: PanelTree
  focusedPanel: PanelId | null
  setPaletteOpen: (open: boolean) => void
  setQuickOpenOpen: (open: boolean) => void
  setOpenFileOpen: (open: boolean) => void
  setCdOpen: (open: boolean) => void
  setGotoLineOpen: (open: boolean) => void
  setMessage: (msg: string) => void
  setFocusedPanel: (panel: PanelId) => void
  cloneTree: () => PanelTree
  commitTree: (tree: PanelTree) => void
  openWorkspaceFolder: (path: string) => void
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
  flushWorkspaceSession: () => void
  isWebMode: boolean
  setZoomLevel: (delta: number) => void
  handlePanelNavigation: (action: string) => void
  activeTabKindName: string | undefined
  setOutlineOpen: (open: boolean) => void
  setOutlineSymbols: (symbols: OutlineEntry[]) => void
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
    cd: () => deps.setCdOpen(true),
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
        deps.flushWorkspaceSession()
        deps.setMessage(`Saved ${basename(savePath)}`)
        return
      }
      await deps.workspace.writeFile(kind.fileUri, content)
      deps.flushWorkspaceSession()
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

    // --- Tier 1: Editor commands wrapping CM built-ins ---
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

    // --- Tier 2: Window / layout ---
    nextEditor: () => {
      const tree = deps.cloneTree()
      const leaf = deps.focusedPanel && tree.getLeaf(deps.focusedPanel)
      if (!leaf || leaf.group.tabs.length < 2) { deps.commitTree(tree); return }
      const next = (leaf.group.active + 1) % leaf.group.tabs.length
      leaf.group.active = next
      const tabId = leaf.group.tabs[next]
      deps.setFocusedPanel(leaf.panelId)
      deps.commitTree(tree)
      const kind = deps.workspace.tabRegistry.get(tabId)
      if (kind?.kind === "editor") requestAnimationFrame(() => getEditorView(tabId)?.focus())
    },
    prevEditor: () => {
      const tree = deps.cloneTree()
      const leaf = deps.focusedPanel && tree.getLeaf(deps.focusedPanel)
      if (!leaf || leaf.group.tabs.length < 2) { deps.commitTree(tree); return }
      const prev = (leaf.group.active - 1 + leaf.group.tabs.length) % leaf.group.tabs.length
      leaf.group.active = prev
      const tabId = leaf.group.tabs[prev]
      deps.setFocusedPanel(leaf.panelId)
      deps.commitTree(tree)
      const kind = deps.workspace.tabRegistry.get(tabId)
      if (kind?.kind === "editor") requestAnimationFrame(() => getEditorView(tabId)?.focus())
    },
    closeAllTabs: () => {
      const tree = deps.cloneTree()
      const leaf = deps.focusedPanel && tree.getLeaf(deps.focusedPanel)
      if (!leaf) { deps.commitTree(tree); return }
      for (const tabId of [...leaf.group.tabs]) {
        if (!confirmCloseEditorTab(deps.workspace, tabId)) continue
        deps.workspace.tabRegistry.delete(tabId)
        tree.removeTab(tabId)
      }
      deps.commitTree(tree)
    },
    focusSidebar: () => {
      const allPanels = getAllLeafPanels(deps.panelTree)
      for (const panel of allPanels) {
        const leaf = deps.panelTree.getLeaf(panel)
        if (!leaf) continue
        const hasSidebarTab = leaf.group.tabs.some(t => {
          const k = deps.workspace.tabRegistry.get(t)
          return k?.kind === "explorer" || k?.kind === "git" || k?.kind === "search" || k?.kind === "problems"
        })
        if (hasSidebarTab) { deps.setFocusedPanel(panel); return }
      }
      if (allPanels[0]) deps.setFocusedPanel(allPanels[0])
    },
    focusEditorGroup: () => {
      if (deps.editorPanelRef.current) {
        deps.setFocusedPanel(deps.editorPanelRef.current)
        const leaf = deps.panelTree.getLeaf(deps.editorPanelRef.current)
        const tabId = leaf?.group.tabs[leaf?.group.active ?? 0]
        if (tabId) requestAnimationFrame(() => getEditorView(tabId)?.focus())
      }
    },
    lastEditorGroup: () => {
      const panels = getAllLeafPanels(deps.panelTree)
      let lastEditor: PanelId | null = null
      for (const panel of panels) {
        const leaf = deps.panelTree.getLeaf(panel)
        if (leaf?.group.tabs.some(t => deps.workspace.tabRegistry.get(t)?.kind === "editor")) {
          lastEditor = panel
        }
      }
      if (lastEditor) deps.setFocusedPanel(lastEditor)
    },
    splitEditorRight: () => {
      const tree = deps.cloneTree()
      const target = deps.focusedPanel ?? deps.editorPanelRef.current
      if (!target) { deps.commitTree(tree); return }
      const newPanel = tree.splitAtEdge(target, "right")
      const leaf = tree.getLeaf(target)
      if (leaf && leaf.group.tabs.length > 0) {
        const activeTab = leaf.group.tabs[leaf.group.active]
        tree.removeTab(activeTab)
        tree.insertTab(newPanel, activeTab)
        deps.workspace.tabRegistry.setPanel(activeTab, newPanel)
      }
      deps.editorPanelRef.current = target
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
    toggleDevTools: () => { /* Electron handles Cmd-Alt-i natively */ },
    toggleFullScreen: () => {
      if (document.fullscreenElement) document.exitFullscreen()
      else document.body.requestFullscreen()
    },
    quit: () => { /* Electron / OS handles Cmd-q natively */ },
    closeQuickOpen: () => {
      deps.setPaletteOpen(false)
      deps.setQuickOpenOpen(false)
      deps.setOpenFileOpen(false)
      deps.setGotoLineOpen(false)
      deps.setOutlineOpen(false)
    },

    // --- Tier 3: LSP entry points ---
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
      if (!runGoToDefinition(view)) ctx.ui.showMessage("Go to definition not available")
    },
    goToDeclaration: ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!view) return
      if (lspUnavailable(ctx)) return
      if (!runGoToDeclaration(view)) ctx.ui.showMessage("Go to declaration not available")
    },
    goToTypeDefinition: ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!view) return
      if (lspUnavailable(ctx)) return
      if (!runGoToTypeDefinition(view)) ctx.ui.showMessage("Go to type definition not available")
    },
    goToImplementation: ctx => {
      const view = ctx.getActiveEditorView() as EditorView | null
      if (!view) return
      if (lspUnavailable(ctx)) return
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

    gitRevertSelected: ctx => ctx.ui.showMessage("Git: revert selected ranges not yet implemented"),
    gitStageSelected: ctx => ctx.ui.showMessage("Git: stage selected ranges not yet implemented"),
    gitUnstageSelected: ctx => ctx.ui.showMessage("Git: unstage selected ranges not yet implemented"),

    // --- Tier 4: List navigation (infrastructure) ---
    listFocusPageUp: () => deps.handlePanelNavigation("focusPageUp"),
    listFocusPageDown: () => deps.handlePanelNavigation("focusPageDown"),
    listFocusFirst: () => deps.handlePanelNavigation("focusFirst"),
    listFocusLast: () => deps.handlePanelNavigation("focusLast"),
  }

  return named as JetCommands
}

/** Palette / agent command ids mapped to app command functions. */
export const APP_COMMAND_REGISTRY = [
  { id: "ui.showCommandPalette", fn: "palette", title: "Show Command Palette", category: "UI" },
  { id: "workspace.quickOpen", fn: "quickOpen", title: "Quick Open File", category: "Workspace" },
  { id: "workspace.saveFile", fn: "save", title: "Save File", category: "Workspace" },
  { id: "workspace.openFile", fn: "openFile", title: "Open File", category: "Workspace" },
  { id: "workspace.openFolder", fn: "openFolder", title: "Open Folder", category: "Workspace" },
  { id: "workspace.cd", fn: "cd", title: "Change Directory", category: "Workspace" },
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

  // --- Tier 1: Editor ---
  { id: "editor.toggleComment", fn: "toggleComment", title: "Toggle Comment", category: "Editor" },
  { id: "editor.copyLineUp", fn: "copyLineUp", title: "Copy Line Up", category: "Editor" },
  { id: "editor.copyLineDown", fn: "copyLineDown", title: "Copy Line Down", category: "Editor" },
  { id: "editor.moveLineUp", fn: "moveLineUp", title: "Move Line Up", category: "Editor" },
  { id: "editor.moveLineDown", fn: "moveLineDown", title: "Move Line Down", category: "Editor" },
  { id: "editor.addCursorAbove", fn: "addCursorAbove", title: "Add Cursor Above", category: "Editor" },
  { id: "editor.addCursorBelow", fn: "addCursorBelow", title: "Add Cursor Below", category: "Editor" },
  { id: "editor.jumpToBracket", fn: "jumpToBracket", title: "Jump to Bracket", category: "Editor" },
  { id: "editor.expandLineSelection", fn: "expandLineSelection", title: "Expand Line Selection", category: "Editor" },
  { id: "editor.indent", fn: "indentMore", title: "Indent", category: "Editor" },
  { id: "editor.outdent", fn: "indentLess", title: "Outdent", category: "Editor" },
  { id: "editor.selectNextOccurrence", fn: "selectNextOccurrence", title: "Select Next Occurrence", category: "Editor" },
  { id: "editor.selectAllOccurrences", fn: "selectAllOccurrences", title: "Select All Occurrences", category: "Editor" },
  { id: "editor.undo", fn: "undo", title: "Undo", category: "Editor" },
  { id: "editor.redo", fn: "redo", title: "Redo", category: "Editor" },
  { id: "editor.cursorUndo", fn: "cursorUndo", title: "Cursor Undo", category: "Editor" },
  { id: "editor.smartSelectExpand", fn: "smartSelectExpand", title: "Expand Selection", category: "Editor" },
  { id: "editor.smartSelectShrink", fn: "smartSelectShrink", title: "Shrink Selection", category: "Editor" },

  // --- Tier 2: Window / Layout ---
  { id: "editor.nextEditor", fn: "nextEditor", title: "Next Editor Tab", category: "Editor" },
  { id: "editor.previousEditor", fn: "prevEditor", title: "Previous Editor Tab", category: "Editor" },
  { id: "layout.closeAllTabs", fn: "closeAllTabs", title: "Close All Tabs", category: "Layout" },
  { id: "workbench.action.focusSideBar", fn: "focusSidebar", title: "Focus Sidebar", category: "View" },
  { id: "workbench.action.focusFirstEditorGroup", fn: "focusEditorGroup", title: "Focus First Editor Group", category: "View" },
  { id: "workbench.action.lastEditorInGroup", fn: "lastEditorGroup", title: "Last Editor in Group", category: "View" },
  { id: "view.splitEditor", fn: "splitEditorRight", title: "Split Editor Right", category: "View" },
  { id: "workbench.action.toggleEditorGroupLayout", fn: "toggleEditorLayout", title: "Toggle Editor Group Layout", category: "View" },
  { id: "workbench.action.zoomIn", fn: "zoomIn", title: "Zoom In", category: "View" },
  { id: "workbench.action.zoomOut", fn: "zoomOut", title: "Zoom Out", category: "View" },
  { id: "workbench.action.toggleFullScreen", fn: "toggleFullScreen", title: "Toggle Full Screen", category: "View" },
  { id: "workbench.action.closeQuickOpen", fn: "closeQuickOpen", title: "Close Quick Open", category: "View" },

  // --- Tier 3: Entry points (LSP) ---
  { id: "editor.action.quickOutline", fn: "quickOutline", title: "Quick Outline", category: "Editor" },
  { id: "editor.action.formatDocument", fn: "formatDocument", title: "Format Document", category: "Editor" },
  { id: "editor.action.rename", fn: "rename", title: "Rename Symbol", category: "Editor" },
  { id: "editor.action.goToReferences", fn: "goToReferences", title: "Go to References", category: "Editor" },
  { id: "editor.action.triggerParameterHints", fn: "triggerParameterHints", title: "Trigger Parameter Hints", category: "Editor" },
  { id: "editor.action.revealDefinition", fn: "goToDefinition", title: "Go to Definition", category: "Editor" },
  { id: "editor.action.revealDeclaration", fn: "goToDeclaration", title: "Go to Declaration", category: "Editor" },
  { id: "editor.action.goToTypeDefinition", fn: "goToTypeDefinition", title: "Go to Type Definition", category: "Editor" },
  { id: "editor.action.goToImplementation", fn: "goToImplementation", title: "Go to Implementation", category: "Editor" },
  { id: "editor.action.triggerSuggest", fn: "triggerSuggest", title: "Trigger Suggest", category: "Editor" },
  { id: "editor.action.showHover", fn: "showHover", title: "Show Hover", category: "Editor" },
  { id: "editor.action.quickFix", fn: "quickFix", title: "Quick Fix", category: "Editor" },
  { id: "editor.action.showContextMenu", fn: "showContextMenu", title: "Show Context Menu", category: "Editor" },

  // --- Tier 4: List navigation ---
  { id: "list.focusPageUp", fn: "listFocusPageUp", title: "List Page Up", category: "List" },
  { id: "list.focusPageDown", fn: "listFocusPageDown", title: "List Page Down", category: "List" },
  { id: "list.focusFirst", fn: "listFocusFirst", title: "List First", category: "List" },
  { id: "list.focusLast", fn: "listFocusLast", title: "List Last", category: "List" },
] as const
