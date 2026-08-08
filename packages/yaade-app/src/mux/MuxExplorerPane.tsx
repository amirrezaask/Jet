import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { ArchiveRestore, File, Folder, Trash2 } from "lucide-react"
import { fileUriToPath, pathToFileUri } from "@yaade/shared"
import {
  ExplorerTab,
  PaletteShell,
  PromptDialog,
  focusExplorerPanel,
  requestConfirm,
  showYaadeToast,
  type ExplorerSelection,
  type PaletteShellItem,
} from "@yaade/ui"
import { Button } from "@yaade/ui/primitives"
import type {
  TrashEntry,
  WorkspaceManager,
  WorkspaceService,
} from "@yaade/workspace"

export type MuxExplorerAction =
  | "focus"
  | "createFile"
  | "createFolder"
  | "rename"
  | "trash"
  | "showTrash"
  | "restoreAs"
  | "emptyTrash"

export type MuxExplorerController = {
  run(action: MuxExplorerAction): void
}

type PromptState =
  | { kind: "createFile"; parentUri: string }
  | { kind: "createFolder"; parentUri: string }
  | { kind: "rename"; selection: Extract<ExplorerSelection, { kind: "entry" }> }
  | { kind: "restoreAs"; entry: TrashEntry }

function messageForError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function errorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : null
}

function trimTrailingSeparators(path: string): string {
  if (path === "/") return path
  return path.replace(/[/\\]+$/, "")
}

function parentPath(path: string): string {
  const normalized = trimTrailingSeparators(path)
  const slash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"))
  if (slash < 0) return normalized
  if (slash === 0) return normalized.slice(0, 1)
  return normalized.slice(0, slash)
}

function joinPath(parent: string, name: string): string {
  const base = trimTrailingSeparators(parent)
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/"
  return `${base}${base.endsWith(separator) ? "" : separator}${name}`
}

function validEntryName(name: string): boolean {
  const trimmed = name.trim()
  return (
    trimmed.length > 0 &&
    trimmed !== "." &&
    trimmed !== ".." &&
    !trimmed.includes("/") &&
    !trimmed.includes("\\") &&
    !trimmed.includes("\0")
  )
}

function directoryUriForSelection(
  selection: ExplorerSelection | null,
  fallbackRootUri: string | null,
): string | null {
  if (!selection) return fallbackRootUri
  if (selection.kind === "root") return selection.uri
  if (selection.entry.isDirectory) return selection.entry.uri
  return pathToFileUri(parentPath(fileUriToPath(selection.entry.uri)))
}

function dirtyBufferUnder(workspace: WorkspaceService, uri: string): string | null {
  const target = trimTrailingSeparators(fileUriToPath(uri))
  for (const openUri of workspace.openBuffers) {
    const file = workspace.fileForUri(openUri)
    if (!file?.isDirty) continue
    const path = fileUriToPath(openUri)
    if (path === target || path.startsWith(`${target}/`) || path.startsWith(`${target}\\`)) {
      return openUri
    }
  }
  return null
}

function formatTrashTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp)
}

