import type { KeymapContext } from "./context-keys.js"

export type JetKeyBinding = {
  key: string
  command: string
  when?: (ctx: KeymapContext) => boolean
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

export const defaultKeybindings: JetKeyBinding[] = [
  { key: "Mod-p", command: "ui.showCommandPalette", when: ctx => !ctx.paletteOpen },
  { key: "Mod-s", command: "workspace.saveFile", when: ctx => ctx.editorFocus && !ctx.paletteOpen },
  { key: "Mod-n", command: "workspace.newFile", when: ctx => ctx.workspaceOpen && !ctx.paletteOpen },
  { key: "Mod-o", command: "workspace.openFolder", when: ctx => !ctx.paletteOpen },
  { key: "Mod-w", command: "layout.closeTab", when: ctx => ctx.editorFocus && !ctx.paletteOpen },
  { key: "Mod-f", command: "editor.find", when: ctx => ctx.editorFocus && !ctx.paletteOpen },
  { key: "Mod-Shift-f", command: "search.show", when: ctx => ctx.workspaceOpen && !ctx.paletteOpen },
  { key: "Mod-Shift-g", command: "git.showChanges", when: ctx => ctx.workspaceOpen && !ctx.paletteOpen },
  { key: "Mod-Shift-e", command: "explorer.show", when: ctx => ctx.workspaceOpen && !ctx.paletteOpen },
]
