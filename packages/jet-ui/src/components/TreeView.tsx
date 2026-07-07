import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronRight } from "lucide-react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { SidebarContent, SidebarMenuSubButton } from "@/components/ui/sidebar.js"
import { jetInteractiveRowClass } from "@/motion/tokens.js"
import { registerListPanel } from "@/lib/list-registry.js"
import { cn } from "@/lib/utils.js"

export type TreeNodeId = string

export interface TreeNode<T> {
  id: TreeNodeId
  data: T
  isBranch: boolean
}

export interface TreeDataSource<T> {
  getRoots(): TreeNode<T>[]
  getChildren(id: TreeNodeId): Promise<TreeNode<T>[]> | TreeNode<T>[] | null
  subscribe?(fn: () => void): () => void
}

export interface TreeRowContext {
  depth: number
  expanded: boolean
  loading: boolean
  isBranch: boolean
  active: boolean
}

export interface TreeViewProps<T> {
  listId: string
  source: TreeDataSource<T>
  renderRow: (node: TreeNode<T>, ctx: TreeRowContext) => React.ReactNode
  onActivate?: (node: TreeNode<T>) => void
  initiallyExpanded?: TreeNodeId[]
  ariaLabel: string
  activeId?: TreeNodeId | null
  emptyState?: React.ReactNode
  indentPx?: number
  rowActions?: (node: TreeNode<T>) => React.ReactNode
  wrapRow?: (node: TreeNode<T>, row: React.ReactElement) => React.ReactNode
}

const OVERSCAN = 8
const DEFAULT_INDENT_PX = 12

function readRowHeightPx(): number {
  const root = document.documentElement
  const fontSize = parseFloat(getComputedStyle(root).fontSize)
  const raw = getComputedStyle(root).getPropertyValue("--jet-row-height").trim()
  if (raw.endsWith("rem")) return parseFloat(raw) * fontSize
  const px = parseFloat(raw)
  return Number.isFinite(px) ? px : fontSize * 1.692
}

type FlatEntry<T> = {
  node: TreeNode<T>
  depth: number
  expanded: boolean
  loading: boolean
}

class TreeState<T> {
  private source: TreeDataSource<T>
  private readonly childCache = new Map<TreeNodeId, TreeNode<T>[]>()
  private readonly loading = new Set<TreeNodeId>()
  private readonly expanded: Set<TreeNodeId>
  private readonly listeners = new Set<() => void>()

  constructor(source: TreeDataSource<T>, initiallyExpanded: TreeNodeId[]) {
    this.source = source
    this.expanded = new Set(initiallyExpanded)
  }

