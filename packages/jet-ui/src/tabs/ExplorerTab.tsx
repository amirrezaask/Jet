import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { registerListPanel } from "@/lib/list-registry.js"
import { EXPLORER_LIST_ID } from "@/explorer/focus.js"
import { ChevronRight, File, Folder } from "lucide-react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { WorkspaceEntry, WorkspaceManager } from "@jet/workspace"
import { SidebarContent, SidebarMenuSubButton, SidebarProvider } from "@/components/ui/sidebar.js"
import { jetInteractiveRowClass } from "@/motion/tokens.js"
import { cn } from "@/lib/utils.js"

type FlatRow = {
  uri: string
  name: string
  path: string
  depth: number
  isDirectory: boolean
  expanded: boolean
  loading: boolean
  isWorkspaceRoot?: boolean
}

const OVERSCAN = 8

function readRowHeightPx(): number {
  const root = document.documentElement
  const fontSize = parseFloat(getComputedStyle(root).fontSize)
  const raw = getComputedStyle(root).getPropertyValue("--jet-row-height").trim()
  if (raw.endsWith("rem")) return parseFloat(raw) * fontSize
  const px = parseFloat(raw)
  return Number.isFinite(px) ? px : fontSize * 1.692
}

function sortEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return entries
    .filter(e => !e.name.startsWith("."))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

function toPath(uri: string): string {
  return uri.replace(/^file:\/\//, "")
}

class ExplorerModel {
  private readonly manager: WorkspaceManager
  private readonly childCache = new Map<string, WorkspaceEntry[]>()
  private readonly loading = new Set<string>()
  private readonly expanded = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private rootUris: string[] = []

  constructor(manager: WorkspaceManager) {
    this.manager = manager
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const l of this.listeners) l()
  }

  setRootUris(uris: string[]): void {
    this.rootUris = uris
  }

  isExpanded(uri: string): boolean {
    return this.expanded.has(uri)
  }

  isLoading(uri: string): boolean {
    return this.loading.has(uri)
  }

  childrenOf(uri: string): WorkspaceEntry[] | null {
    return this.childCache.get(uri) ?? null
  }

  async ensureChildren(uri: string): Promise<void> {
    if (this.childCache.has(uri) || this.loading.has(uri)) return
    this.loading.add(uri)
    this.notify()
    try {
      const entries = await this.manager.readDir(uri)
      this.childCache.set(uri, sortEntries(entries))
    } finally {
      this.loading.delete(uri)
      this.notify()
    }
  }

  async toggle(uri: string): Promise<void> {
    if (this.expanded.has(uri)) {
      this.expanded.delete(uri)
      this.notify()
      return
    }
    this.expanded.add(uri)
    this.notify()
    await this.ensureChildren(uri)
  }

  invalidateRoots(): void {
    this.childCache.clear()
    this.expanded.clear()
    this.notify()
  }

  flattenVisible(): FlatRow[] {
    const rows: FlatRow[] = []
    for (const rootUri of this.rootUris) {
      const folder = this.manager.folders.find(f => f.root.uri === rootUri)
      if (!folder) continue
      const expanded = this.expanded.has(rootUri)
      rows.push({
        uri: rootUri,
        name: folder.root.name,
        path: folder.root.path,
        depth: 0,
        isDirectory: true,
        expanded,
        loading: this.loading.has(rootUri),
        isWorkspaceRoot: true,
      })
      if (!expanded) continue
      const rootChildren = this.childCache.get(rootUri)
      if (!rootChildren) continue
      const walk = (entries: WorkspaceEntry[], depth: number): void => {
        for (const entry of entries) {
          const entryExpanded = this.expanded.has(entry.uri)
          rows.push({
            uri: entry.uri,
            name: entry.name,
            path: toPath(entry.uri),
            depth,
            isDirectory: entry.isDirectory,
            expanded: entryExpanded,
            loading: this.loading.has(entry.uri),
          })
          if (entry.isDirectory && entryExpanded) {
            const children = this.childCache.get(entry.uri)
            if (children) walk(children, depth + 1)
          }
        }
      }
      walk(rootChildren, 1)
    }
    return rows
  }
}

