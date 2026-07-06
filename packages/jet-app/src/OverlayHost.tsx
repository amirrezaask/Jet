import {
  BufferListOverlay,
  CdOverlay,
  CommandPalette,
  GotoLineModal,
  OpenFileOverlay,
  OutlineOverlay,
  ProjectSwitcherOverlay,
  QuickOpenOverlay,
  WorkspaceFolderPickerOverlay,
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
        <OpenFileOverlay
          open
          onOpenChange={props.onOpenFileOpenChange}
          workspace={props.workspace}
          onOpenFile={props.onOpenFile}
          onOpenFolder={props.onRequestOpenFolder}
        />
      ) : null}

      {props.folderPickerOpen ? (
        <WorkspaceFolderPickerOverlay
          open
          onOpenChange={props.onFolderPickerOpenChange}
          folders={workspaceFolders}
          title="Select workspace folder"
          onSelect={props.onFolderPickerSelect}
        />
      ) : null}

      {props.switchFolderOpen ? (
        <WorkspaceFolderPickerOverlay
          open
          onOpenChange={props.onSwitchFolderOpenChange}
          folders={workspaceFolders}
          title="Switch workspace folder"
          description="Set the active workspace folder"
          onSelect={folder => {
            props.workspace.setActiveFolder(folder.id)
            showJetToast(`Active folder: ${folder.root.name}`)
          }}
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
