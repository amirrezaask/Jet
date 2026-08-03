import { useCallback, useEffect, useRef, useState } from "react"
import type { LspClientHandle, LspStatus } from "@yaade/lsp"
import { isUntitledUri, fileUriToPath } from "@yaade/shared"
import type { WorkspaceService } from "@yaade/workspace"
import { showYaadeToast } from "@yaade/ui"

type LspRuntime = {
  LanguageServerManager: typeof import("@yaade/lsp").LanguageServerManager
  LspClientPool: typeof import("@yaade/lsp").LspClientPool
  languageServerCommandFor: typeof import("@yaade/lsp").languageServerCommandFor
  manager: InstanceType<typeof import("@yaade/lsp").LanguageServerManager> | null
  pool: InstanceType<typeof import("@yaade/lsp").LspClientPool>
}

let lspRuntimePromise: Promise<LspRuntime> | null = null
let lspRuntimeUsers = 0
let lspRuntimeReleaseGeneration = 0

async function loadLspRuntime(): Promise<LspRuntime> {
  if (!lspRuntimePromise) {
    lspRuntimePromise = (async () => {
      const lsp = await import("@yaade/lsp")
      const pool = new lsp.LspClientPool()
      const manager = window.yaade
        ? new lsp.LanguageServerManager(window.yaade.lsp)
        : null
      return {
        LanguageServerManager: lsp.LanguageServerManager,
        LspClientPool: lsp.LspClientPool,
        languageServerCommandFor: lsp.languageServerCommandFor,
        manager,
        pool,
      }
    })()
  }
  return lspRuntimePromise
}

