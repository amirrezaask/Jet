import type { FileSystemProvider, LaunchConfig } from "@gharargah/workspace"
import {
  handleDroppedPaths,
  pathsFromDataTransferAsync,
  resolveDroppedFilesAgainstWorkspaces,
  resolveDropZoneAtPoint,
  resolveDropZoneFromElement,
  terminalPtyIdFromElement,
  type ProcessDroppedPathsContext,
} from "./drop-files.js"

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"))
    reader.readAsText(file)
  })
}

export type FileDropOptions = {
  fs: FileSystemProvider
  knownWorkspacePaths: string[]
  normalizePath: (p: string) => string
  openWorkspace: (path: string) => void
  addWorkspaceFolder: (path: string) => void
  openFile: (uri: string, path: string) => void
  bootstrapFromLaunch: (config: LaunchConfig) => void
  openUntitledFromDrop: (name: string, content: string) => void
  setMessage: (msg: string) => void
  onDragOverChange?: (active: boolean) => void
  /** Prefer matching drops under this project root when basenames collide. */
  activeWorkspacePath?: string | null
}

/** Install HTML5 OS file-drop listeners. Returns disposer. */
export function installFileDrop(getOpts: () => FileDropOptions): () => void {
  let dragDepth = 0

  const dropContext = (): ProcessDroppedPathsContext => {
    const ctx = getOpts()
    return {
      fs: ctx.fs,
      normalizePath: ctx.normalizePath,
      knownWorkspacePaths: ctx.knownWorkspacePaths,
      openWorkspace: ctx.openWorkspace,
      addWorkspaceFolder: ctx.addWorkspaceFolder,
      openFile: ctx.openFile,
      bootstrapFromLaunch: ctx.bootstrapFromLaunch,
      setMessage: ctx.setMessage,
    }
  }

  const setDragActive = (active: boolean) => {
    getOpts().onDragOverChange?.(active)
  }

  const onDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes("Files")) return
    dragDepth++
    setDragActive(true)
  }

  const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) setDragActive(false)
  }

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes("Files")) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
  }

  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes("Files")) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth = 0
    setDragActive(false)

    const dataTransfer = e.dataTransfer
    const pointEl = document.elementFromPoint(e.clientX, e.clientY)
    const target = pointEl instanceof Element ? pointEl : e.target instanceof Element ? e.target : null
    const zoneFromPoint = resolveDropZoneAtPoint(e.clientX, e.clientY)
    const zone =
      zoneFromPoint !== "other" ? zoneFromPoint : resolveDropZoneFromElement(target)

    void (async () => {
      let paths = await pathsFromDataTransferAsync(dataTransfer)
      const files = [...dataTransfer.files]
      if (paths.length === 0 && files.length > 0) {
        const ctx = getOpts()
        paths = await resolveDroppedFilesAgainstWorkspaces(files, ctx.knownWorkspacePaths, {
          activeRoot: ctx.activeWorkspacePath ?? null,
        })
      }

      if (paths.length > 0) {
        // Prefer the terminal panel under the cursor for PTY id lookup.
        const terminalEl =
          zone === "terminal"
            ? (pointEl?.closest("[data-gharargah-terminal-panel]") ??
              document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-gharargah-terminal-panel]") ??
              target)
            : target
        await handleDroppedPaths(paths, zone, terminalEl instanceof Element ? terminalEl : target, dropContext())
        return
      }

      if (files.length === 0) return

      const ctx = getOpts()
      if (zone === "terminal") {
        ctx.setMessage(
          "Could not resolve file path for terminal. Drop a file from an open project, or paste its path.",
        )
        return
      }

      if (ctx.knownWorkspacePaths.length === 0) {
        ctx.setMessage("Drop files after opening a folder")
        return
      }

      for (const file of files) {
        try {
          const content = await readFileAsText(file)
          ctx.openUntitledFromDrop(file.name, content)
        } catch {
          ctx.setMessage(`Could not read: ${file.name}`)
        }
      }
    })()
  }

  window.addEventListener("dragenter", onDragEnter, true)
  window.addEventListener("dragleave", onDragLeave, true)
  window.addEventListener("dragover", onDragOver, true)
  window.addEventListener("drop", onDrop, true)
  return () => {
    window.removeEventListener("dragenter", onDragEnter, true)
    window.removeEventListener("dragleave", onDragLeave, true)
    window.removeEventListener("dragover", onDragOver, true)
    window.removeEventListener("drop", onDrop, true)
  }
}

// Re-export for tests / callers that need PTY probing helpers.
export { terminalPtyIdFromElement }
