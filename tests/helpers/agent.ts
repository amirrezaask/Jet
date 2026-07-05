import type { Page } from "@playwright/test"

export type JetAgentState = {
  workspace: string | null
  message: string | null
  paletteOpen: boolean
  focusedPanel: number | null
  openBuffers: string[]
  panels: { id: number; kind: string }[]
  fontSize: number
  activeEditorDirty: boolean
}

export type JetAgentCursor = { line: number; column: number }

export type JetAgent = {
  getState(): Promise<JetAgentState>
  executeCommand(id: string): Promise<void>
  openWorkspace(path: string): Promise<void>
  openFile(path: string): Promise<void>
  setFontSize(px: number): Promise<void>
  waitForReady(): Promise<void>
  waitForEditor(timeoutMs?: number): Promise<void>
  getEditorText(): Promise<string | null>
  setEditorSelection(line: number, column: number): Promise<void>
  getCursorPosition(): Promise<JetAgentCursor | null>
  acceptConfirm(): Promise<void>
  dismissConfirm(): Promise<void>
  readFixtureFile(relPath: string): Promise<string>
  waitForListRows(panel: string, minItems: number, timeoutMs?: number): Promise<void>
}

export function agent(page: Page): JetAgent {
  return {
    getState: () => page.evaluate(() => window.__jetAgent!.getState() as JetAgentState),
    executeCommand: (id: string) =>
      page.evaluate(async (id: string) => {
        if (!window.__jetAgent) throw new Error("__jetAgent not present")
        await window.__jetAgent.executeCommand(id)
      }, id),
    openWorkspace: (path: string) =>
      page.evaluate(async (p: string) => {
        if (!window.__jetAgent) throw new Error("__jetAgent not present")
        await window.__jetAgent.openWorkspace(p)
      }, path),
    openFile: (path: string) =>
      page.evaluate(async (f: string) => {
        if (!window.__jetAgent) throw new Error("__jetAgent not present")
        await window.__jetAgent.openFile(f)
      }, path),
    setFontSize: (px: number) =>
      page.evaluate(
        (size: number) => {
          window.__jetAgent!.setFontSize(size)
        },
        px,
      ).then(() => undefined),
    waitForReady: () => page.evaluate(async () => window.__jetAgent!.waitForReady()),
    waitForEditor: (timeoutMs?: number) =>
      page.evaluate(async (ms?: number) => window.__jetAgent!.waitForEditor(ms), timeoutMs),
    getEditorText: () => page.evaluate(() => window.__jetAgent!.getEditorText()),
    setEditorSelection: (line, column) =>
      page.evaluate(
        ({ line, column }) => {
          window.__jetAgent!.setEditorSelection(line, column)
        },
        { line, column },
      ),
    getCursorPosition: () => page.evaluate(() => window.__jetAgent!.getCursorPosition()),
    acceptConfirm: () => page.evaluate(async () => window.__jetAgent!.acceptConfirm()),
    dismissConfirm: () => page.evaluate(async () => window.__jetAgent!.dismissConfirm()),
    readFixtureFile: (relPath: string) =>
      page.evaluate(async (p: string) => window.__jetAgent!.readFixtureFile(p), relPath),
    waitForListRows: (panel, minItems, timeoutMs) =>
      page.evaluate(
        async ({ panel, minItems, timeoutMs }) =>
          window.__jetAgent!.waitForListRows(panel, minItems, timeoutMs),
        { panel, minItems, timeoutMs },
      ),
  }
}
