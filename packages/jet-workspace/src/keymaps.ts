import type { JetCommandFn } from "./commands.js"

export type { JetCommandFn } from "./commands.js"

export type JetKeyBinding = {
  key: string
  run: JetCommandFn
  when?: (ctx: import("./context-keys.js").KeymapContext) => boolean
}

export function bind(
  key: string,
  run: JetCommandFn,
  when?: (ctx: import("./context-keys.js").KeymapContext) => boolean,
): JetKeyBinding {
  return { key, run, when }
}

export class KeymapService {
  private layers: JetKeyBinding[][] = [[], [], []]

  registerUser(bindings: JetKeyBinding[]): void {
    this.layers[1] = bindings
  }

  registerExtension(bindings: JetKeyBinding[]): void {
    this.layers[2] = bindings
  }

  allBindings(): JetKeyBinding[] {
    return [...this.layers[2], ...this.layers[1], ...this.layers[0]]
  }
}

export { createDefaultKeybindings, VSCODE_COMMAND_IDS } from "./default-keybindings.js"
export { withVscodeStubs, noopCommand, type JetCommands } from "./jet-commands.js"
