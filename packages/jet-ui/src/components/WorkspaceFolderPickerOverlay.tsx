import { useDeferredValue, useMemo, useState } from "react"
import { Folder } from "lucide-react"
import type { WorkspaceFolder } from "@jet/workspace"
import { PaletteShell, type PaletteShellItem } from "./palette/PaletteShell.js"

function matchFolder(query: string, folder: WorkspaceFolder): boolean {
  if (!query.trim()) return true
  const q = query.toLowerCase()
  return (
    folder.root.name.toLowerCase().includes(q) ||
    folder.root.path.toLowerCase().includes(q)
  )
}

export function WorkspaceFolderPickerOverlay({
  open,
  onOpenChange,
  folders,
  title = "Select workspace folder",
  description = "Choose a folder…",
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folders: WorkspaceFolder[]
  title?: string
  description?: string
  onSelect: (folder: WorkspaceFolder) => void
}) {
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)

  const items = useMemo<PaletteShellItem<WorkspaceFolder>[]>(
    () =>
      folders
        .filter(f => matchFolder(deferredQuery, f))
        .map(folder => ({ key: folder.id, value: folder.id, data: folder })),
    [deferredQuery, folders],
  )

  return (
    <PaletteShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      placeholder="Filter folders…"
      maxWidth="xl"
      shouldFilter={false}
      query={query}
      onQueryChange={setQuery}
      items={items}
      onSelect={folder => onSelect(folder)}
      emptyLabel="No matching folders."
      itemClassName="gap-2"
      renderItem={folder => (
        <>
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 font-mono text-foreground">{folder.root.name}</span>
            <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
              {folder.root.path}
            </span>
          </span>
        </>
      )}
    />
  )
}
