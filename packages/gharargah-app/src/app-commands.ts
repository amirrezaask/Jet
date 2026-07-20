import type { GharargahPanelTree } from "@gharargah/workspace"
import type { PanelId } from "@gharargah/shared"
import type {
  JetCommandContext,
  JetCommands,
  JetCommandFn,
  WorkspaceFolderPicker,
  WorkspaceService,
} from "@gharargah/workspace"
import { resolveFolderForActiveTab } from "./resolve-tab-workspace.js"
import {
  openTerminalTab,
  listTerminalTabs,
  isActiveTerminalTab,
} from "./tab-routing.js"
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
  setTerminalListOpen: (open: boolean) => void
  setCdOpen: (open: boolean) => void
  setAddWorkspaceOpen: (open: boolean) => void
  setProjectSwitcherOpen: (open: boolean) => void
  setSwitchFolderOpen: (open: boolean) => void
  pickWorkspaceFolder: WorkspaceFolderPicker
  setMessage: (msg: string) => void
  setFocusedPanel: (panel: PanelId) => void
  cloneTree: () => GharargahPanelTree
  commitTree: (tree: GharargahPanelTree, preferFocus?: PanelId | null) => void
  openWorkspaceFolder: (path: string, opts?: { replace?: boolean }) => void | Promise<void>
  addWorkspaceFolder: (path: string) => void
  removeWorkspaceFolder: (folderId: string) => Promise<boolean>
  setActiveWorkspaceFolder: (folderId: string) => void
  editorPanelRef: { current: PanelId | null }
  setZoomLevel: (delta: number) => void
  projectRegistry: import("@gharargah/workspace").ProjectRegistry
  refreshProjects: () => Promise<number>
  getActiveTerminalTabId: () => string | null
  closeTerminalTab: (panelId: PanelId, tabId: string) => void
  getTerminalExplorerGroups: () => import("./terminal-explorer.js").TerminalExplorerGroup[]
  focusTerminalTab: (panelId: PanelId, tabId: string) => void
  openTerminalModal: (panelId: PanelId, tabId: string) => void
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

  function activeTerminalTab(): { panelId: PanelId; tabId: string } | null {
    const tabId = deps.getActiveTerminalTabId()
    if (!tabId) return null
    const panel = currentFocusedPanel()
    if (!panel) return null
    return { panelId: panel, tabId }
  }

  const named: JetCommands = {
    palette: () => deps.setPaletteOpen(true),
    terminalList: () => deps.setTerminalListOpen(true),
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
        return
      }

      const cwdRootUri = await resolveTerminalCwdRootUri()
      const { panelId, tabId } = openTerminalTab(deps.workspace, tree, focused, {
        cwdRootUri,
      })
      deps.setFocusedPanel(panelId)
      deps.commitTree(tree, panelId)
      deps.openTerminalModal(panelId, tabId)
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
    },
    goHome: () => {
      deps.goHome()
    },
    zoomIn: () => deps.setZoomLevel(1),
    zoomOut: () => deps.setZoomLevel(-1),
    closeTab: async () => {
      const terminal = activeTerminalTab()
      if (terminal) {
        deps.closeTerminalTab(terminal.panelId, terminal.tabId)
      }
    },
    closeQuickOpen: () => {
      deps.setPaletteOpen(false)
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
  { id: "terminal.list", fn: "terminalList", title: "Terminal List", category: "View", aliases: ["switch terminal", "terminal lister", "cmd-p"] },
  { id: "workspace.openFolder", fn: "openFolder", title: "Open Folder", category: "Workspace", aliases: ["open workspace"] },
  { id: "workspace.addFolder", fn: "addFolder", title: "Add Folder to Workspace", category: "Workspace", aliases: ["add root", "multi-root"] },
  { id: "workspace.removeFolder", fn: "removeFolder", title: "Remove Folder from Workspace", category: "Workspace", aliases: ["close folder root"] },
  { id: "workspace.focusFolder", fn: "focusFolder", title: "Focus Next Workspace Folder", category: "Workspace", aliases: ["switch root"] },
  { id: "workspace.switchFolder", fn: "switchFolder", title: "Switch Workspace Folder…", category: "Workspace", aliases: ["pick root", "active folder"] },
  { id: "workspace.cd", fn: "cd", title: "Change Directory", category: "Workspace", aliases: ["switch workspace"] },
  { id: "workspace.switchProject", fn: "switchProject", title: "Switch Project", category: "Workspace", aliases: ["projects", "project"] },
  { id: "workspace.refreshProjects", fn: "refreshProjects", title: "Refresh Projects", category: "Workspace" },
  { id: "layout.closeTab", fn: "closeTab", title: "Close Tab", category: "Layout", aliases: ["close"] },
  { id: "terminal.show", fn: "terminal", title: "Toggle Terminal", category: "View", aliases: ["shell", "integrated terminal"] },
  { id: "terminal.new", fn: "terminalNew", title: "New Terminal", category: "View" },
  { id: "gharargah.goHome", fn: "goHome", title: "Go Home", category: "View", aliases: ["mission control", "home"] },
  { id: "ui.zoomIn", fn: "zoomIn", title: "Zoom In", category: "UI", aliases: ["font larger"] },
  { id: "ui.zoomOut", fn: "zoomOut", title: "Zoom Out", category: "UI", aliases: ["font smaller"] },
] as const
