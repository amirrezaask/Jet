import type { Extension } from "@codemirror/state"
import { pathToFileUri } from "@jet/shared"
import type {
  CommandRegistry,
  JetCommandContext,
  JetCommands,
  JetKeyBinding,
  WorkspaceService,
} from "@jet/workspace"

/** Handles passed to `.jet/editorrc.ts` — same registries Jet uses internally. Import `bind` from `@jet/workspace` in init code. */
export type JetInitContext = {
  workspace: WorkspaceService
  commands: CommandRegistry
  appCommands: JetCommands
  getCommandContext: () => JetCommandContext
  addKeybindings(bindings: JetKeyBinding[]): void
  addEditorExtensions(extensions: Extension[]): void
  openFile(uri: string): Promise<void>
  showMessage(message: string): void
}

const INIT_FILES = ["init.ts", "init.js", "editorrc.ts"] as const

export async function loadWorkspaceInit(
  jetDir: string,
  ctx: JetInitContext,
): Promise<void> {
  const fs = typeof window !== "undefined" ? window.jet?.fs : undefined
  for (const file of INIT_FILES) {
    const path = `${jetDir}/${file}`
    if (fs) {
      try {
        await fs.stat(pathToFileUri(path))
      } catch {
        continue
      }
    }
    try {
      const mod = await import(/* @vite-ignore */ path)
      const setup = mod.default ?? mod.setup
      if (typeof setup === "function") {
        await setup(ctx)
        return
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes("Failed to fetch") || msg.includes("Cannot find module")) continue
      console.warn(`Workspace init failed (${path}):`, e)
      return
    }
  }
}
