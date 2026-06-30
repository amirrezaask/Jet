import { useCallback, useEffect, useMemo, useState } from "react"
import type { WorkspaceService } from "@jet/workspace"

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

  if (!open) return null

  const q = query.trim().toLowerCase()
  const filtered = buffers.filter(uri => {
    const file = workspace.fileForUri(uri)
    const name = file?.name ?? uri
    return !q || name.toLowerCase().includes(q) || uri.toLowerCase().includes(q)
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]"
      onMouseDown={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-lg rounded border border-[var(--jet-border)] bg-[var(--jet-panel)] shadow-lg"
        onMouseDown={e => e.stopPropagation()}
      >
        <input
          autoFocus
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Switch buffer…"
          className="w-full border-b border-[var(--jet-border)] bg-transparent px-3 py-2 text-sm outline-none"
        />
        <ul className="max-h-80 overflow-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-[var(--jet-text-muted)]">No open buffers</li>
          ) : (
            filtered.map(uri => {
              const file = workspace.fileForUri(uri)
              return (
                <li key={uri}>
                  <button
                    type="button"
                    className="flex w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--jet-border)]/40"
                    onClick={() => {
                      onSelect(uri)
                      onOpenChange(false)
                    }}
                  >
                    {file?.name ?? uri}
                    {file?.isDirty ? " •" : ""}
                  </button>
                </li>
              )
            })
          )}
        </ul>
      </div>
    </div>
  )
}
