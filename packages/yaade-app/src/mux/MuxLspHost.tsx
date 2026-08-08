import { useEffect } from "react"
import type { WorkspaceService } from "@yaade/workspace"
import { useLspLifecycle } from "../hooks/useLspLifecycle.js"

/**
 * Mounts LSP only while an editor pane exists, so terminal-only sessions never
 * pay for the Monaco/LSP runtime at boot.
 */
export function MuxLspHost(props: {
  workspace: WorkspaceService
  onOpenFile: (
    uri: string,
    path: string,
    line?: number,
    column?: number,
  ) => void
  onReady: (lifecycle: {
    open: (uri: string) => Promise<void>
    close: (uri: string) => void
  }) => void
}) {
  const { ensureLspForFile, closeLspForFile } = useLspLifecycle(
    props.workspace,
    props.onOpenFile,
  )

  useEffect(() => {
    props.onReady({ open: ensureLspForFile, close: closeLspForFile })
  }, [closeLspForFile, ensureLspForFile, props.onReady])
  return null
}
