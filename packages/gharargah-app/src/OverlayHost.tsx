import {
  CommandPalette,
  CdOverlay,
  ProjectSwitcherOverlay,
  SettingsOverlay,
  TerminalListOverlay,
  showGharargahToast,
  bundledThemeList,
} from "@gharargah/ui"
import { useOverlayController } from "./hooks/OverlayController.js"

export default function OverlayHost() {
  const { state, workspace, handlers } = useOverlayController()
  const { open, appearanceSettings, projects, paletteCommands, terminalGroups } = state
  const workspaceFolders = workspace.folders

  return (
    <>
      {open.terminalList ? (
        <TerminalListOverlay
          open
          onOpenChange={v => handlers.setOverlayOpen("terminalList", v)}
          groups={terminalGroups}
          onSelect={handlers.onTerminalSelect}
        />
      ) : null}

      {open.folderPicker ? (
        <CdOverlay
          open
          onOpenChange={handlers.onFolderPickerOpenChange}
          initialPath={workspace.root?.path ?? null}
          workspaceFolders={workspaceFolders.map(folder => ({
            name: folder.root.name,
            path: folder.root.path,
          }))}
          onSelectFolder={path => {
            const match = workspace.folders.find(f => f.root.path === path)
            if (match) handlers.onFolderPickerSelect(match)
          }}
          resolveHomeDir={handlers.resolveHomeDir}
          title="Select workspace folder"
          description="Pick a workspace folder"
          primaryHint="Select"
        />
      ) : null}

      {open.switchFolder ? (
        <CdOverlay
          open
          onOpenChange={v => handlers.setOverlayOpen("switchFolder", v)}
          initialPath={workspace.root?.path ?? null}
          workspaceFolders={workspaceFolders.map(folder => ({
            name: folder.root.name,
            path: folder.root.path,
          }))}
          onSelectFolder={path => {
            const match = workspace.folders.find(f => f.root.path === path)
            if (match) {
              workspace.setActiveFolder(match.id)
              showGharargahToast(`Active folder: ${match.root.name}`)
            }
          }}
          resolveHomeDir={handlers.resolveHomeDir}
          title="Switch workspace folder"
          description="Set the active workspace folder"
          primaryHint="Set active"
        />
      ) : null}

      {open.cd ? (
        <CdOverlay
          open
          onOpenChange={v => handlers.setOverlayOpen("cd", v)}
          initialPath={workspace.root?.path ?? null}
          workspaceFolders={workspaceFolders.map(folder => ({
            name: folder.root.name,
            path: folder.root.path,
          }))}
          onSelectFolder={handlers.onSelectFolder}
          resolveHomeDir={handlers.resolveHomeDir}
        />
      ) : null}

      {open.addWorkspace ? (
        <CdOverlay
          open
          onOpenChange={v => handlers.setOverlayOpen("addWorkspace", v)}
          initialPath={workspace.root?.path ?? null}
          onSelectFolder={handlers.onAddWorkspaceSelect}
          resolveHomeDir={handlers.resolveHomeDir}
          title="Add workspace folder"
          description="Pick a folder to add"
          primaryHint="Add Project"
        />
      ) : null}

      {open.settings ? (
        <SettingsOverlay
          open
          onOpenChange={v => handlers.setOverlayOpen("settings", v)}
          themes={bundledThemeList}
          settings={appearanceSettings}
          onSettingsChange={handlers.onAppearanceSettingsChange}
          onReset={handlers.onResetAppearanceSettings}
        />
      ) : null}

      {open.projectSwitcher ? (
        <ProjectSwitcherOverlay
          open
          onOpenChange={v => handlers.setOverlayOpen("projectSwitcher", v)}
          projects={projects}
          onSelect={handlers.onSelectProject}
        />
      ) : null}

      {open.palette ? (
        <CommandPalette
          open
          onOpenChange={v => handlers.setOverlayOpen("palette", v)}
          commands={paletteCommands}
          onRun={handlers.onRunCommand}
        />
      ) : null}
    </>
  )
}
