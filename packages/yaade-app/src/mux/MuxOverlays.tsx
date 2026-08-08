import { useEffect, useMemo, useRef, useState } from "react"
import type {
  ProjectSearchOptions,
  ProjectSearchResult,
  SearchPage,
} from "@yaade/shared"
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
import { Button, Checkbox, Input } from "@yaade/ui/primitives"
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
  onQuickOpenSearch?: (query: string, signal: AbortSignal) => Promise<string[]>
  onQuickOpenSelect?: (path: string) => void
  projectSearchOpen?: boolean
  onProjectSearchOpenChange?: (open: boolean) => void
  onProjectSearch?: (
    query: string,
    options: ProjectSearchOptions,
    signal: AbortSignal,
  ) => Promise<SearchPage<ProjectSearchResult>>
  onProjectSearchSelect?: (result: ProjectSearchResult) => void
  onProjectSearchPreviewReplace?: (
    results: ProjectSearchResult[],
    replacement: string,
  ) => Promise<{ fileCount: number; editCount: number }>
  onProjectSearchApplyReplace?: () => Promise<void>
  onProjectSearchUndoReplace?: () => Promise<void>
  saveAsOpen?: boolean
  onSaveAsOpenChange?: (open: boolean) => void
  saveAsRootPath?: string
  onSaveAsTarget?: (path: string) => void | Promise<void>
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

      {props.saveAsOpen && props.saveAsRootPath && props.onSaveAsTarget ? (
        <CdOverlay
          open
          onOpenChange={props.onSaveAsOpenChange ?? (() => {})}
          initialPath={props.saveAsRootPath}
          showFiles
          onSelectFolder={props.onSaveAsTarget}
          onSelectFile={(_uri, path) => props.onSaveAsTarget!(path)}
          resolveHomeDir={async () => props.saveAsRootPath!}
          restrictToRootPath={props.saveAsRootPath}
          title="Save As"
          description="Create a file inside the current session"
          primaryHint="Save"
        />
      ) : null}

      {props.onQuickOpenSearch && props.onQuickOpenSelect ? (
        <QuickOpenOverlay
          open={props.quickOpenOpen ?? false}
          onOpenChange={props.onQuickOpenOpenChange ?? (() => {})}
          onSearch={(query, _workspaceId, signal) =>
            props.onQuickOpenSearch!(query, signal)
          }
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
          onPreviewReplace={props.onProjectSearchPreviewReplace}
          onApplyReplace={props.onProjectSearchApplyReplace}
          onUndoReplace={props.onProjectSearchUndoReplace}
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
  onSearch: (
    query: string,
    options: ProjectSearchOptions,
    signal: AbortSignal,
  ) => Promise<SearchPage<ProjectSearchResult>>
  onSelect: (result: ProjectSearchResult) => void
  onPreviewReplace?: (
    results: ProjectSearchResult[],
    replacement: string,
  ) => Promise<{ fileCount: number; editCount: number }>
  onApplyReplace?: () => Promise<void>
  onUndoReplace?: () => Promise<void>
}) {
  const {
    open,
    onOpenChange,
    onSearch,
    onSelect,
    onPreviewReplace,
    onApplyReplace,
    onUndoReplace,
  } = props
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<ProjectSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [fuzzy, setFuzzy] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [include, setInclude] = useState("")
  const [exclude, setExclude] = useState("")
  const [replacement, setReplacement] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [replacePreview, setReplacePreview] = useState<{
    fileCount: number
    editCount: number
  } | null>(null)
  const [replaceError, setReplaceError] = useState<string | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const gen = useRef(0)

  const options = useMemo<ProjectSearchOptions>(() => ({
    caseSensitive,
    regex: fuzzy ? false : regex,
    fuzzy,
    wholeWord,
    include: include.split(",").map(value => value.trim()).filter(Boolean),
    exclude: exclude.split(",").map(value => value.trim()).filter(Boolean),
  }), [caseSensitive, exclude, fuzzy, include, regex, wholeWord])

  useEffect(() => {
    if (!open) {
      setQuery("")
      setResults([])
      setSearching(false)
      setTruncated(false)
      setSelected(new Set())
      setReplacePreview(null)
      setReplaceError(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const g = ++gen.current
    if (!query.trim()) {
      setResults([])
      setSearching(false)
      setTruncated(false)
      setSelected(new Set())
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearching(true)
      void onSearch(query, options, controller.signal).then(
        page => {
          if (controller.signal.aborted || g !== gen.current) return
          setResults(page.items)
          setTruncated(page.truncated)
          setSelected(new Set(page.items.map((_, index) => String(index))))
        },
        () => {
          if (controller.signal.aborted || g !== gen.current) return
          setResults([])
          setTruncated(false)
          setSelected(new Set())
        },
      ).finally(() => {
        if (!controller.signal.aborted && g === gen.current) setSearching(false)
      })
    }, 120)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, query, onSearch, options, refresh])

  useEffect(() => {
    setReplacePreview(null)
    setReplaceError(null)
  }, [query, replacement, selected, options])

  const rows = useMemo(
    () => results.map((result, index) => ({
      result,
      index,
      key: String(index),
    })),
    [results],
  )
  const selectedResults = useMemo(
    () => rows.filter(row => selected.has(row.key)).map(row => row.result),
    [rows, selected],
  )

  const items = useMemo<PaletteShellItem<(typeof rows)[number]>[]>(
    () =>
      rows.map(row => ({
        key: `${row.result.path}:${row.result.line}:${row.result.column}:${row.index}`,
        value: `${row.result.path}:${row.result.line} ${row.result.preview}`,
        data: row,
      })),
    [rows],
  )

  const previewSelected = async () => {
    if (!onPreviewReplace || fuzzy || selectedResults.length === 0) return
    setReplacing(true)
    setReplaceError(null)
    try {
      setReplacePreview(await onPreviewReplace(selectedResults, replacement))
    } catch (error) {
      setReplaceError(error instanceof Error ? error.message : String(error))
    } finally {
      setReplacing(false)
    }
  }

  const applyPreview = async () => {
    if (!onApplyReplace || !replacePreview) return
    setReplacing(true)
    setReplaceError(null)
    try {
      await onApplyReplace()
      setReplacePreview(null)
      setRefresh(value => value + 1)
    } catch (error) {
      setReplaceError(error instanceof Error ? error.message : String(error))
    } finally {
      setReplacing(false)
    }
  }

  const statusRow = (
    <div
      className="flex flex-col gap-2 border-b border-border p-2"
      data-yaade-project-search-controls
    >
      <div className="flex flex-wrap items-center gap-1">
        {[
          ["Case", caseSensitive, () => setCaseSensitive(value => !value)],
          ["Regex", regex, () => { setRegex(value => !value); setFuzzy(false) }],
          ["Fuzzy", fuzzy, () => { setFuzzy(value => !value); setRegex(false) }],
          ["Whole", wholeWord, () => setWholeWord(value => !value)],
        ].map(([label, active, toggle]) => (
          <Button
            key={String(label)}
            type="button"
            size="sm"
            variant={active ? "secondary" : "ghost"}
            className="h-7 px-2 text-xs"
            aria-pressed={Boolean(active)}
            onClick={toggle as () => void}
          >
            {String(label)}
          </Button>
        ))}
        {truncated ? (
          <span className="ml-auto text-xs text-muted-foreground" role="status">
            First 200 matches
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          aria-label="Files to include"
          value={include}
          onChange={event => setInclude(event.target.value)}
          placeholder="Include: src/**"
          className="h-7 font-mono text-xs"
        />
        <Input
          aria-label="Files to exclude"
          value={exclude}
          onChange={event => setExclude(event.target.value)}
          placeholder="Exclude: **/*.test.ts"
          className="h-7 font-mono text-xs"
        />
      </div>
      {onPreviewReplace ? (
        <div className="flex items-center gap-2">
          <Input
            aria-label="Replace with"
            value={replacement}
            onChange={event => setReplacement(event.target.value)}
            placeholder={fuzzy ? "Replace is unavailable for fuzzy search" : "Replace with…"}
            disabled={fuzzy}
            className="h-7 min-w-0 flex-1 font-mono text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={fuzzy || replacing || selectedResults.length === 0}
            onClick={() => void previewSelected()}
          >
            Preview {selectedResults.length}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!replacePreview || replacing}
            onClick={() => void applyPreview()}
          >
            Apply
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={replacing || !onUndoReplace}
            onClick={() => {
              setReplacing(true)
              void onUndoReplace?.().then(
                () => setRefresh(value => value + 1),
                error => setReplaceError(error instanceof Error ? error.message : String(error)),
              ).finally(() => setReplacing(false))
            }}
          >
            Undo replace
          </Button>
        </div>
      ) : null}
      {replacePreview ? (
        <p className="text-xs text-muted-foreground" role="status">
          Preview: {replacePreview.editCount} edits in {replacePreview.fileCount} files.
        </p>
      ) : null}
      {replaceError ? (
        <p className="text-xs text-destructive" role="alert">{replaceError}</p>
      ) : null}
    </div>
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
      onSelect={row => onSelect(row.result)}
      emptyLabel={
        searching
          ? "Searching…"
          : query.trim()
            ? "No matches."
            : "Type to search project files…"
      }
      statusRow={statusRow}
      contentWidthMono
      renderItem={row => (
        <span className="flex min-w-0 items-baseline gap-2 font-mono">
          <Checkbox
            checked={selected.has(row.key)}
            aria-label={`Select ${row.result.path}:${row.result.line}`}
            onClick={event => event.stopPropagation()}
            onCheckedChange={checked => {
              setSelected(current => {
                const next = new Set(current)
                if (checked) next.add(row.key)
                else next.delete(row.key)
                return next
              })
            }}
          />
          <span className="shrink-0 text-muted-foreground">
            {row.result.path}:{row.result.line}
          </span>
          <span className="min-w-0 truncate">{row.result.preview}</span>
        </span>
      )}
    />
  )
}
