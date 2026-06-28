import { anyOverlayOpen, type KeymapContext } from "./context-keys.js"

const noOverlay = (ctx: KeymapContext) => !anyOverlayOpen(ctx)

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
  {
    key: "Mod-p",
    command: "workspace.quickOpen",
    when: ctx => ctx.workspaceOpen && noOverlay(ctx),
  },
  {
    key: "Mod-Shift-p",
    command: "ui.showCommandPalette",
    when: noOverlay,
  },
  { key: "Mod-s", command: "workspace.saveFile", when: ctx => ctx.editorFocus && noOverlay(ctx) },
  { key: "Mod-n", command: "workspace.newFile", when: ctx => ctx.workspaceOpen && noOverlay(ctx) },
  { key: "Mod-o", command: "workspace.openFolder", when: noOverlay },
  { key: "Mod-w", command: "layout.closeTab", when: ctx => ctx.workspaceOpen && noOverlay(ctx) },
  { key: "Mod-f", command: "editor.find", when: ctx => ctx.editorFocus && noOverlay(ctx) },
  { key: "Mod-h", command: "editor.replace", when: ctx => ctx.editorFocus && noOverlay(ctx) },
  { key: "Mod-g", command: "editor.gotoLine", when: ctx => ctx.editorFocus && noOverlay(ctx) },
  { key: "Mod-Shift-f", command: "search.show", when: ctx => ctx.workspaceOpen && noOverlay(ctx) },
  { key: "Mod-Shift-g", command: "git.showChanges", when: ctx => ctx.workspaceOpen && noOverlay(ctx) },
  { key: "Mod-Shift-e", command: "explorer.show", when: ctx => ctx.workspaceOpen && noOverlay(ctx) },
]
