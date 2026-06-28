export type JetKeyBinding = {
  key: string
  command: string
  when?: string
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
  { key: "Mod-p", command: "ui.showCommandPalette" },
  { key: "Mod-s", command: "workspace.saveFile" },
  { key: "Mod-o", command: "workspace.openFolder" },
  { key: "Mod-w", command: "layout.closeTab" },
  { key: "Mod-Shift-g", command: "git.showChanges" },
  { key: "Mod-Shift-e", command: "explorer.show" },
]
