import { useEffect, useMemo, useRef, useState } from "react"
import type { ProjectSearchResult } from "@yaade/shared"
import {
  CommandPalette,
  CdOverlay,
  PaletteShell,
  QuickOpenOverlay,
  type PaletteShellItem,
} from "@yaade/ui"
import {
  bundledThemeList,
  type JetAppearanceSettings,
} from "@yaade/ui/appearance"
import { SettingsOverlay } from "@yaade/ui/settings"
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
  quickOpenOpen?: boolean
  onQuickOpenOpenChange?: (open: boolean) => void
  onQuickOpenSearch?: (query: string) => Promise<string[]>
  onQuickOpenSelect?: (path: string) => void
  projectSearchOpen?: boolean
  onProjectSearchOpenChange?: (open: boolean) => void
  onProjectSearch?: (query: string) => Promise<ProjectSearchResult[]>
  onProjectSearchSelect?: (result: ProjectSearchResult) => void
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

      {props.settingsOpen ? (
        <SettingsOverlay
          open
          onOpenChange={props.onSettingsOpenChange}
          settings={props.appearanceSettings}
          onSettingsChange={props.onAppearanceChange}
          themes={bundledThemeList}
          onReset={props.onResetAppearance}
        />
      ) : null}

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

      {props.onQuickOpenSearch && props.onQuickOpenSelect ? (
        <QuickOpenOverlay
          open={props.quickOpenOpen ?? false}
          onOpenChange={props.onQuickOpenOpenChange ?? (() => {})}
          onSearch={query => props.onQuickOpenSearch!(query)}
          onSelect={path => {
            props.onQuickOpenOpenChange?.(false)
            props.onQuickOpenSelect!(path)
          }}
        />
      ) : null}

      {props.onProjectSearch && props.onProjectSearchSelect ? (
        <MuxProjectSearchOverlay
          open={props.projectSearchOpen ?? false}
          onOpenChange={props.onProjectSearchOpenChange ?? (() => {})}
          onSearch={props.onProjectSearch}
          onSelect={result => {
            props.onProjectSearchOpenChange?.(false)
            props.onProjectSearchSelect!(result)
          }}
        />
      ) : null}
    </>
  )
}

function MuxProjectSearchOverlay(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSearch: (query: string) => Promise<ProjectSearchResult[]>
  onSelect: (result: ProjectSearchResult) => void
}) {
  const { open, onOpenChange, onSearch, onSelect } = props
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<ProjectSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const gen = useRef(0)

  useEffect(() => {
    if (!open) {
      setQuery("")
      setResults([])
      setSearching(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const g = ++gen.current
    if (!query.trim()) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    let cancelled = false
    void (async () => {
      try {
        const found = await onSearch(query)
        if (cancelled || g !== gen.current) return
        setResults(found)
      } catch {
        if (!cancelled && g === gen.current) setResults([])
      } finally {
        if (!cancelled && g === gen.current) setSearching(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, query, onSearch])

  const items = useMemo<PaletteShellItem<ProjectSearchResult>[]>(
    () =>
      results.map((r, i) => ({
        key: `${r.path}:${r.line}:${r.column}:${i}`,
        value: `${r.path}:${r.line} ${r.preview}`,
        data: r,
      })),
    [results],
  )

  return (
    <PaletteShell
      open={open}
      onOpenChange={onOpenChange}
      title="Search in files"
      description="Search project file contents"
      placeholder="Search text…"
      query={query}
      onQueryChange={setQuery}
      items={items}
      shouldFilter={false}
      onSelect={result => onSelect(result)}
      emptyLabel={
        searching
          ? "Searching…"
          : query.trim()
            ? "No matches."
            : "Type to search project files…"
      }
      contentWidthMono
      renderItem={result => (
        <span className="flex min-w-0 items-baseline gap-2 font-mono">
          <span className="shrink-0 text-muted-foreground">
            {result.path}:{result.line}
          </span>
          <span className="min-w-0 truncate">{result.preview}</span>
        </span>
      )}
    />
  )
}
