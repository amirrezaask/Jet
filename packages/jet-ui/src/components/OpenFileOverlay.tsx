import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronRight, File, Folder, FolderUp } from "lucide-react"
import { pathToFileUri } from "@jet/shared"
import type { WorkspaceEntry, WorkspaceService } from "@jet/workspace"
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
  DialogTitle,
} from "@/components/ui/dialog.js"

function parentRelDir(rel: string): string {
  const parts = rel.split("/").filter(Boolean)
  parts.pop()
  return parts.join("/")
}

function dirUri(rootPath: string, rootUri: string, rel: string): string {
  if (!rel) return rootUri
  return pathToFileUri(`${rootPath}/${rel}`)
}

export function OpenFileOverlay({
  open,
  onOpenChange,
  workspace,
  onOpenFile,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspace: WorkspaceService
  onOpenFile: (uri: string, path: string) => void
}) {
  const root = workspace.root
  const [currentRelDir, setCurrentRelDir] = useState("")
  const [query, setQuery] = useState("")
  const [entries, setEntries] = useState<WorkspaceEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedValue, setSelectedValue] = useState("")

  useEffect(() => {
    if (!open) {
      setCurrentRelDir("")
      setQuery("")
    }
  }, [open])

  useEffect(() => {
    if (!open || !root) {
      setEntries([])
      return
    }
    let cancelled = false
    setLoading(true)
    void workspace
      .readDir(dirUri(root.path, root.uri, currentRelDir))
      .then(list => {
        if (cancelled) return
        setEntries(
          list.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
            return a.name.localeCompare(b.name)
          }),
        )
      })
      .catch(() => {
        if (!cancelled) setEntries([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, root, currentRelDir, workspace])

  const goUp = useCallback(() => {
    setCurrentRelDir(prev => parentRelDir(prev))
    setQuery("")
  }, [])

  const enterDir = useCallback((name: string) => {
    setCurrentRelDir(prev => (prev ? `${prev}/${name}` : name))
    setQuery("")
  }, [])

  const openEntry = useCallback(
    (entry: WorkspaceEntry) => {
      if (!root) return
      const rel = currentRelDir ? `${currentRelDir}/${entry.name}` : entry.name
      const fullPath = `${root.path}/${rel}`
      onOpenFile(pathToFileUri(fullPath), fullPath)
      onOpenChange(false)
    },
    [root, currentRelDir, onOpenFile, onOpenChange],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(e => e.name.toLowerCase().includes(q))
  }, [entries, query])

  const selectableValues = useMemo(() => {
    const values: string[] = []
    if (currentRelDir) values.push("__parent__")
    values.push(...filtered.map(e => e.uri))
    return values
  }, [currentRelDir, filtered])

  useEffect(() => {
    if (!open) {
      setSelectedValue("")
      return
    }
    if (selectableValues.length === 0) {
      setSelectedValue("")
      return
    }
    if (!selectableValues.includes(selectedValue)) {
      setSelectedValue(selectableValues[0]!)
    }
  }, [open, selectableValues, selectedValue])

  const pathLabel = root
    ? [root.name, ...currentRelDir.split("/").filter(Boolean)].join(" / ")
    : ""

  const handleSelect = (value: string) => {
    if (value === "__parent__") {
      goUp()
      return
    }
    const entry = entries.find(e => e.uri === value)
    if (!entry) return
    if (entry.isDirectory) enterDir(entry.name)
    else openEntry(entry)
  }

  if (!root) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
        <DialogTitle className="sr-only">Open file</DialogTitle>
        <DialogDescription className="sr-only">Browse and open a file</DialogDescription>
        <Command shouldFilter={false} value={selectedValue} onValueChange={setSelectedValue}>
          <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">{pathLabel}</div>
          <CommandInput
            placeholder="Filter or browse folders…"
            value={query}
            onValueChange={setQuery}
            onKeyDown={e => {
              if (e.key === "Backspace" && query === "" && currentRelDir) {
                e.preventDefault()
                goUp()
              }
            }}
          />
          <CommandList style={{ maxHeight: "20rem" }}>
            {loading ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">Loading…</div>
            ) : (
              <>
                <CommandEmpty>No matching files.</CommandEmpty>
                {currentRelDir ? (
                  <CommandItem
                    value="__parent__"
                    onSelect={() => handleSelect("__parent__")}
                    className="flex items-center gap-2"
                  >
                    <FolderUp className="size-3.5 shrink-0 text-muted-foreground" />
                    <span>..</span>
                  </CommandItem>
                ) : null}
                {filtered.map(entry => (
                  <CommandItem
                    key={entry.uri}
                    value={entry.uri}
                    onSelect={() => handleSelect(entry.uri)}
                    className="flex items-center gap-2"
                  >
                    {entry.isDirectory ? (
                      <>
                        <Folder className="size-3.5 shrink-0 text-foreground" />
                        <span className="flex-1 truncate">{entry.name}</span>
                        <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                      </>
                    ) : (
                      <>
                        <File className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{entry.name}</span>
                      </>
                    )}
                  </CommandItem>
                ))}
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
