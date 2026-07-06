import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronRight, File, Folder, FolderUp } from "lucide-react"
import { pathToFileUri } from "@jet/shared"
import type { WorkspaceEntry, WorkspaceFolder, WorkspaceService } from "@jet/workspace"
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
import { Button } from "@/components/ui/button.js"

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
  onOpenFolder,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspace: WorkspaceService
  onOpenFile: (uri: string, path: string) => void
  onOpenFolder?: () => void
}) {
  const folders = workspace.folders
  const [browseFolderId, setBrowseFolderId] = useState<string | null>(null)
  const [currentRelDir, setCurrentRelDir] = useState("")
  const [query, setQuery] = useState("")
  const [entries, setEntries] = useState<WorkspaceEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedValue, setSelectedValue] = useState("")

  const browseFolder = useMemo(
    () => folders.find(f => f.id === browseFolderId) ?? null,
    [folders, browseFolderId],
  )

  useEffect(() => {
    if (!open) {
      setBrowseFolderId(null)
      setCurrentRelDir("")
      setQuery("")
    } else if (folders.length === 1) {
      setBrowseFolderId(folders[0]!.id)
    }
  }, [open, folders])

  useEffect(() => {
    if (!open || !browseFolder) {
      setEntries([])
      return
    }
    const root = browseFolder.root
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
  }, [open, browseFolder, currentRelDir, workspace])

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
      if (!browseFolder) return
      const root = browseFolder.root
      const rel = currentRelDir ? `${currentRelDir}/${entry.name}` : entry.name
      const fullPath = `${root.path}/${rel}`
      onOpenFile(pathToFileUri(fullPath), fullPath)
      onOpenChange(false)
    },
    [browseFolder, currentRelDir, onOpenFile, onOpenChange],
  )

  const selectBrowseFolder = useCallback((folder: WorkspaceFolder) => {
    setBrowseFolderId(folder.id)
    setCurrentRelDir("")
    setQuery("")
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(e => e.name.toLowerCase().includes(q))
  }, [entries, query])

  const selectableValues = useMemo(() => {
    if (!browseFolder) {
      return folders.map(f => `folder:${f.id}`)
    }
    const values: string[] = []
    if (folders.length > 1) values.push("__roots__")
    if (currentRelDir) values.push("__parent__")
    values.push(...filtered.map(e => e.uri))
    return values
  }, [browseFolder, folders, currentRelDir, filtered])

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

  const pathLabel = browseFolder
    ? [browseFolder.root.name, ...currentRelDir.split("/").filter(Boolean)].join(" / ")
    : "Workspace folders"

  const handleSelect = (value: string) => {
    if (value === "__roots__") {
      setBrowseFolderId(null)
      setCurrentRelDir("")
      setQuery("")
      return
    }
    if (value === "__parent__") {
      goUp()
      return
    }
    if (value.startsWith("folder:")) {
      const id = value.slice("folder:".length)
      const folder = folders.find(f => f.id === id)
      if (folder) selectBrowseFolder(folder)
      return
    }
    const entry = entries.find(e => e.uri === value)
    if (!entry) return
    if (entry.isDirectory) enterDir(entry.name)
    else openEntry(entry)
  }

  if (folders.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Open file</DialogTitle>
          <DialogDescription>Open a workspace folder to browse files.</DialogDescription>
          {onOpenFolder ? (
            <Button type="button" onClick={() => onOpenFolder()}>
              Open Folder…
            </Button>
          ) : null}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
        <DialogTitle className="sr-only">Open file</DialogTitle>
        <DialogDescription className="sr-only">Browse and open a file</DialogDescription>
        <Command shouldFilter={false} value={selectedValue} onValueChange={setSelectedValue}>
          <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">{pathLabel}</div>
          <CommandInput
            placeholder={browseFolder ? "Filter or browse folders…" : "Filter workspace folders…"}
            value={query}
            onValueChange={setQuery}
            onKeyDown={e => {
              if (e.key === "Backspace" && query === "" && browseFolder && currentRelDir) {
                e.preventDefault()
                goUp()
              }
            }}
          />
          <CommandList className="max-h-[var(--jet-overlay-list-max)]">
            {!browseFolder ? (
              <>
                <CommandEmpty>No matching folders.</CommandEmpty>
                {folders
                  .filter(f => {
                    const q = query.trim().toLowerCase()
                    if (!q) return true
                    return (
                      f.root.name.toLowerCase().includes(q) ||
                      f.root.path.toLowerCase().includes(q)
                    )
                  })
                  .map(folder => (
                    <CommandItem
                      key={folder.id}
                      value={`folder:${folder.id}`}
                      onSelect={() => handleSelect(`folder:${folder.id}`)}
                      className="flex items-center gap-2"
                    >
                      <Folder className="size-3.5 shrink-0 text-foreground" />
                      <span className="min-w-0 flex-1 truncate">{folder.root.name}</span>
                      <span className="min-w-0 truncate text-xs text-muted-foreground">
                        {folder.root.path}
                      </span>
                      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                    </CommandItem>
                  ))}
              </>
            ) : loading ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">Loading…</div>
            ) : (
              <>
                <CommandEmpty>No matching files.</CommandEmpty>
                {folders.length > 1 ? (
                  <CommandItem
                    value="__roots__"
                    onSelect={() => handleSelect("__roots__")}
                    className="flex items-center gap-2"
                  >
                    <FolderUp className="size-3.5 shrink-0 text-muted-foreground" />
                    <span>Workspace folders</span>
                  </CommandItem>
                ) : null}
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
                        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                        <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                      </>
                    ) : (
                      <>
                        <File className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 truncate">{entry.name}</span>
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
