import { useMemo } from "react"
import type { WorkspaceService } from "@gharargah/workspace"
import { folderForFileUri } from "@gharargah/workspace"
import { isUntitledUri } from "@gharargah/shared"
import { FileIcon } from "@/lib/file-icon.js"
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
    () => {
      return workspace.openBuffers
        .filter(uri => {
          if (isUntitledUri(uri)) return workspace.manager.activeFolder != null
          const folder = folderForFileUri(workspace, uri)
          return (
            workspace.manager.activeFolder != null &&
            folder?.id === workspace.manager.activeFolder.id
          )
        })
        .map(uri => {
          const file = workspace.fileForUri(uri)
          const name = file?.name ?? uri
          return {
            key: uri,
            value: `${name} ${uri}`,
            data: { uri, name, dirty: file?.isDirty ?? false },
          }
        })
    },
    [workspace],
  )

  return (
    <PaletteShell
      open={open}
      onOpenChange={onOpenChange}
      title="Buffer list"
      description="Switch buffer…"
      placeholder="Switch buffer…"
      items={items}
      onSelect={entry => onSelect(entry.uri)}
      emptyLabel="No open buffers"
      renderItem={entry => (
        <>
          <FileIcon path={entry.name} />
          <span data-slot="row-label">
            {entry.name}
            {entry.dirty ? " •" : ""}
          </span>
        </>
      )}
    />
  )
}
