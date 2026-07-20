import type { PanelId } from "@gharargah/shared"
import { pathToFileUri } from "@gharargah/shared"
import type { CommandRegistry, GharargahPanelTree, WorkspaceService } from "@gharargah/workspace"
import type { PanelNode } from "@gharargah/panels"
import type { PanelView } from "@gharargah/shared"
import { handleTerminalFileDropAt } from "@gharargah/ui/terminal-file-drop"

export type JetAgentState = {
  /** @deprecated Use `activeWorkspace` + `workspaces` for multi-root. */
  workspace: string | null
  activeWorkspace: string | null
  workspaces: { id: string; path: string; name: string }[]
  message: string | null
  paletteOpen: boolean
  focusedPanel: number | null
  openBuffers: string[]
  panels: { id: number; kind: string }[]
  fontSize: number
  activeEditorDirty: boolean
  searchReady: boolean
  shellView: "home" | "workspace"
}

export type JetAgentCursor = { line: number; column: number }

export type GharargahAgentAPI = {
  openWorkspace(folderPath: string): Promise<void>
  addWorkspace(folderPath: string): Promise<void>
  listWorkspaces(): { id: string; path: string; name: string }[]
  openFile(relativeOrUri: string): Promise<void>
  executeCommand(commandId: string): Promise<void>
  getState(): JetAgentState
  waitForReady(): Promise<void>
  waitForEditor(timeoutMs?: number): Promise<void>
  setFontSize(px: number): void
  getEditorText(): string | null
  setEditorSelection(line: number, column: number): void
  getCursorPosition(): JetAgentCursor | null
  getSelectionRangeCount(): number | null
  acceptConfirm(): Promise<void>
  dismissConfirm(): Promise<void>
  readFixtureFile(relativePath: string): Promise<string>
  waitForListRows(panel: string, minItems: number, timeoutMs?: number): Promise<void>
  getPerfMeasures(names?: string[]): { name: string; durationMs: number }[]
  clearPerf(): void
  markPerf(name: string): void
  measurePerf(name: string, startMark: string, endMark?: string): void
  /** Insert shell-quoted paths into the running terminal under its center (E2E / DnD path). */
  dropFilesOnTerminal(paths: string[]): Promise<boolean>
}

export type AgentBridgeContext = {
  workspace: WorkspaceService
  commands: CommandRegistry
  panelTree: GharargahPanelTree
  focusedPanel: PanelId | null
  paletteOpen: boolean
  message: string | null
  layoutReady: boolean
  fontSize: number
  executeCommand: (name: string) => Promise<void>
  openWorkspace: (folderPath: string) => Promise<void>
  addWorkspace?: (folderPath: string) => Promise<void>
  listWorkspaces?: () => { id: string; path: string; name: string }[]
  setFontSize: (px: number) => void
}

function toWorkspaceFileUri(workspacePath: string, relativeOrUri: string): string {
  if (relativeOrUri.startsWith("file://")) return relativeOrUri
  const normalized = relativeOrUri.replace(/^\/+/, "")
  return pathToFileUri(`${workspacePath}/${normalized}`)
}

