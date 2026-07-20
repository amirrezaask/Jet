import type { PanelId } from "@gharargah/shared"

export type JumpEntry = {
  fileUri: string
  line: number
  column: number
  panelId?: PanelId
  label?: string
}

const MAX_ENTRIES = 50

export class JumpStack {
  private back: JumpEntry[] = []
  private forward: JumpEntry[] = []

  push(entry: JumpEntry): void {
    const top = this.back[this.back.length - 1]
    if (
      top &&
      top.fileUri === entry.fileUri &&
      top.line === entry.line &&
      top.column === entry.column &&
      top.panelId?.id === entry.panelId?.id
    ) {
      return
    }
    this.back.push(entry)
    if (this.back.length > MAX_ENTRIES) this.back.shift()
    this.forward.length = 0
  }

  canGoBack(): boolean {
    return this.back.length > 0
  }

  canGoForward(): boolean {
    return this.forward.length > 0
  }

  popBack(current: JumpEntry): JumpEntry | null {
    if (this.back.length === 0) return null
    const entry = this.back.pop()!
    this.forward.push(current)
    return entry
  }

  popForward(current: JumpEntry): JumpEntry | null {
    if (this.forward.length === 0) return null
    const entry = this.forward.pop()!
    this.back.push(current)
    return entry
  }
}