export function ExplorerTree({
  manager,
  onOpenFile,
}: {
  manager: WorkspaceManager
  onOpenFile: (uri: string, path: string) => void
}) {
  const rootUris = manager.folders.map(f => f.root.uri)
  const modelRef = useRef<ExplorerModel | null>(null)
  if (modelRef.current === null) modelRef.current = new ExplorerModel(manager)
  const model = modelRef.current
  const [rev, setRev] = useState(0)

  useEffect(() => model.subscribe(() => setRev(r => r + 1)), [model])

  useEffect(() => {
    model.setRootUris(rootUris)
    model.invalidateRoots()
    for (const uri of rootUris) {
      void model.toggle(uri)
    }
  }, [rootUris.join("|"), model])

  useEffect(() => {
    const sub = manager.onDidChangeFolders.event(() => {
      model.setRootUris(manager.folders.map(f => f.root.uri))
      model.invalidateRoots()
      for (const f of manager.folders) {
        void model.toggle(f.root.uri)
      }
    })
    return () => sub.dispose()
  }, [manager, model])

  const rows: FlatRow[] = useMemo(() => {
    void rev
    if (rootUris.length === 0) return []
    return model.flattenVisible()
  }, [rev, rootUris.length, model])

  const contentRef = useRef<HTMLDivElement | null>(null)
  const [rowHeight, setRowHeight] = useState(readRowHeightPx)

  useLayoutEffect(() => {
    setRowHeight(readRowHeightPx())
  }, [])

  useEffect(() => registerListPanel(EXPLORER_LIST_ID, contentRef.current), [rootUris.length])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => contentRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
  })

  const onRowClick = useCallback(
    (row: FlatRow) => {
      if (row.isDirectory) void model.toggle(row.uri)
      else onOpenFile(row.uri, row.path)
    },
    [model, onOpenFile],
  )

  if (rootUris.length === 0) return null

  const anyLoading =
    rootUris.some(uri => model.isLoading(uri) || model.childrenOf(uri) === null) &&
    rows.length <= rootUris.length

  return (
    <SidebarContent
      ref={contentRef}
      className="min-h-0 overflow-auto"
      data-jet-list-panel="explorer"
      tabIndex={-1}
      role="tree"
      aria-label="Explorer"
    >
      {anyLoading && rows.length === 0 ? (
        <div className="p-2 text-xs text-muted-foreground">Loading…</div>
      ) : (
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map(v => {
            const row = rows[v.index]!
            return (
              <ExplorerRow
                key={row.uri}
                row={row}
                offset={v.start}
                rowHeight={rowHeight}
                onClick={onRowClick}
              />
            )
          })}
        </div>
      )}
    </SidebarContent>
  )
}

function ExplorerRow({
  row,
  offset,
  rowHeight,
  onClick,
}: {
  row: FlatRow
  offset: number
  rowHeight: number
  onClick: (row: FlatRow) => void
}) {
  return (
    <SidebarMenuSubButton
      asChild
      size="sm"
      className={cn(
        "absolute left-0 top-0 h-[var(--jet-row-height)] w-full shrink-0 cursor-pointer gap-1 rounded-sm px-2",
        jetInteractiveRowClass,
      )}
      style={{
        transform: `translateY(${offset}px)`,
        height: rowHeight,
        paddingLeft: 4 + row.depth * 12,
      }}
    >
      <div
        role="treeitem"
        aria-level={row.depth + 1}
        aria-expanded={row.isDirectory ? row.expanded : undefined}
        data-jet-list-item
        data-uri={row.uri}
        aria-label={row.name}
        onClick={() => onClick(row)}
        title={row.isWorkspaceRoot ? row.path : row.name}
      >
        {row.isDirectory ? (
          <>
            <ChevronRight
              className={cn(
                "size-3 shrink-0 transition-transform",
                row.expanded && "rotate-90",
              )}
            />
            <Folder className={cn("size-3.5 shrink-0", row.isWorkspaceRoot && "text-foreground")} />
          </>
        ) : (
          <>
            <span className="size-3 shrink-0" />
            <File className="size-3.5 shrink-0" />
          </>
        )}
        <span className={cn("truncate", row.isWorkspaceRoot && "font-medium text-foreground")}>
          {row.name}
        </span>
        {row.loading ? <span className="ml-auto text-muted-foreground/60">…</span> : null}
      </div>
    </SidebarMenuSubButton>
  )
}

export function ExplorerTab({
  manager,
  onOpenFile,
}: {
  manager: WorkspaceManager
  onOpenFile: (uri: string, path: string) => void
}) {
  if (!manager.hasFolders()) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
        <p>Open a folder to browse files</p>
        <p className="text-xs">
          Use the command palette or <strong>Open Folder</strong>.
        </p>
      </div>
    )
  }

  return (
    <SidebarProvider className="!min-h-0 flex h-full w-full min-h-0 flex-col">
      <ExplorerTree manager={manager} onOpenFile={onOpenFile} />
    </SidebarProvider>
  )
}