export function useLspLifecycle(
  workspace: WorkspaceService,
  onOpenFile: (uri: string, path: string, line?: number, column?: number) => void,
) {
  const [lspRevision, setLspRevision] = useState(0)
  const [lspStatus, setLspStatus] = useState<LspStatus>("idle")
  const lastEnsuredUriRef = useRef<string | null>(null)
  const ensureLspForFileRef = useRef<(fileUri: string) => Promise<void>>(async () => {})
  const crashRetryCountRef = useRef(0)
  const crashRetryTimerRef = useRef<number | null>(null)
  const runtimeRef = useRef<LspRuntime | null>(null)
  const knownRootUrisRef = useRef(new Set(workspace.folders.map(folder => folder.root.uri)))
  const onOpenFileRef = useRef(onOpenFile)
  onOpenFileRef.current = onOpenFile
  const MAX_CRASH_RETRIES = 3
  const CRASH_RETRY_BASE_MS = 500

  useEffect(() => {
    lspRuntimeUsers++
    lspRuntimeReleaseGeneration++
    return () => {
      lspRuntimeUsers = Math.max(0, lspRuntimeUsers - 1)
      const generation = ++lspRuntimeReleaseGeneration
      queueMicrotask(() => {
        if (lspRuntimeUsers !== 0 || lspRuntimeReleaseGeneration !== generation) return
        const runtimePromise = lspRuntimePromise
        lspRuntimePromise = null
        if (!runtimePromise) return
        void runtimePromise.then(async runtime => {
          runtime.pool.clear()
          await runtime.manager?.stopAll()
          runtime.manager?.dispose()
        })
      })
    }
  }, [])

  const bumpLspRevision = useCallback(() => setLspRevision(r => r + 1), [])

  const ensureRuntime = useCallback(async () => {
    if (runtimeRef.current) return runtimeRef.current
    const runtime = await loadLspRuntime()
    runtimeRef.current = runtime
    const { monacoModels } = await import("@yaade/monaco")
    runtime.pool.setWorkspaceDeps({
      openFile: (uri, path, line, column) => onOpenFileRef.current(uri, path, line, column),
      pushJumpLocation: (uri, line, column) => {
        workspace.jumpStack.push({ fileUri: uri, line, column })
      },
      readFile: uri => workspace.readFile(uri),
      getLanguageId: uri => {
        const file = workspace.fileForUri(uri)
        if (file) return file.languageId
        const path = isUntitledUri(uri) ? "" : fileUriToPath(uri)
        return workspace.createWorkspaceFile(uri, path).languageId
      },
      isDirty: (uri: string) => workspace.fileForUri(uri)?.isDirty ?? false,
      getContent: (uri: string) => monacoModels.getContent(uri),
      updateContent: (uri: string, content: string) => {
        monacoModels.updateContent(uri, content, { preserveCursor: true })
        workspace.markDirty(uri, content !== (workspace.savedBaselineFor(uri) ?? ""))
      },
      writeFile: async (uri: string, content: string) => {
        await workspace.writeFile(uri, content)
        workspace.setSavedBaseline(uri, content)
        workspace.markDirty(uri, false)
      },
    })
    runtime.pool.setServerMessageHandler((message, kind) => {
      showYaadeToast(message, {
        variant: kind === "error" ? "destructive" : kind === "warning" ? "warning" : "info",
      })
    })
    return runtime
  }, [workspace])

  useEffect(() => {
    if (!window.yaade?.lsp) {
      setLspStatus("unavailable")
    }
  }, [])

  const resolveLspClient = useCallback(
    async (fileUri: string): Promise<LspClientHandle | null> => {
      const runtime = await ensureRuntime()
      const { manager, pool } = runtime
      if (!manager) return null
      const rootUri = workspace.resolveRootUriForFile(fileUri)
      if (!rootUri) return null
      const path = isUntitledUri(fileUri) ? "" : fileUriToPath(fileUri)
      const file = workspace.fileForUri(fileUri) ?? workspace.createWorkspaceFile(fileUri, path)
      const conn = await manager.ensureServerForFile(file, rootUri)
      if (!conn) return null
      return pool.getOrCreateClient(conn)
    },
    [ensureRuntime, workspace],
  )

  const ensureLspForFile = useCallback(
    async (fileUri: string) => {
      if (isUntitledUri(fileUri)) return
      if (!window.yaade?.lsp) {
        setLspStatus("unavailable")
        return
      }

      const runtime = await ensureRuntime()
      const { manager, pool, languageServerCommandFor } = runtime
      if (!manager) return

      lastEnsuredUriRef.current = fileUri
      setLspStatus("starting")
      const rootUri = workspace.resolveRootUriForFile(fileUri)
      if (!rootUri) {
        setLspStatus("idle")
        return
      }
      const path = fileUriToPath(fileUri)
      const file = workspace.fileForUri(fileUri) ?? workspace.createWorkspaceFile(fileUri, path)

      const attach = async () => {
        const conn = await manager.ensureServerForFile(file, rootUri)
        if (!conn) return false
        try {
          await pool.getOrCreateClient(conn)
        } catch (error) {
          pool.releaseConnection(conn.id)
          await manager.stopConnection(conn.id)
          throw error
        }
        crashRetryCountRef.current = 0
        setLspStatus("ready")
        bumpLspRevision()
        return true
      }

      try {
        if (await attach()) return
      } catch {
        pool.clear()
        setLspStatus("disconnected")
      }

      try {
        if (await attach()) return
      } catch {
        /* fall through */
      }

      const spawnErr = manager.consumeLastSpawnError()
      if (spawnErr && manager.isLanguageSupported(file.languageId)) {
        const command = languageServerCommandFor(file.languageId) ?? "language server"
        showYaadeToast(`Language server unavailable for ${file.name} — is ${command} on PATH?`)
        setLspStatus("failed")
        return
      }
      setLspStatus(manager.hasAnyConnection() ? "ready" : "idle")
    },
    [ensureRuntime, workspace, bumpLspRevision],
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
      const runtime = runtimeRef.current
      if (!runtime?.manager) return
      const stoppedIds = await runtime.manager.stopServersForRoot(rootUri)
      for (const id of stoppedIds) runtime.pool.releaseConnection(id)
      setLspStatus(runtime.manager.hasAnyConnection() ? "ready" : "idle")
      bumpLspRevision()
    },
    [bumpLspRevision],
  )

  useEffect(() => {
    const sub = workspace.manager.onDidChangeFolders.event(folders => {
      const next = new Set(folders.map(folder => folder.root.uri))
      const runtime = runtimeRef.current
      if (runtime?.manager) {
        for (const rootUri of knownRootUrisRef.current) {
          if (next.has(rootUri)) continue
          void runtime.manager.stopServersForRoot(rootUri).then(stoppedIds => {
            for (const id of stoppedIds) runtime.pool.releaseConnection(id)
            setLspStatus(runtime.manager?.hasAnyConnection() ? "ready" : "idle")
            bumpLspRevision()
          })
        }
      }
      knownRootUrisRef.current = next
    })
    return () => sub.dispose()
  }, [workspace, bumpLspRevision])

  useEffect(() => {
    if (!window.yaade?.lsp?.onCrashed) return
    return window.yaade.lsp.onCrashed(id => {
      const runtime = runtimeRef.current
      if (!runtime) return
      runtime.pool.releaseConnection(id)
      setLspStatus("disconnected")
      bumpLspRevision()
      const uri = lastEnsuredUriRef.current
      if (!uri) return
      if (crashRetryTimerRef.current != null) {
        window.clearTimeout(crashRetryTimerRef.current)
        crashRetryTimerRef.current = null
      }
      const attempt = crashRetryCountRef.current
      if (attempt >= MAX_CRASH_RETRIES) {
        setLspStatus("failed")
        showYaadeToast("LSP crashed repeatedly — stopped retrying", { variant: "destructive" })
        return
      }
      crashRetryCountRef.current = attempt + 1
      const delayMs = CRASH_RETRY_BASE_MS * 2 ** attempt
      setLspStatus("restarting")
      showYaadeToast(`LSP crashed — retrying (${attempt + 1}/${MAX_CRASH_RETRIES})…`)
      crashRetryTimerRef.current = window.setTimeout(() => {
        crashRetryTimerRef.current = null
        void ensureLspForFileRef.current(uri)
      }, delayMs)
    })
  }, [bumpLspRevision])

  useEffect(
    () => () => {
      if (crashRetryTimerRef.current != null) {
        window.clearTimeout(crashRetryTimerRef.current)
        crashRetryTimerRef.current = null
      }
    },
    [],
  )

  return {
    lspManager: runtimeRef.current?.manager ?? null,
    lspClientPool: runtimeRef.current?.pool ?? null,
    lspRevision,
    bumpLspRevision,
    resolveLspClient,
    ensureLspForFile,
    handleLspAttachFailed,
    stopLspServersForRoot,
    lspStatus,
    setLspStatus,
  }
}
