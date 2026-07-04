import type { PanelId } from "@jet/shared"
import type { CommandRegistry, WorkspaceService } from "@jet/workspace"
import type { PanelTree } from "@jet/panels"
import { resolveDevWorkspacePath, toWorkspaceFileUri } from "./browser-api.js"

export type JetAgentState = {
  workspace: string | null
  message: string | null
  paletteOpen: boolean
  focusedPanel: number | null
  openBuffers: string[]
  panels: { id: number; kind: string }[]
  fontSize: number
}

export type JetAgentAPI = {
  openWorkspace(folderPath: string): Promise<void>
  openFile(relativeOrUri: string): Promise<void>
  executeCommand(commandId: string): Promise<void>
  getState(): JetAgentState
  waitForReady(): Promise<void>
  waitForEditor(timeoutMs?: number): Promise<void>
  setFontSize(px: number): void
}

export type AgentBridgeContext = {
  workspace: WorkspaceService
  commands: CommandRegistry
  panelTree: PanelTree
  focusedPanel: PanelId | null
  paletteOpen: boolean
  message: string | null
  layoutReady: boolean
  fontSize: number
  executeCommand: (name: string) => Promise<void>
  openWorkspace: (folderPath: string) => Promise<void>
  openFile: (uri: string, path: string) => void
  setFontSize: (px: number) => void
}

export function createAgentBridge(ctx: () => AgentBridgeContext): JetAgentAPI {
  return {
    async openWorkspace(folderPath: string) {
      const { path } = await resolveDevWorkspacePath(folderPath)
      await ctx().openWorkspace(path)
    },
    async openFile(relativeOrUri: string) {
      const current = ctx()
      const rootPath = current.workspace.root?.path
      if (!rootPath) {
        throw new Error("No workspace open — call openWorkspace first")
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
      return {
        workspace: current.workspace.root?.path ?? null,
        message: current.message,
        paletteOpen: current.paletteOpen,
        focusedPanel: current.focusedPanel?.id ?? null,
        openBuffers: current.workspace.openBuffers,
        panels: collectPanels(current),
        fontSize: current.fontSize,
      }
    },
    async waitForReady() {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        if (ctx().layoutReady) return
        await new Promise(r => setTimeout(r, 50))
      }
      throw new Error("Jet layout did not become ready in time")
    },
    async waitForEditor(timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const editor = document.querySelector(".cm-editor")
        if (editor) return
        await new Promise(r => setTimeout(r, 50))
      }
      throw new Error("Editor did not mount in time")
    },
    setFontSize(px: number) {
      ctx().setFontSize(px)
    },
  }
}

function collectPanels(ctx: AgentBridgeContext): JetAgentState["panels"] {
  const panels: JetAgentState["panels"] = []
  const walk = (node: import("@jet/shared").PanelNode) => {
    if (node.kind === "leaf") {
      panels.push({ id: node.panelId.id, kind: node.view.kind })
    } else {
      node.split.children.forEach(walk)
    }
  }
  walk(ctx.panelTree.root)
  return panels
}

declare global {
  interface Window {
    __jetAgent?: JetAgentAPI
  }
}

export async function openWorkspaceFromQuery(
  search: string,
  openWorkspace: (path: string) => Promise<void>,
  openFile: (uri: string, path: string) => void,
): Promise<void> {
  const params = new URLSearchParams(search)
  const workspaceParam = params.get("workspace")
  if (!workspaceParam) return

  const { path } = await resolveDevWorkspacePath(workspaceParam)
  await openWorkspace(path)

  const fileParam = params.get("file")
  if (fileParam) {
    const fileUri = toWorkspaceFileUri(path, fileParam)
    const filePath = fileUri.replace(/^file:\/\//, "")
    openFile(fileUri, decodeURIComponent(filePath))
  }
}
