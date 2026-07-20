import { useEffect, useRef } from "react"
import type { FileSystemProvider, LaunchConfig } from "@jet/workspace"
import {
  handleDroppedPaths,
  pathsFromDataTransfer,
  resolveDropZoneAtPoint,
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

export type UseFileDropOptions = {
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

type DropContext = ProcessDroppedPathsContext

async function logicalPointFromPhysical(position: { x: number; y: number }): Promise<{ x: number; y: number }> {
  try {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow")
    const scale = await getCurrentWebviewWindow().scaleFactor()
    if (Number.isFinite(scale) && scale > 0) {
      return { x: position.x / scale, y: position.y / scale }
    }
  } catch {
    // Browser / non-Tauri shell.
  }
  return { x: position.x, y: position.y }
}

export function useFileDrop(opts: UseFileDropOptions): void {
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    let dragDepth = 0

    const dropContext = (): DropContext => {
      const ctx = optsRef.current
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
      optsRef.current.onDragOverChange?.(active)
    }

    const dispatchPaths = (
      paths: string[],
      zone: ReturnType<typeof resolveDropZoneFromElement>,
      targetEl: Element | null,
    ) => {
      if (paths.length === 0) return
      void handleDroppedPaths(paths, zone, targetEl, dropContext())
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

      const ctx = optsRef.current
      if (zone === "terminal") return

      if (ctx.knownWorkspacePaths.length === 0) {
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

    let unlistenTauri: (() => void) | null = null
    void (async () => {
      try {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow")
        unlistenTauri = await getCurrentWebviewWindow().onDragDropEvent(event => {
          const payload = event.payload
          if (payload.type === "enter" || payload.type === "over") {
            setDragActive(true)
            return
          }
          if (payload.type === "leave") {
            setDragActive(false)
            return
          }
          if (payload.type !== "drop") return

          setDragActive(false)
          void (async () => {
            const point = await logicalPointFromPhysical(payload.position)
            const targetEl = document.elementFromPoint(point.x, point.y)
            const zone = resolveDropZoneAtPoint(point.x, point.y)
            dispatchPaths(payload.paths, zone, targetEl)
          })()
        })
      } catch {
        // Non-Tauri shell — HTML5 drag/drop only.
      }
    })()

    return () => {
      window.removeEventListener("dragenter", onDragEnter, true)
      window.removeEventListener("dragleave", onDragLeave, true)
      window.removeEventListener("dragover", onDragOver, true)
      window.removeEventListener("drop", onDrop, true)
      unlistenTauri?.()
    }
  }, [])
}