export function MuxExplorerPane(props: {
  manager: WorkspaceManager
  workspace: WorkspaceService
  onOpenFile: (uri: string) => void
  onControllerReady?: (controller: MuxExplorerController | null) => void
}) {
  const { manager, workspace, onOpenFile, onControllerReady } = props
  const selectionRef = useRef<ExplorerSelection | null>(null)
  const [contentRevision, setContentRevision] = useState(0)
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [trashMode, setTrashMode] = useState<"restore" | "restoreAs">("restore")
  const [trashEntries, setTrashEntries] = useState<TrashEntry[]>([])
  const [trashLoading, setTrashLoading] = useState(false)

  const refreshExplorer = useCallback(() => {
    setContentRevision(revision => revision + 1)
  }, [])

  const requireFs = useCallback(() => {
    const fs = window.yaade?.fs
    if (!fs) throw new Error("Host filesystem is unavailable")
    return fs
  }, [])

  const showTrash = useCallback(async (mode: "restore" | "restoreAs" = "restore") => {
    setTrashMode(mode)
    setTrashOpen(true)
    setTrashLoading(true)
    try {
      setTrashEntries(await requireFs().listTrash())
    } catch (error) {
      setTrashEntries([])
      showYaadeToast(messageForError(error, "Could not load YAADE Trash"), {
        variant: "destructive",
      })
    } finally {
      setTrashLoading(false)
    }
  }, [requireFs])

  const startCreate = useCallback(
    (kind: "createFile" | "createFolder", selection = selectionRef.current) => {
      const parentUri = directoryUriForSelection(
        selection,
        manager.activeFolder?.root.uri ?? manager.folders[0]?.root.uri ?? null,
      )
      if (!parentUri) {
        showYaadeToast("Open a workspace folder before creating files", {
          variant: "destructive",
        })
        return
      }
      setPrompt({ kind, parentUri })
    },
    [manager],
  )

  const startRename = useCallback((selection = selectionRef.current) => {
    if (!selection || selection.kind !== "entry") {
      showYaadeToast("Select a file or folder to rename")
      return
    }
    setPrompt({ kind: "rename", selection })
  }, [])

  const trashSelection = useCallback(
    async (selection = selectionRef.current) => {
      if (!selection || selection.kind !== "entry") {
        showYaadeToast("Select a file or folder to move to YAADE Trash")
        return
      }
      const dirty = dirtyBufferUnder(workspace, selection.entry.uri)
      if (dirty) {
        showYaadeToast(
          `Save or discard ${fileUriToPath(dirty)} before moving it to trash`,
          { variant: "destructive" },
        )
        return
      }
      const accepted = await requestConfirm({
        title: `Move ${selection.entry.name} to YAADE Trash?`,
        description:
          "The item can be restored from Explorer. Trash never falls back to permanent deletion.",
        confirmLabel: "Move to Trash",
        destructive: true,
      })
      if (!accepted) return
      try {
        await requireFs().trash(selection.entry.uri)
        refreshExplorer()
        showYaadeToast(`Moved ${selection.entry.name} to YAADE Trash`, {
          variant: "success",
        })
      } catch (error) {
        showYaadeToast(messageForError(error, "Could not move item to trash"), {
          variant: "destructive",
        })
      }
    },
    [refreshExplorer, requireFs, workspace],
  )

  const restoreEntry = useCallback(
    async (entry: TrashEntry) => {
      try {
        const result = await requireFs().restoreTrash(entry.id)
        setTrashEntries(items => items.filter(item => item.id !== entry.id))
        refreshExplorer()
        showYaadeToast(`Restored ${fileUriToPath(result.uri)}`, {
          variant: "success",
        })
      } catch (error) {
        if (errorCode(error) === "CONFLICT") {
          setPrompt({ kind: "restoreAs", entry })
          return
        }
        showYaadeToast(messageForError(error, `Could not restore ${entry.name}`), {
          variant: "destructive",
        })
      }
    },
    [refreshExplorer, requireFs],
  )

  const emptyTrash = useCallback(async () => {
    const accepted = await requestConfirm({
      title: "Empty YAADE Trash?",
      description: "This permanently removes every item in YAADE Trash and cannot be undone.",
      confirmLabel: "Empty Trash",
      destructive: true,
    })
    if (!accepted) return
    try {
      const result = await requireFs().emptyTrash()
      setTrashEntries([])
      showYaadeToast(
        result.removed === 1
          ? "Permanently deleted 1 trash item"
          : `Permanently deleted ${result.removed} trash items`,
        { variant: "success" },
      )
    } catch (error) {
      showYaadeToast(messageForError(error, "Could not empty YAADE Trash"), {
        variant: "destructive",
      })
    }
  }, [requireFs])

  const submitPrompt = useCallback(
    async (name: string) => {
      const current = prompt
      if (!current) return
      try {
        if (current.kind === "createFile" || current.kind === "createFolder") {
          const path = joinPath(fileUriToPath(current.parentUri), name)
          const uri = pathToFileUri(path)
          if (current.kind === "createFile") {
            await requireFs().createFile(uri)
            onOpenFile(uri)
            showYaadeToast(`Created ${name}`, { variant: "success" })
          } else {
            await requireFs().mkdir(uri)
            showYaadeToast(`Created folder ${name}`, { variant: "success" })
          }
          refreshExplorer()
          return
        }

        if (current.kind === "rename") {
          const source = current.selection.entry
          const dirty = dirtyBufferUnder(workspace, source.uri)
          if (dirty) {
            showYaadeToast(
              `Save or discard ${fileUriToPath(dirty)} before renaming it`,
              { variant: "destructive" },
            )
            return
          }
          const targetUri = pathToFileUri(
            joinPath(parentPath(fileUriToPath(source.uri)), name),
          )
          await requireFs().rename(source.uri, targetUri)
          refreshExplorer()
          showYaadeToast(`Renamed ${source.name} to ${name}`, {
            variant: "success",
          })
          return
        }

        const targetUri = pathToFileUri(
          joinPath(parentPath(fileUriToPath(current.entry.originalUri)), name),
        )
        const result = await requireFs().restoreTrash(current.entry.id, targetUri)
        setTrashEntries(items => items.filter(item => item.id !== current.entry.id))
        refreshExplorer()
        showYaadeToast(`Restored as ${fileUriToPath(result.uri)}`, {
          variant: "success",
        })
      } catch (error) {
        showYaadeToast(messageForError(error, "Filesystem operation failed"), {
          variant: "destructive",
        })
      }
    },
    [onOpenFile, prompt, refreshExplorer, requireFs, workspace],
  )

  const run = useCallback(
    (action: MuxExplorerAction) => {
      switch (action) {
        case "focus":
          focusExplorerPanel()
          break
        case "createFile":
          startCreate("createFile")
          break
        case "createFolder":
          startCreate("createFolder")
          break
        case "rename":
          startRename()
          break
        case "trash":
          void trashSelection()
          break
        case "showTrash":
          void showTrash("restore")
          break
        case "restoreAs":
          void showTrash("restoreAs")
          break
        case "emptyTrash":
          void emptyTrash()
          break
      }
    },
    [emptyTrash, showTrash, startCreate, startRename, trashSelection],
  )

  useEffect(() => {
    const controller: MuxExplorerController = { run }
    onControllerReady?.(controller)
    return () => onControllerReady?.(null)
  }, [onControllerReady, run])

  const trashItems = useMemo<PaletteShellItem<TrashEntry>[]>(
    () =>
      trashEntries.map(entry => ({
        key: entry.id,
        value: `${entry.name} ${fileUriToPath(entry.originalUri)}`,
        data: entry,
      })),
    [trashEntries],
  )

  const promptDetails = useMemo<{
    title: string
    description: string
    placeholder: string
    hint?: ReactNode
  }>(() => {
    if (!prompt) {
      return { title: "Explorer", description: "", placeholder: "Name" }
    }
    switch (prompt.kind) {
      case "createFile":
        return {
          title: "New File",
          description: fileUriToPath(prompt.parentUri),
          placeholder: "filename.ts",
        }
      case "createFolder":
        return {
          title: "New Folder",
          description: fileUriToPath(prompt.parentUri),
          placeholder: "folder-name",
        }
      case "rename":
        return {
          title: `Rename ${prompt.selection.entry.name}`,
          description: parentPath(fileUriToPath(prompt.selection.entry.uri)),
          placeholder: prompt.selection.entry.name,
        }
      case "restoreAs":
        return {
          title: `Restore ${prompt.entry.name} As`,
          description: parentPath(fileUriToPath(prompt.entry.originalUri)),
          placeholder: prompt.entry.name,
          hint: "Choose a different name because the original path is occupied.",
        }
    }
  }, [prompt])

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-card"
      data-yaade-tool-pane="explorer"
    >
      <div className="min-h-0 flex-1">
        <ExplorerTab
          manager={manager}
          contentRevision={contentRevision}
          onOpenFile={uri => onOpenFile(uri)}
          onSelectionChange={selection => {
            selectionRef.current = selection
          }}
          onCreateFile={selection => startCreate("createFile", selection)}
          onCreateFolder={selection => startCreate("createFolder", selection)}
          onRename={startRename}
          onTrash={selection => void trashSelection(selection)}
          onShowTrash={() => void showTrash("restore")}
        />
      </div>

      <PromptDialog
        open={prompt != null}
        onOpenChange={open => {
          if (!open) setPrompt(null)
        }}
        title={promptDetails.title}
        description={promptDetails.description}
        placeholder={promptDetails.placeholder}
        hint={promptDetails.hint}
        inputId="yaade-explorer-prompt-input"
        validate={validEntryName}
        onSubmit={value => void submitPrompt(value)}
      />

      <PaletteShell
        open={trashOpen}
        onOpenChange={setTrashOpen}
        title="YAADE Trash"
        description="Restore items moved from Explorer"
        placeholder="Filter trash…"
        disabled={trashLoading}
        items={trashItems}
        requireQueryForSelection={false}
        rowLayout="detail"
        emptyLabel={trashLoading ? "Loading trash…" : "YAADE Trash is empty"}
        statusRow={
          trashEntries.length > 0 ? (
            <div className="flex h-8 items-center justify-between border-b border-border/70 px-2 text-xs text-muted-foreground">
              <span>{trashEntries.length} items</span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-destructive hover:text-destructive"
                onClick={() => void emptyTrash()}
              >
                <Trash2 />
                Empty Trash
              </Button>
            </div>
          ) : undefined
        }
        onSelect={entry => {
          if (trashMode === "restoreAs") {
            setPrompt({ kind: "restoreAs", entry })
          } else {
            void restoreEntry(entry)
          }
        }}
        renderItem={entry => (
          <div className="flex min-w-0 items-center gap-2">
            {entry.isDirectory ? (
              <Folder className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <File className="size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-foreground">{entry.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {fileUriToPath(entry.originalUri)} · {formatTrashTime(entry.trashedAt)}
              </div>
            </div>
            <ArchiveRestore className="size-4 shrink-0 text-muted-foreground" />
          </div>
        )}
      />
    </div>
  )
}
