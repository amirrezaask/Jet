import { useEffect, useRef } from "react"
import type { FileSystemProvider, LaunchConfig } from "@jet/workspace"
import { pathsFromDataTransfer, processDroppedPaths } from "./drop-files.js"

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"))
    reader.readAsText(file)
  })
}

export type UseFileDropOptions = {
  fs: FileSystemProvider
  workspaceRootPath: string | null
  normalizePath: (p: string) => string
  openWorkspace: (path: string) => void
  openFile: (uri: string, path: string) => void
  bootstrapFromLaunch: (config: LaunchConfig) => void
  openUntitledFromDrop: (name: string, content: string) => void
  setMessage: (msg: string) => void
  onDragOverChange?: (active: boolean) => void
}

export function useFileDrop(opts: UseFileDropOptions): void {
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    let dragDepth = 0

    const setDragActive = (active: boolean) => {
      optsRef.current.onDragOverChange?.(active)
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

      const ctx = optsRef.current
      const paths = pathsFromDataTransfer(e.dataTransfer)

      if (paths.length > 0) {
        void processDroppedPaths(paths, {
          fs: ctx.fs,
          normalizePath: ctx.normalizePath,
          currentWorkspacePath: ctx.workspaceRootPath,
          openWorkspace: ctx.openWorkspace,
          openFile: ctx.openFile,
          bootstrapFromLaunch: ctx.bootstrapFromLaunch,
          setMessage: ctx.setMessage,
        })
        return
      }

      const files = [...e.dataTransfer.files]
      if (files.length === 0) return

      if (!ctx.workspaceRootPath) {
        ctx.setMessage("Drop files after opening a folder (browser mode)")
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
  }, [])
}
