import { useCallback, useEffect, useMemo, useState } from "react"
import type { WorkspaceService } from "@jet/workspace"
import { JetFuzzyPicker } from "./JetFuzzyPicker.js"

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
  const [query, setQuery] = useState("")
  const buffers = workspace.openBuffers

  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  const q = query.trim().toLowerCase()
  const filtered = buffers.filter(uri => {
    const file = workspace.fileForUri(uri)
    const name = file?.name ?? uri
    return !q || name.toLowerCase().includes(q) || uri.toLowerCase().includes(q)
  })

  const items = useMemo(
    () =>
      filtered.map(uri => {
        const file = workspace.fileForUri(uri)
        return {
          value: uri,
          label: (
            <span>
              {file?.name ?? uri}
              {file?.isDirty ? " •" : ""}
            </span>
          ),
          onSelect: () => onSelect(uri),
        }
      }),
    [filtered, onSelect, workspace],
  )

  return (
    <JetFuzzyPicker
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel="Buffer list"
      placeholder="Switch buffer…"
      emptyMessage="No open buffers"
      maxWidth="32rem"
      shouldFilter={false}
      query={query}
      onQueryChange={setQuery}
      items={items}
    />
  )
}
