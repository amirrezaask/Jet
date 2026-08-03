import type { PanelId } from "@yaade/shared"
import { pathToFileUri } from "@yaade/shared"
import type { CommandRegistry, YaadePanelTree, WorkspaceService } from "@yaade/workspace"
import type { PanelNode } from "@yaade/panels"
import type { PanelView } from "@yaade/shared"
import { handleTerminalFileDropAt } from "@yaade/ui/terminal-file-drop"
import {
  readTerminalBufferText,
  readTerminalCellHeight,
  readTerminalCursor,
  readTerminalDims,
} from "@yaade/ui/terminal-registry"

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
  sessionLayout: "sidebar"
  sessionMode: "agent" | "terminal" | "editor" | "git" | "todos" | null
  /** Always false — in-app native agent chat removed; CLI PTY only. */
  agentChatEnabled: boolean
}

export type JetAgentCursor = { line: number; column: number }

export type YaadeAgentAPI = {
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
  /** Buffer-backed terminal text (WebGL/Canvas-safe; E2E). */
  getTerminalText(tabId?: string): string
  /** Cell height in CSS px from the active terminal renderer (E2E). */
  getTerminalCellHeight(tabId?: string): number
  /** Fitted xterm cols/rows (E2E). */
  getTerminalDims(tabId?: string): { cols: number; rows: number } | null
  /** Buffer cursor cell + hidden flag (WebGL-safe; E2E). */
  getTerminalCursor(tabId?: string): { x: number; y: number; hidden: boolean } | null
  /** Ingest a notification (E2E / agent harness). */
  ingestNotification?(
    req: import("@yaade/shared").IngestNotificationRequest,
  ): Promise<unknown>
  /** Open notification center (E2E). */
  openNotificationCenter?(opts?: {
    projectId?: string
    sessionId?: string
  }): Promise<void>
  getNotificationCounts?(): Promise<import("@yaade/shared").NotificationCounts>
}

export type AgentBridgeContext = {
  workspace: WorkspaceService
  commands: CommandRegistry
  panelTree: YaadePanelTree
  focusedPanel: PanelId | null
  paletteOpen: boolean
  message: string | null
  layoutReady: boolean
  fontSize: number
  executeCommand: (name: string) => Promise<void>
  openWorkspace: (folderPath: string) => Promise<void>
  addWorkspace?: (folderPath: string) => void | Promise<void>
  listWorkspaces?: () => { id: string; path: string; name: string }[]
  setFontSize: (px: number) => void
  openFile: (uri: string, path: string) => void
  getEditorText?: () => string | null
  setEditorSelection?: (line: number, column: number) => void
  getCursorPosition?: () => JetAgentCursor | null
  getSelectionRangeCount?: () => number | null
  activeEditorDirty?: boolean
  searchReady?: boolean
  sessionMode?: "agent" | "terminal" | "editor" | "git" | "todos" | null
  sessionLayout?: "sidebar"
  agentChatEnabled?: boolean
}

function toWorkspaceFileUri(workspacePath: string, relativeOrUri: string): string {
  if (relativeOrUri.startsWith("file://")) return relativeOrUri
  const normalized = relativeOrUri.replace(/^\/+/, "")
  return pathToFileUri(`${workspacePath}/${normalized}`)
}

