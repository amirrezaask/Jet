import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
  const lastEnsuredUriRef = useRef<string | null>(null)
  const ensureLspForFileRef = useRef<(fileUri: string) => Promise<void>>(async () => {})

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
      lastEnsuredUriRef.current = fileUri
      const rootUri = workspace.resolveRootUriForFile(fileUri)
      if (!rootUri) return
      const path = fileUriToPath(fileUri)
      const file = workspace.fileForUri(fileUri) ?? workspace.createWorkspaceFile(fileUri, path)
      const attach = async () => {
        const conn = await lspManager.ensureServerForFile(file, rootUri)
        if (!conn) return false
        await lspClientPool.getOrCreateClient(conn)
        setLspCrashed(false)
        bumpLspRevision()
        return true
      }
      try {
        if (await attach()) return
      } catch {
        lspClientPool.clear()
      }
      // One automatic retry covers the race where a transport blip clears the
      // host session while the renderer is still finishing its first attach.
      try {
        if (await attach()) return
      } catch {
        /* fall through to spawn-error toast */
      }
      const spawnErr = lspManager.consumeLastSpawnError()
      if (spawnErr && lspManager.isLanguageSupported(file.languageId)) {
        const command = languageServerCommandFor(file.languageId) ?? "language server"
        showJetToast(`Language server unavailable for ${file.name} — is ${command} on PATH?`)
      }
    },
    [lspManager, workspace, lspClientPool, bumpLspRevision],
  )
  ensureLspForFileRef.current = ensureLspForFile

  const handleLspAttachFailed = useCallback(
    (fileUri: string) => {
      void ensureLspForFile(fileUri)
    },
    [ensureLspForFile],
  )

  const stopLspServersForRoot = useCallback(
    async (rootUri: string) => {
      if (!lspManager) return
      const stoppedIds = await lspManager.stopServersForRoot(rootUri)
      for (const id of stoppedIds) lspClientPool.releaseConnection(id)
    },
    [lspManager, lspClientPool],
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
      showJetToast("LSP crashed — retrying…")
      const uri = lastEnsuredUriRef.current
      if (uri) {
        window.setTimeout(() => {
          void ensureLspForFileRef.current(uri)
        }, 250)
      }
    })
  }, [lspClientPool, bumpLspRevision])

  const lspStatus = useMemo((): "connected" | "off" | "unavailable" => {
    if (!window.jet?.lsp) return "unavailable"
    // A live connection wins over a prior crash sticky-flag so reconnect
    // (and the status bar) recover after transport loss.
    if (lspManager?.hasAnyConnection()) return "connected"
    if (lspCrashed) return "off"
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
    stopLspServersForRoot,
    lspStatus,
    lspCrashed,
    setLspCrashed,
  }
}