export function createAgentBridge(ctx: () => AgentBridgeContext): GharargahAgentAPI {
  return {
    async openWorkspace(folderPath: string) {
      await ctx().openWorkspace(folderPath)
    },
    async addWorkspace(folderPath: string) {
      const add = ctx().addWorkspace
      if (!add) throw new Error("addWorkspace not available")
      await add(folderPath)
    },
    listWorkspaces() {
      return ctx().listWorkspaces?.() ?? []
    },
    async openFile(_relativeOrUri: string) {
      throw new Error("Editor removed — home + terminal shell only")
    },
    async executeCommand(commandId: string) {
      await ctx().executeCommand(commandId)
      await new Promise<void>(resolve => queueMicrotask(resolve))
    },
    getState() {
      const current = ctx()
      const activePath = current.workspace.manager.activeFolder?.root.path ?? null
      return {
        workspace: activePath,
        activeWorkspace: activePath,
        workspaces: current.listWorkspaces?.() ?? [],
        message: current.message,
        paletteOpen: current.paletteOpen,
        focusedPanel: current.focusedPanel?.id ?? null,
        openBuffers: [],
        panels: collectPanels(current),
        fontSize: current.fontSize,
        activeEditorDirty: false,
        searchReady: false,
        shellView: "home",
      }
    },
    async waitForReady() {
      if (typeof performance?.mark === "function") {
        performance.mark("gharargah:ready:start")
      }
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        const current = ctx()
        if (current.layoutReady && current.commands.has("terminal.new")) {
          if (typeof performance?.mark === "function") {
            performance.mark("gharargah:ready:end")
            try {
              performance.measure("gharargah:ready", "gharargah:ready:start", "gharargah:ready:end")
            } catch {
              performance.measure("gharargah:ready", "gharargah:ready:end")
            }
          }
          return
        }
        await new Promise(r => setTimeout(r, 50))
      }
      throw new Error("Gharargah layout did not become ready in time")
    },
    async waitForEditor(_timeoutMs = 5000) {
      throw new Error("Editor removed — home + terminal shell only")
    },
    setFontSize(px: number) {
      ctx().setFontSize(px)
    },
    getEditorText() {
      return null
    },
    setEditorSelection() {
      throw new Error("Editor removed — home + terminal shell only")
    },
    getCursorPosition() {
      return null
    },
    getSelectionRangeCount() {
      return null
    },
    async acceptConfirm() {
      const btn = document.querySelector<HTMLElement>('[data-gharargah-confirm="accept"]')
      if (!btn) throw new Error("No confirm dialog accept button visible")
      btn.click()
      await new Promise(r => setTimeout(r, 50))
    },
    async dismissConfirm() {
      const btn = document.querySelector<HTMLElement>('[data-gharargah-confirm="cancel"]')
      if (!btn) throw new Error("No confirm dialog cancel button visible")
      btn.click()
      await new Promise(r => setTimeout(r, 50))
    },
    async readFixtureFile(relativePath: string) {
      const current = ctx()
      const rootPath = current.workspace.root?.path
      if (!rootPath) throw new Error("No workspace open")
      const uri = toWorkspaceFileUri(rootPath, relativePath)
      if (!window.gharargah?.fs?.readFile) {
        throw new Error("window.gharargah.fs.readFile not available")
      }
      return window.gharargah.fs.readFile(uri)
    },
    async waitForListRows(panel: string, minItems: number, timeoutMs = 10_000) {
      const sel = `[data-gharargah-list-panel="${panel}"] [data-gharargah-list-item]`
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const count = document.querySelectorAll(sel).length
        if (count >= minItems) return
        await new Promise(r => setTimeout(r, 50))
      }
      throw new Error(`waitForListRows: expected >= ${minItems} rows in panel "${panel}"`)
    },
    getPerfMeasures(names?: string[]) {
      if (typeof performance?.getEntriesByType !== "function") return []
      const measures = performance.getEntriesByType("measure") as PerformanceMeasure[]
      const filtered = names?.length
        ? measures.filter(m => names.includes(m.name))
        : measures.filter(m => m.name.startsWith("gharargah:"))
      return filtered.map(m => ({ name: m.name, durationMs: m.duration }))
    },
    clearPerf() {
      if (typeof performance?.clearMeasures === "function") performance.clearMeasures()
      if (typeof performance?.clearMarks === "function") performance.clearMarks()
    },
    markPerf(name: string) {
      if (typeof performance?.mark === "function") performance.mark(name)
    },
    measurePerf(name: string, startMark: string, endMark?: string) {
      if (typeof performance?.measure !== "function") return
      try {
        performance.measure(name, startMark, endMark)
      } catch {
        try {
          performance.measure(name, startMark)
        } catch {
          // ignore invalid mark pairs in tests
        }
      }
    },
    async dropFilesOnTerminal(paths: string[]) {
      const panel = document.querySelector<HTMLElement>(
        '[data-gharargah-terminal-panel][data-gharargah-terminal-status="running"]',
      )
      if (!panel) return false
      const rect = panel.getBoundingClientRect()
      return handleTerminalFileDropAt(
        paths,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      )
    },
  }
}

function collectPanels(ctx: AgentBridgeContext): JetAgentState["panels"] {
  const panels: JetAgentState["panels"] = []
  const walk = (node: PanelNode<PanelView>) => {
    if (node.kind === "leaf") {
      const view = node.view
      const kind =
        view.kind === "tabs"
          ? ctx.workspace.tabRegistry.kindFor(view.activeTabId) ?? "tabs"
          : view.kind
      panels.push({ id: node.panelId.id, kind })
    } else {
      node.split.children.forEach(walk)
    }
  }
  walk(ctx.panelTree.root)
  return panels
}

declare global {
  interface Window {
    __gharargahAgent?: GharargahAgentAPI
  }
}
