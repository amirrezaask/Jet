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
  onReady: (ensureLspForFile: (uri: string) => Promise<void>) => void
}) {
  const { ensureLspForFile } = useLspLifecycle(props.workspace, props.onOpenFile)

  useEffect(() => {
    props.onReady(ensureLspForFile)
  }, [ensureLspForFile, props])

  return null
}
