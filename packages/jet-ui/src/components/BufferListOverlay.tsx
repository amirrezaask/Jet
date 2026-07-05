import { useEffect, useMemo, useState } from "react"
import type { WorkspaceService } from "@jet/workspace"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.js"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"
import { COMMAND_NO_SELECTION, COMMAND_SHELL_CLASS } from "@/lib/command-shell.js"

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
  const [selectedValue, setSelectedValue] = useState(COMMAND_NO_SELECTION)
  const buffers = workspace.openBuffers

  useEffect(() => {
    if (!open) {
      setQuery("")
      setSelectedValue(COMMAND_NO_SELECTION)
    }
  }, [open])

  const q = query.trim().toLowerCase()
  const filtered = buffers.filter(uri => {
    const file = workspace.fileForUri(uri)
    const name = file?.name ?? uri
    return !q || name.toLowerCase().includes(q) || uri.toLowerCase().includes(q)
  })

  useEffect(() => {
    if (query.trim() === "") {
      setSelectedValue(COMMAND_NO_SELECTION)
      return
    }
    if (filtered.length > 0 && !filtered.includes(selectedValue)) {
      setSelectedValue(filtered[0]!)
    }
  }, [filtered, query, selectedValue])

  const items = useMemo(
    () =>
      filtered.map(uri => {
        const file = workspace.fileForUri(uri)
        return { uri, name: file?.name ?? uri, dirty: file?.isDirty ?? false }
      }),
    [filtered, workspace],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Buffer list</DialogTitle>
        <DialogDescription>Switch buffer…</DialogDescription>
      </DialogHeader>
      <DialogContent className="max-w-[32rem] overflow-hidden p-0" showCloseButton={false}>
        <Command
          className={COMMAND_SHELL_CLASS}
          shouldFilter={false}
          value={selectedValue}
          onValueChange={value => {
            if (query.trim() === "") {
              setSelectedValue(COMMAND_NO_SELECTION)
              return
            }
            setSelectedValue(value)
          }}
        >
          <CommandInput placeholder="Switch buffer…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-[var(--jet-overlay-list-max)]">
            <CommandEmpty>No open buffers</CommandEmpty>
            <CommandItem value={COMMAND_NO_SELECTION} className="hidden" aria-hidden />
            {items.map(({ uri, name, dirty }) => (
              <CommandItem
                key={uri}
                value={uri}
                onSelect={() => {
                  onSelect(uri)
                  onOpenChange(false)
                }}
              >
                {name}
                {dirty ? " •" : ""}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
