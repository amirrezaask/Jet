import {
  CommandPalette,
  CdOverlay,
  PaletteShell,
  SettingsOverlay,
  bundledThemeList,
  type JetAppearanceSettings,
  type PaletteShellItem,
} from "@yaade/ui"
import type { MuxSwitcherEntry } from "./types.js"

export type MuxOverlaysProps = {
  paletteOpen: boolean
  onPaletteOpenChange: (open: boolean) => void
  paletteCommands: { id: string; title: string; category?: string }[]
  onRunCommand: (id: string) => void
  terminalListOpen: boolean
  onTerminalListOpenChange: (open: boolean) => void
  switcherItems: PaletteShellItem<MuxSwitcherEntry>[]
  onSelectTerminal: (entry: MuxSwitcherEntry) => void
  settingsOpen: boolean
  onSettingsOpenChange: (open: boolean) => void
  appearanceSettings: JetAppearanceSettings
  onAppearanceChange: (settings: JetAppearanceSettings) => void
  onResetAppearance: () => void
  cdOpen: boolean
  onCdOpenChange: (open: boolean) => void
  cdInitialPath: string | null
  onSelectFolder: (path: string) => void | Promise<void>
  resolveHomeDir: () => Promise<string>
}

export default function MuxOverlays(props: MuxOverlaysProps) {
  return (
    <>
      <CommandPalette
        open={props.paletteOpen}
        onOpenChange={props.onPaletteOpenChange}
        commands={props.paletteCommands}
        onRun={id => {
          props.onPaletteOpenChange(false)
          props.onRunCommand(id)
        }}
      />

      <PaletteShell
        open={props.terminalListOpen}
        onOpenChange={props.onTerminalListOpenChange}
        title="Switch terminal"
        description="Jump to an open terminal pane"
        placeholder="Switch terminal…"
        items={props.switcherItems}
        onSelect={entry => {
          props.onTerminalListOpenChange(false)
          props.onSelectTerminal(entry)
        }}
        emptyLabel="No open terminals"
        requireQueryForSelection={false}
        contentClassName="yaade-mux-switcher"
        renderItem={entry => (
          <span className="min-w-0 truncate" data-slot="row-label">
            <span className="text-muted-foreground">{entry.windowTitle}:</span>{" "}
            {entry.title}
          </span>
        )}
      />

      <SettingsOverlay
        open={props.settingsOpen}
        onOpenChange={props.onSettingsOpenChange}
        settings={props.appearanceSettings}
        onSettingsChange={props.onAppearanceChange}
        themes={bundledThemeList}
        onReset={props.onResetAppearance}
      />

      <CdOverlay
        open={props.cdOpen}
        onOpenChange={props.onCdOpenChange}
        initialPath={props.cdInitialPath}
        showFiles={false}
        onSelectFolder={async path => {
          props.onCdOpenChange(false)
          await props.onSelectFolder(path)
        }}
        resolveHomeDir={props.resolveHomeDir}
        title="Change directory"
      />
    </>
  )
}