  setSource(next: TreeDataSource<T>): void {
    this.source = next
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify(): void {
    for (const l of this.listeners) l()
  }

  async ensureChildren(id: TreeNodeId): Promise<void> {
    if (this.childCache.has(id) || this.loading.has(id)) return
    const result = this.source.getChildren(id)
    if (result === null) return
    if (Array.isArray(result)) {
      this.childCache.set(id, result)
      this.notify()
      return
    }
    this.loading.add(id)
    this.notify()
    try {
      const entries = await result
      this.childCache.set(id, entries)
    } finally {
      this.loading.delete(id)
      this.notify()
    }
  }

  async toggle(id: TreeNodeId): Promise<void> {
    if (this.expanded.has(id)) {
      this.expanded.delete(id)
      this.notify()
      return
    }
    this.expanded.add(id)
    this.notify()
    await this.ensureChildren(id)
  }

  expand(id: TreeNodeId): Promise<void> {
    if (this.expanded.has(id)) return Promise.resolve()
    return this.toggle(id)
  }

  invalidate(): void {
    this.childCache.clear()
    this.notify()
  }

  flatten(): FlatEntry<T>[] {
    const rows: FlatEntry<T>[] = []
    const walk = (nodes: TreeNode<T>[], depth: number): void => {
      for (const node of nodes) {
        const expanded = this.expanded.has(node.id)
        rows.push({
          node,
          depth,
          expanded,
          loading: this.loading.has(node.id),
        })
        if (node.isBranch && expanded) {
          const children = this.childCache.get(node.id)
          if (children) walk(children, depth + 1)
        }
      }
    }
    walk(this.source.getRoots(), 0)
    return rows
  }
}

export function TreeView<T>({
  listId,
  source,
  renderRow,
  onActivate,
  initiallyExpanded,
  ariaLabel,
  activeId,
  emptyState,
  indentPx = DEFAULT_INDENT_PX,
  rowActions,
  wrapRow,
}: TreeViewProps<T>) {
  const stateRef = useRef<TreeState<T> | null>(null)
  if (stateRef.current === null) {
    stateRef.current = new TreeState(source, initiallyExpanded ?? [])
  }
  const state = stateRef.current
  const lastSourceRef = useRef(source)
  if (lastSourceRef.current !== source) {
    state.setSource(source)
    state.invalidate()
    lastSourceRef.current = source
  }

  const [rev, setRev] = useState(0)

  useEffect(() => state.subscribe(() => setRev(r => r + 1)), [state])

  useEffect(() => {
    if (!source.subscribe) return
    return source.subscribe(() => {
      state.invalidate()
      for (const id of initiallyExpanded ?? []) void state.ensureChildren(id)
    })
  }, [source, state, initiallyExpanded])

  useEffect(() => {
    for (const id of initiallyExpanded ?? []) void state.ensureChildren(id)
  }, [initiallyExpanded?.join("|"), state])

  const rows: FlatEntry<T>[] = useMemo(() => {
    void rev
    return state.flatten()
  }, [rev, state])

  const contentRef = useRef<HTMLDivElement | null>(null)
  const [rowHeight, setRowHeight] = useState(readRowHeightPx)

  useLayoutEffect(() => {
    setRowHeight(readRowHeightPx())
  }, [])

  useEffect(() => registerListPanel(listId, contentRef.current), [listId, rows.length])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => contentRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
  })

  const onRowClick = useCallback(
    (entry: FlatEntry<T>) => {
      if (entry.node.isBranch) void state.toggle(entry.node.id)
      if (onActivate) onActivate(entry.node)
    },
    [state, onActivate],
  )

  return (
    <SidebarContent
      ref={contentRef}
      className="min-h-0 overflow-auto"
      data-jet-list-panel={listId}
      tabIndex={-1}
      role="tree"
      aria-label={ariaLabel}
    >
      {rows.length === 0 ? (
        emptyState ?? null
      ) : (
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map(v => {
            const entry = rows[v.index]!
            const ctx: TreeRowContext = {
              depth: entry.depth,
              expanded: entry.expanded,
              loading: entry.loading,
              isBranch: entry.node.isBranch,
              active: activeId != null && activeId === entry.node.id,
            }
            const row = (
              <TreeRow
                entry={entry}
                ctx={ctx}
                offset={v.start}
                rowHeight={rowHeight}
                indentPx={indentPx}
                onClick={() => onRowClick(entry)}
                renderRow={renderRow}
                rowActions={rowActions}
              />
            )
            return (
              <div key={entry.node.id} data-jet-tree-row-slot>
                {wrapRow ? wrapRow(entry.node, row) : row}
              </div>
            )
          })}
        </div>
      )}
    </SidebarContent>
  )
}

function TreeRow<T>({
  entry,
  ctx,
  offset,
  rowHeight,
  indentPx,
  onClick,
  renderRow,
  rowActions,
}: {
  entry: FlatEntry<T>
  ctx: TreeRowContext
  offset: number
  rowHeight: number
  indentPx: number
  onClick: () => void
  renderRow: (node: TreeNode<T>, ctx: TreeRowContext) => React.ReactNode
  rowActions?: (node: TreeNode<T>) => React.ReactNode
}) {
  const paddingLeft = 4 + ctx.depth * indentPx
  return (
    <SidebarMenuSubButton
      asChild
      size="sm"
      isActive={ctx.active}
      className={cn(
        "group/tree-row absolute left-0 top-0 h-[var(--jet-row-height)] w-full shrink-0 cursor-pointer gap-1 rounded-sm px-2",
        jetInteractiveRowClass,
      )}
      style={{
        transform: `translateY(${offset}px)`,
        height: rowHeight,
        paddingLeft,
      }}
    >
      <div
        role="treeitem"
        aria-level={ctx.depth + 1}
        aria-expanded={ctx.isBranch ? ctx.expanded : undefined}
        data-jet-list-item
        data-node-id={entry.node.id}
        onClick={onClick}
        className="flex w-full min-w-0 items-center gap-1"
      >
        {ctx.isBranch ? (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 transition-transform",
              ctx.expanded && "rotate-90",
            )}
          />
        ) : (
          <span className="size-3 shrink-0" />
        )}
        {renderRow(entry.node, ctx)}
        {ctx.loading ? <span className="ml-auto text-muted-foreground/60">…</span> : null}
        {rowActions ? <span className="ml-auto flex shrink-0 items-center">{rowActions(entry.node)}</span> : null}
      </div>
    </SidebarMenuSubButton>
  )
}
