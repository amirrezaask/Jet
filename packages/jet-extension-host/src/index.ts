import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { CommandRegistry, WorkspaceService } from "@jet/workspace"
import type { JetKeyBinding } from "@jet/workspace"

export type JetAPI = {
  commands: {
    register(name: string, command: (ctx: unknown, args?: unknown) => unknown): void
    execute(name: string, args?: unknown): Promise<void>
  }
  keymaps: {
    register(bindings: JetKeyBinding[]): void
  }
  editor: {
    activeView(): EditorView | null
    extensions: {
      register(extensions: Extension[]): void
    }
  }
  workspace: {
    root(): { uri: string } | null
    openFile(uri: string): Promise<void>
  }
  ui: {
    showMessage(message: string): void
  }
}

export type ExtensionHostContext = {
  workspace: WorkspaceService
  commands: CommandRegistry
  getActiveView: () => EditorView | null
  showMessage: (msg: string) => void
  registerKeymaps: (bindings: JetKeyBinding[]) => void
  registerExtensions: (ext: Extension[]) => void
  openFile: (uri: string) => Promise<void>
}

export function createJetAPI(ctx: ExtensionHostContext): JetAPI {
  return {
    commands: {
      register(name, command) {
        ctx.commands.register(
          name,
          (c, args) => command(c, args),
          { id: name, title: name },
        )
      },
      execute: (name, args) =>
        ctx.commands.execute(name, {
          workspace: ctx.workspace,
          ui: {
            showMessage: ctx.showMessage,
            showCommandPalette: () => {},
            setCommandPaletteOpen: () => {},
          },
          getActiveEditorView: ctx.getActiveView,
        }, args) as Promise<void>,
    },
    keymaps: { register: ctx.registerKeymaps },
    editor: {
      activeView: ctx.getActiveView,
      extensions: { register: ctx.registerExtensions },
    },
    workspace: {
      root: () => (ctx.workspace.root ? { uri: ctx.workspace.root.uri } : null),
      openFile: ctx.openFile,
    },
    ui: { showMessage: ctx.showMessage },
  }
}

export async function loadEditorRc(path: string, jet: JetAPI): Promise<void> {
  try {
    const mod = await import(/* @vite-ignore */ path)
    const setup = mod.default ?? mod.setup
    if (typeof setup === "function") await setup(jet)
  } catch (e) {
    console.warn("Failed to load editorrc:", e)
  }
}