export function createAgentBridge(ctx: () => AgentBridgeContext): YaadeAgentAPI {
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
    async openFile(relativeOrUri: string) {
      const current = ctx()
      const rootPath = current.workspace.root?.path
      if (!rootPath) {
        throw new Error("No workspace open — call openWorkspace first")
      }
      if (typeof performance?.mark === "function") {
        performance.mark("yaade:editor-mounted:start")
      }
      const uri = toWorkspaceFileUri(rootPath, relativeOrUri)
      const path = uri.replace(/^file:\/\//, "")
      current.openFile(uri, decodeURIComponent(path))
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
        openBuffers: current.workspace.openBuffers,
        panels: collectPanels(current),
        fontSize: current.fontSize,
        activeEditorDirty: current.activeEditorDirty ?? false,
        searchReady: current.searchReady ?? false,
        shellView: "home",
        sessionLayout: "sidebar",
        sessionMode: current.sessionMode ?? null,
        agentChatEnabled: current.agentChatEnabled ?? false,
      }
    },
    async waitForReady() {
      if (typeof performance?.mark === "function") {
        performance.mark("yaade:ready:start")
      }
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        const current = ctx()
        if (current.layoutReady && current.commands.has("terminal.new")) {
          if (typeof performance?.mark === "function") {
            performance.mark("yaade:ready:end")
            try {
              performance.measure("yaade:ready", "yaade:ready:start", "yaade:ready:end")
            } catch {
              performance.measure("yaade:ready", "yaade:ready:end")
            }
          }
          return
        }
        await new Promise(r => setTimeout(r, 50))
      }
      throw new Error("YAADE layout did not become ready in time")
    },
    async waitForEditor(timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const editor = document.querySelector("[data-yaade-monaco-editor], .monaco-editor")
        if (editor) {
          if (typeof performance?.mark === "function") {
            performance.mark("yaade:editor-mounted:end")
            try {
              performance.measure(
                "yaade:editor-mounted",
                "yaade:editor-mounted:start",
                "yaade:editor-mounted:end",
              )
            } catch {
              performance.measure("yaade:editor-mounted", "yaade:editor-mounted:end")
            }
          }
          return
        }
        await new Promise(r => setTimeout(r, 50))
      }
      throw new Error("Editor did not mount in time")
    },
    setFontSize(px: number) {
      ctx().setFontSize(px)
    },
    getEditorText() {
      return ctx().getEditorText?.() ?? null
    },
    setEditorSelection(line: number, column: number) {
      ctx().setEditorSelection?.(line, column)
    },
    getCursorPosition() {
      return ctx().getCursorPosition?.() ?? null
    },
    getSelectionRangeCount() {
      return ctx().getSelectionRangeCount?.() ?? null
    },
    async acceptConfirm() {
      const btn = document.querySelector<HTMLElement>('[data-yaade-confirm="accept"]')
      if (!btn) throw new Error("No confirm dialog accept button visible")
      btn.click()
      await new Promise(r => setTimeout(r, 50))
    },
    async dismissConfirm() {
      const btn = document.querySelector<HTMLElement>('[data-yaade-confirm="cancel"]')
      if (!btn) throw new Error("No confirm dialog cancel button visible")
      btn.click()
      await new Promise(r => setTimeout(r, 50))
    },
    async readFixtureFile(relativePath: string) {
      const current = ctx()
      const rootPath = current.workspace.root?.path
      if (!rootPath) throw new Error("No workspace open")
      const uri = toWorkspaceFileUri(rootPath, relativePath)
      if (!window.yaade?.fs?.readFile) {
        throw new Error("window.yaade.fs.readFile not available")
      }
      return window.yaade.fs.readFile(uri)
    },
    async waitForListRows(panel: string, minItems: number, timeoutMs = 10_000) {
      const sel = `[data-yaade-list-panel="${panel}"] [data-yaade-list-item]`
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
        : measures.filter(m => m.name.startsWith("yaade:"))
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
        '[data-yaade-terminal-panel][data-yaade-terminal-status="running"]',
      )
      if (!panel) return false
      const rect = panel.getBoundingClientRect()
      return handleTerminalFileDropAt(
        paths,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      )
    },
    getTerminalText(tabId) {
      return readTerminalBufferText(tabId)
    },
    getTerminalCellHeight(tabId) {
      return readTerminalCellHeight(tabId)
    },
    getTerminalDims(tabId) {
      return readTerminalDims(tabId)
    },
    getTerminalCursor(tabId) {
      return readTerminalCursor(tabId)
    },
    async ingestNotification(req) {
      const api = window.yaade?.notifications
      if (!api) throw new Error("notifications API unavailable")
      return api.ingest(req)
    },
    async openNotificationCenter(opts) {
      await ctx().executeCommand("notifications.show")
      if (opts?.projectId || opts?.sessionId) {
        // Command opens center; filters applied via dedicated ingest path in E2E using UI.
        void opts
      }
    },
    async getNotificationCounts() {
      const api = window.yaade?.notifications
      if (!api) throw new Error("notifications API unavailable")
      return api.counts()
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
    __yaadeAgent?: YaadeAgentAPI
  }
}
