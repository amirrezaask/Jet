import { useEffect, useRef } from "react"
import type { FileDropOptions } from "./file-drop-runtime.js"

export type UseFileDropOptions = FileDropOptions

/** Lazy-loads file-drop listeners so they stay out of the startup JS budget. */
export function useFileDrop(opts: UseFileDropOptions): void {
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    let disposed = false
    let uninstall: (() => void) | undefined
    void import("./file-drop-runtime.js").then(({ installFileDrop }) => {
      if (disposed) return
      uninstall = installFileDrop(() => optsRef.current)
    })
    return () => {
      disposed = true
      uninstall?.()
    }
  }, [])
}
