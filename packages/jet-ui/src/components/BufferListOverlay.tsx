import { useMemo } from "react"
import type { WorkspaceService } from "@jet/workspace"
import { PaletteShell, type PaletteShellItem } from "./palette/PaletteShell.js"

interface BufferEntry {
  uri: string
  name: string
  dirty: boolean
}

export function BufferListOverlay({
  open,
  onOpenChange,
  workspace,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspace: WorkspaceService
  onSelect: (uri: string) => void
}) {
  const items = useMemo<PaletteShellItem<BufferEntry>[]>(
    () =>
      workspace.openBuffers.map(uri => {
        const file = workspace.fileForUri(uri)
        const name = file?.name ?? uri
        return {
          key: uri,
          value: `${name} ${uri}`,
          data: { uri, name, dirty: file?.isDirty ?? false },
        }
      }),
    [workspace],
  )

  return (
    <PaletteShell
      open={open}
      onOpenChange={onOpenChange}
      title="Buffer list"
      description="Switch buffer…"
      placeholder="Switch buffer…"
      maxWidth="sm"
      items={items}
      onSelect={entry => onSelect(entry.uri)}
      emptyLabel="No open buffers"
      renderItem={entry => (
        <span data-slot="row-label">
          {entry.name}
          {entry.dirty ? " •" : ""}
        </span>
      )}
    />
  )
}
