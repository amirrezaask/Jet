import type { WorkspaceService } from "./workspace.js"

export type JetUI = {
  showMessage(message: string): void
  showCommandPalette(): void
  setCommandPaletteOpen(open: boolean): void
}

export type JetCommandContext = {
  workspace: WorkspaceService
  ui: JetUI
  getActiveEditorView: () => unknown
}

export type JetCommand = (ctx: JetCommandContext, args?: unknown) => unknown | Promise<unknown>

export type JetCommandFn = (ctx: JetCommandContext) => void | Promise<void>

export type CommandInfo = {
  id: string
  title: string
  category?: string
  aliases?: string[]
  keywords?: string[]
  when?: (ctx: JetCommandContext) => boolean
}

export class CommandRegistry {
  private commands = new Map<string, JetCommand>()
  private infos = new Map<string, CommandInfo>()

  register(id: string, command: JetCommand, info: CommandInfo): { dispose: () => void } {
    this.commands.set(id, command)
    this.infos.set(id, info)
    return {
      dispose: () => {
        this.commands.delete(id)
        this.infos.delete(id)
      },
    }
  }

  has(id: string): boolean {
    return this.commands.has(id)
  }

  async execute(id: string, ctx: JetCommandContext, args?: unknown): Promise<unknown> {
    const cmd = this.commands.get(id)
    if (!cmd) throw new Error(`Unknown command: ${id}`)
    return cmd(ctx, args)
  }

  list(ctx?: JetCommandContext): CommandInfo[] {
    const infos = [...this.infos.values()]
    if (!ctx) return infos
    return infos.filter(info => info.when?.(ctx) ?? true)
  }
}
