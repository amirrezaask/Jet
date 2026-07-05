import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { registerListPanel } from "@/lib/list-registry.js"
import { EXPLORER_LIST_ID } from "@/explorer/focus.js"
import { ChevronRight, File, Folder } from "lucide-react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { WorkspaceEntry, WorkspaceService } from "@jet/workspace"
import { SidebarContent, SidebarProvider } from "@/components/ui/sidebar.js"
import { cn } from "@/lib/utils.js"

type FlatRow = {
  uri: string
  name: string
  path: string
  depth: number
  isDirectory: boolean
  expanded: boolean
  loading: boolean
}

const ROW_HEIGHT = 28
const OVERSCAN = 8

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

/**
 * Owns expand/child cache for the explorer.
 *
 * Why not per-node React state: recursive React tree mounts + re-renders every
 * visible row on every expand. A single Set + Map lets us render a flat
 * virtualized window.
 */
class ExplorerModel {
  private readonly workspace: WorkspaceService
  private readonly childCache = new Map<string, WorkspaceEntry[]>()
  private readonly loading = new Set<string>()
  private readonly expanded = new Set<string>()
  private readonly listeners = new Set<() => void>()

  constructor(workspace: WorkspaceService) {
    this.workspace = workspace
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const l of this.listeners) l()
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
      const entries = await this.workspace.readDir(uri)
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

  invalidateRoot(): void {
    this.childCache.clear()
    this.expanded.clear()
    this.notify()
  }

  /**
   * Walk the expanded tree and produce a flat list of visible rows in render
   * order. Called on each render — cheap because it only walks expanded nodes,
   * not the whole workspace.
   */
  flattenVisible(rootUri: string): FlatRow[] {
    const rows: FlatRow[] = []
    const rootChildren = this.childCache.get(rootUri)
    if (!rootChildren) return rows
    const walk = (entries: WorkspaceEntry[], depth: number): void => {
      for (const entry of entries) {
        const expanded = this.expanded.has(entry.uri)
        rows.push({
          uri: entry.uri,
          name: entry.name,
          path: toPath(entry.uri),
          depth,
          isDirectory: entry.isDirectory,
          expanded,
          loading: this.loading.has(entry.uri),
        })
        if (entry.isDirectory && expanded) {
          const children = this.childCache.get(entry.uri)
          if (children) walk(children, depth + 1)
        }
      }
    }
    walk(rootChildren, 1)
    return rows
  }
}

export function ExplorerTree({
  workspace,
  onOpenFile,
}: {
  workspace: WorkspaceService
  onOpenFile: (uri: string, path: string) => void
}) {
  const rootUri = workspace.root?.uri
  const modelRef = useRef<ExplorerModel | null>(null)
  if (modelRef.current === null) modelRef.current = new ExplorerModel(workspace)
  const model = modelRef.current
  const [rev, setRev] = useState(0)

  useEffect(() => model.subscribe(() => setRev(r => r + 1)), [model])

  useEffect(() => {
    if (!rootUri) return
    model.invalidateRoot()
    void model.ensureChildren(rootUri)
  }, [rootUri, model])

  const rows: FlatRow[] = useMemo(() => {
    void rev
    if (!rootUri) return []
    return model.flattenVisible(rootUri)
  }, [rev, rootUri, model])

  const contentRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => registerListPanel(EXPLORER_LIST_ID, contentRef.current), [rootUri])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => contentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  })

  const onRowClick = useCallback(
    (row: FlatRow) => {
      if (row.isDirectory) void model.toggle(row.uri)
      else onOpenFile(row.uri, row.path)
    },
    [model, onOpenFile],
  )

  if (!rootUri) return null

  const rootChildren = model.childrenOf(rootUri)
  const rootLoading = model.isLoading(rootUri) || rootChildren === null

  return (
    <SidebarContent
      ref={contentRef}
      className="min-h-0 overflow-auto"
      data-jet-list-panel="explorer"
      tabIndex={-1}
      role="tree"
      aria-label="Explorer"
    >
      {rootLoading ? (
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
  onClick,
}: {
  row: FlatRow
  offset: number
  onClick: (row: FlatRow) => void
}) {
  return (
    <div
      role="treeitem"
      aria-level={row.depth}
      aria-expanded={row.isDirectory ? row.expanded : undefined}
      data-jet-list-item
      data-uri={row.uri}
      className={cn(
        "absolute left-0 top-0 flex w-full cursor-pointer items-center gap-1 rounded-sm px-2 text-xs hover:bg-muted",
      )}
      style={{
        transform: `translateY(${offset}px)`,
        height: ROW_HEIGHT,
        paddingLeft: 4 + row.depth * 12,
      }}
      onClick={() => onClick(row)}
      title={row.name}
    >
      {row.isDirectory ? (
        <>
          <ChevronRight
            className={cn(
              "size-3 shrink-0 transition-transform",
              row.expanded && "rotate-90",
            )}
          />
          <Folder className="size-3.5 shrink-0" />
        </>
      ) : (
        <>
          <span className="size-3 shrink-0" />
          <File className="size-3.5 shrink-0" />
        </>
      )}
      <span className="truncate">{row.name}</span>
      {row.loading ? <span className="ml-auto text-muted-foreground/60">…</span> : null}
    </div>
  )
}

export function ExplorerTab({
  workspace,
  onOpenFile,
}: {
  workspace: WorkspaceService
  onOpenFile: (uri: string, path: string) => void
}) {
  if (!workspace.root) {
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
      <ExplorerTree workspace={workspace} onOpenFile={onOpenFile} />
    </SidebarProvider>
  )
}
