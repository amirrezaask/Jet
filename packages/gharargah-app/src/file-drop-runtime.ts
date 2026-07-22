import type { FileSystemProvider, LaunchConfig } from "@gharargah/workspace"
import {
  handleDroppedPaths,
  pathsFromDataTransfer,
  resolveDropZoneFromElement,
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

    const target = e.target instanceof Element ? e.target : null
    const zone = resolveDropZoneFromElement(target)
    const paths = pathsFromDataTransfer(e.dataTransfer)

    if (paths.length > 0) {
      void handleDroppedPaths(paths, zone, target, dropContext())
      return
    }

    const files = [...e.dataTransfer.files]
    if (files.length === 0) return

    const ctx = getOpts()
    if (zone === "terminal") {
      ctx.setMessage("Drop a file from disk (path required for terminal)")
      return
    }

    if (ctx.knownWorkspacePaths.length === 0) {
      ctx.setMessage("Drop files after opening a folder")
      return
    }

    void (async () => {
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
