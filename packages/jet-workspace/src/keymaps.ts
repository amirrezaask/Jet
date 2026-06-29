import type { JetCommandFn } from "./commands.js"
import { Emitter } from "@jet/shared"

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
  readonly onDidChange = new Emitter<void>()

  registerUser(bindings: JetKeyBinding[]): void {
    this.layers[1] = bindings
    this.onDidChange.fire()
  }

  registerExtension(bindings: JetKeyBinding[]): void {
    this.layers[2] = bindings
    this.onDidChange.fire()
  }

  allBindings(): JetKeyBinding[] {
    return [...this.layers[2], ...this.layers[1], ...this.layers[0]]
  }
}

export { createDefaultKeybindings } from "./default-keybindings.js"
export { type JetCommands } from "./jet-commands.js"
