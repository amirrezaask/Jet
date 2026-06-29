import { Text, type ChangeSet } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { LSPPlugin, Workspace, type LSPClient } from "@codemirror/lsp-client"
import { fileUriToPath } from "@jet/shared"

export type JetLspWorkspaceDeps = {
  openFile: (uri: string, path: string, line?: number, column?: number) => void
  readFile: (uri: string) => Promise<string>
  getLanguageId: (uri: string) => string
}

class JetLspWorkspaceFile {
  doc: Text
  private view: EditorView | null

  constructor(
    readonly uri: string,
    readonly languageId: string,
    public version: number,
    doc: Text,
    view: EditorView | null,
  ) {
    this.doc = doc
    this.view = view
  }

  getView(_main?: EditorView): EditorView | null {
    return this.view
  }

  setView(view: EditorView | null): void {
    this.view = view
  }
}

export class JetLspWorkspace extends Workspace {
  files: JetLspWorkspaceFile[] = []
  private fileVersions: Record<string, number> = Object.create(null)

  constructor(
    client: LSPClient,
    private deps: JetLspWorkspaceDeps,
  ) {
    super(client)
  }

  private nextFileVersion(uri: string): number {
    this.fileVersions[uri] = (this.fileVersions[uri] ?? -1) + 1
    return this.fileVersions[uri]!
  }

  syncFiles(): { file: JetLspWorkspaceFile; prevDoc: Text; changes: ChangeSet }[] {
    const result: { file: JetLspWorkspaceFile; prevDoc: Text; changes: ChangeSet }[] = []
    for (const file of this.files) {
      const view = file.getView()
      if (!view) continue
      const plugin = LSPPlugin.get(view)
      if (!plugin) continue
      const changes = plugin.unsyncedChanges
      if (!changes.empty) {
        result.push({ changes, file, prevDoc: file.doc })
        file.doc = view.state.doc
        file.version = this.nextFileVersion(file.uri)
        plugin.clear()
      }
    }
    return result
  }

  openFile(uri: string, languageId: string, view: EditorView): void {
    const existing = this.getFile(uri) as JetLspWorkspaceFile | null
    if (existing) {
      existing.setView(view)
      existing.doc = view.state.doc
      return
    }
    const file = new JetLspWorkspaceFile(
      uri,
      languageId,
      this.nextFileVersion(uri),
      view.state.doc,
      view,
    )
    this.files.push(file)
    this.client.didOpen(file)
  }

  closeFile(uri: string, view: EditorView): void {
    const file = this.getFile(uri) as JetLspWorkspaceFile | null
    if (!file || file.getView() !== view) return
    this.files = this.files.filter(f => f !== file)
    this.client.didClose(uri)
  }

  override async requestFile(uri: string): Promise<JetLspWorkspaceFile | null> {
    const existing = this.getFile(uri) as JetLspWorkspaceFile | null
    if (existing) return existing
    try {
      const text = await this.deps.readFile(uri)
      const languageId = this.deps.getLanguageId(uri)
      const file = new JetLspWorkspaceFile(
        uri,
        languageId,
        this.nextFileVersion(uri),
        Text.of(text.replace(/\r\n/g, "\n").split("\n")),
        null,
      )
      this.files.push(file)
      this.client.didOpen(file)
      return file
    } catch {
      return null
    }
  }

  override async displayFile(uri: string): Promise<EditorView | null> {
    const existing = this.getFile(uri) as JetLspWorkspaceFile | null
    if (existing?.getView()) return existing.getView()

    const path = fileUriToPath(uri)
    this.deps.openFile(uri, path)
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 16))
      const file = this.getFile(uri) as JetLspWorkspaceFile | null
      const view = file?.getView()
      if (view) return view
    }
    return null
  }
}
