import {
  BufferListOverlay,
  CdOverlay,
  CommandPalette,
  GotoLineModal,
  OutlineOverlay,
  ProjectSwitcherOverlay,
  QuickOpenOverlay,
  showJetToast,
  type OutlineEntry,
} from "@jet/ui"
import type { JetProject, WorkspaceFolder, WorkspaceService } from "@jet/workspace"

type PaletteCommand = {
  id: string
  title: string
  category?: string
  keybinding?: string
  aliases?: string[]
  recent?: boolean
}

export type OverlayHostProps = {
  gotoLineOpen: boolean
  onGotoLineOpenChange: (open: boolean) => void
  onGotoLineSubmit: (line: number, column: number) => void
  quickOpenOpen: boolean
  searchSupported: boolean
  searchScanReady: boolean
  onQuickOpenOpenChange: (open: boolean) => void
  onQuickOpenSearch: (query: string) => Promise<string[]>
  onQuickOpenSelect: (displayPath: string, query: string) => void
  bufferListOpen: boolean
  onBufferListOpenChange: (open: boolean) => void
  workspace: WorkspaceService
  onBufferSelect: (uri: string) => void
  openFileOpen: boolean
  onOpenFileOpenChange: (open: boolean) => void
  onOpenFile: (uri: string, path: string) => void
  onRequestOpenFolder: () => void
  folderPickerOpen: boolean
  onFolderPickerOpenChange: (open: boolean) => void
  onFolderPickerSelect: (folder: WorkspaceFolder) => void
  switchFolderOpen: boolean
  onSwitchFolderOpenChange: (open: boolean) => void
  cdOpen: boolean
  onCdOpenChange: (open: boolean) => void
  onSelectFolder: (path: string) => void
  addWorkspaceOpen: boolean
  onAddWorkspaceOpenChange: (open: boolean) => void
  onAddWorkspaceSelect: (path: string) => void
  resolveHomeDir: () => Promise<string>
  projectSwitcherOpen: boolean
  onProjectSwitcherOpenChange: (open: boolean) => void
  projects: JetProject[]
  onSelectProject: (path: string) => void
  outlineOpen: boolean
  onOutlineOpenChange: (open: boolean) => void
  outlineSymbols: OutlineEntry[]
  onOutlineSelect: (line: number) => void
  paletteOpen: boolean
  onPaletteOpenChange: (open: boolean) => void
  paletteCommands: PaletteCommand[]
  onRunCommand: (id: string) => void
}

export default function OverlayHost(props: OverlayHostProps) {
  const workspaceFolders = props.workspace.folders

  return (
    <>
      <GotoLineModal
        open={props.gotoLineOpen}
        onOpenChange={props.onGotoLineOpenChange}
        onSubmit={props.onGotoLineSubmit}
      />

      {props.quickOpenOpen && props.searchSupported ? (
        <QuickOpenOverlay
          open
          onOpenChange={props.onQuickOpenOpenChange}
          scanReady={props.searchScanReady}
          onSearch={props.onQuickOpenSearch}
          onSelect={props.onQuickOpenSelect}
        />
      ) : null}

      {props.bufferListOpen ? (
        <BufferListOverlay
          open
          onOpenChange={props.onBufferListOpenChange}
          workspace={props.workspace}
          onSelect={props.onBufferSelect}
        />
      ) : null}

      {props.openFileOpen ? (
        <CdOverlay
          open
          onOpenChange={props.onOpenFileOpenChange}
          initialPath={props.workspace.root?.path ?? null}
          showFiles
          onSelectFile={(uri, path) => props.onOpenFile(uri, path)}
          onSelectFolder={props.onSelectFolder}
          resolveHomeDir={props.resolveHomeDir}
          title="Open file or folder"
          description="Path to file or folder"
          primaryHint="Open"
        />
      ) : null}

      {props.folderPickerOpen ? (
        <CdOverlay
          open
          onOpenChange={props.onFolderPickerOpenChange}
          initialPath={props.workspace.root?.path ?? null}
          workspaceFolders={workspaceFolders.map(folder => ({
            name: folder.root.name,
            path: folder.root.path,
          }))}
          onSelectFolder={path => {
            const match = props.workspace.folders.find(f => f.root.path === path)
            if (match) props.onFolderPickerSelect(match)
          }}
          resolveHomeDir={props.resolveHomeDir}
          title="Select workspace folder"
          description="Pick a workspace folder"
          primaryHint="Select"
        />
      ) : null}

      {props.switchFolderOpen ? (
        <CdOverlay
          open
          onOpenChange={props.onSwitchFolderOpenChange}
          initialPath={props.workspace.root?.path ?? null}
          workspaceFolders={workspaceFolders.map(folder => ({
            name: folder.root.name,
            path: folder.root.path,
          }))}
          onSelectFolder={path => {
            const match = props.workspace.folders.find(f => f.root.path === path)
            if (match) {
              props.workspace.setActiveFolder(match.id)
              showJetToast(`Active folder: ${match.root.name}`)
            }
          }}
          resolveHomeDir={props.resolveHomeDir}
          title="Switch workspace folder"
          description="Set the active workspace folder"
          primaryHint="Set active"
        />
      ) : null}

      {props.cdOpen ? (
        <CdOverlay
          open
          onOpenChange={props.onCdOpenChange}
          initialPath={props.workspace.root?.path ?? null}
          workspaceFolders={workspaceFolders.map(folder => ({
            name: folder.root.name,
            path: folder.root.path,
          }))}
          onSelectFolder={props.onSelectFolder}
          resolveHomeDir={props.resolveHomeDir}
        />
      ) : null}

      {props.addWorkspaceOpen ? (
        <CdOverlay
          open
          onOpenChange={props.onAddWorkspaceOpenChange}
          initialPath={props.workspace.root?.path ?? null}
          onSelectFolder={props.onAddWorkspaceSelect}
          resolveHomeDir={props.resolveHomeDir}
          title="Add workspace folder"
          description="Pick a folder to add"
          primaryHint="Add Project"
        />
      ) : null}

      {props.projectSwitcherOpen ? (
        <ProjectSwitcherOverlay
          open
          onOpenChange={props.onProjectSwitcherOpenChange}
          projects={props.projects}
          onSelect={props.onSelectProject}
        />
      ) : null}

      {props.outlineOpen ? (
        <OutlineOverlay
          open
          symbols={props.outlineSymbols}
          onOpenChange={props.onOutlineOpenChange}
          onSelect={props.onOutlineSelect}
        />
      ) : null}

      {props.paletteOpen ? (
        <CommandPalette
          open
          onOpenChange={props.onPaletteOpenChange}
          commands={props.paletteCommands}
          onRun={props.onRunCommand}
        />
      ) : null}
    </>
  )
}
