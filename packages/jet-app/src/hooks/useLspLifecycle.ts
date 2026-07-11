import { useCallback, useEffect, useMemo, useState } from "react"
import { LanguageServerManager, LspClientPool, languageServerCommandFor } from "@jet/lsp"
import type { LSPClient } from "@jet/codemirror"
import { isUntitledUri, fileUriToPath } from "@jet/shared"
import type { WorkspaceService } from "@jet/workspace"
import { showJetToast } from "@jet/ui"

export function useLspLifecycle(
  workspace: WorkspaceService,
  onOpenFile: (uri: string, path: string, line?: number, column?: number) => void,
) {
  const [lspRevision, setLspRevision] = useState(0)
  const [lspCrashed, setLspCrashed] = useState(false)

  const lspManager = useMemo(
    () => (window.jet ? new LanguageServerManager(window.jet.lsp) : null),
    [],
  )
  const lspClientPool = useMemo(() => new LspClientPool(), [])

  const bumpLspRevision = useCallback(() => setLspRevision(r => r + 1), [])

  const resolveLspClient = useCallback(
    async (fileUri: string): Promise<LSPClient | null> => {
      if (!lspManager) return null
      const rootUri = workspace.resolveRootUriForFile(fileUri)
      if (!rootUri) return null
      const path = isUntitledUri(fileUri) ? "" : fileUriToPath(fileUri)
      const file = workspace.fileForUri(fileUri) ?? workspace.createWorkspaceFile(fileUri, path)
      const conn = await lspManager.ensureServerForFile(file, rootUri)
      if (!conn) return null
      return lspClientPool.getOrCreateClient(conn)
    },
    [lspManager, workspace, lspClientPool],
  )

  const ensureLspForFile = useCallback(
    async (fileUri: string) => {
      if (!lspManager || isUntitledUri(fileUri)) return
      const rootUri = workspace.resolveRootUriForFile(fileUri)
      if (!rootUri) return
      const path = fileUriToPath(fileUri)
      const file = workspace.fileForUri(fileUri) ?? workspace.createWorkspaceFile(fileUri, path)
      const conn = await lspManager.ensureServerForFile(file, rootUri)
      if (conn) {
        try {
          await lspClientPool.getOrCreateClient(conn)
          bumpLspRevision()
        } catch {
          lspManager.clearConnection(conn.id)
          lspClientPool.releaseConnection(conn.id)
        }
      } else {
        const spawnErr = lspManager.consumeLastSpawnError()
        if (spawnErr && lspManager.isLanguageSupported(file.languageId)) {
          const command = languageServerCommandFor(file.languageId) ?? "language server"
          showJetToast(`Language server unavailable for ${file.name} — is ${command} on PATH?`)
        }
      }
    },
    [lspManager, workspace, lspClientPool, bumpLspRevision],
  )

  const handleLspAttachFailed = useCallback(
    (fileUri: string) => {
      void ensureLspForFile(fileUri)
    },
    [ensureLspForFile],
  )

  useEffect(() => {
    lspClientPool.setWorkspaceDeps({
      openFile: (uri, path, line, column) => onOpenFile(uri, path, line, column),
      readFile: uri => workspace.readFile(uri),
      getLanguageId: uri => {
        const file = workspace.fileForUri(uri)
        if (file) return file.languageId
        const path = isUntitledUri(uri) ? "" : fileUriToPath(uri)
        return workspace.createWorkspaceFile(uri, path).languageId
      },
    })
  }, [lspClientPool, onOpenFile, workspace])

  useEffect(() => {
    if (!window.jet?.lsp?.onCrashed) return
    return window.jet.lsp.onCrashed(id => {
      lspClientPool.releaseConnection(id)
      setLspCrashed(true)
      bumpLspRevision()
      showJetToast("LSP crashed — will retry on next editor focus")
    })
  }, [lspClientPool, bumpLspRevision])

  const lspStatus = useMemo((): "connected" | "off" | "unavailable" => {
    if (!window.jet?.lsp) return "unavailable"
    if (lspCrashed) return "off"
    if (lspManager?.hasAnyConnection()) return "connected"
    return "off"
  }, [lspManager, lspCrashed, lspRevision])

  return {
    lspManager,
    lspClientPool,
    lspRevision,
    bumpLspRevision,
    resolveLspClient,
    ensureLspForFile,
    handleLspAttachFailed,
    lspStatus,
    lspCrashed,
    setLspCrashed,
  }
}
