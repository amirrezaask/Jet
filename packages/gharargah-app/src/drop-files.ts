import { basename, pathToFileUri } from "@gharargah/shared"
import type { FileSystemProvider, LaunchConfig } from "@gharargah/workspace"
import { isPathUnderRoot, normalizeAbsPath } from "@gharargah/workspace"

const WORKSPACE_MARKERS = [
  ".git",
  "package.json",
  "tsconfig.json",
  "Cargo.toml",
  "go.mod",
  ".gharargah",
] as const

function dirname(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/")
  const idx = normalized.lastIndexOf("/")
  if (idx <= 0) return normalized.startsWith("/") ? "/" : "."
  return normalized.slice(0, idx) || "/"
}

async function markerExists(
  dir: string,
  marker: string,
  fs: FileSystemProvider,
): Promise<boolean> {
  const uri = pathToFileUri(`${dir.replace(/\\/g, "/")}/${marker}`)
  try {
    const info = await fs.stat(uri)
    if (marker === ".git") return info.isDirectory
    return !info.isDirectory
  } catch {
    return false
  }
}

export async function findWorkspaceRoot(startDir: string, fs: FileSystemProvider): Promise<string> {
  let current = startDir.replace(/\\/g, "/")
  for (let i = 0; i < 20; i++) {
    for (const marker of WORKSPACE_MARKERS) {
      if (await markerExists(current, marker, fs)) return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return startDir.replace(/\\/g, "/")
}

export async function resolveDroppedPath(
  absPath: string,
  fs: FileSystemProvider,
): Promise<LaunchConfig> {
  const uri = pathToFileUri(absPath)
  const stat = await fs.stat(uri)
  if (stat.isDirectory) {
    return { workspacePath: absPath }
  }
  const parentDir = dirname(absPath)
  const workspacePath = await findWorkspaceRoot(parentDir, fs)
  return { workspacePath, filePath: absPath }
}

export function pathsFromDataTransfer(dt: DataTransfer): string[] {
  const paths: string[] = []
  for (const file of dt.files) {
    const p = (file as File & { path?: string }).path
    if (p) paths.push(p)
  }
  return paths
}

export type DropZone = "terminal" | "editor" | "other"

export function resolveDropZoneFromElement(el: Element | null): DropZone {
  if (!el) return "other"
  if (el.closest("[data-gharargah-terminal-panel]")) return "terminal"
  if (el.closest("[data-gharargah-editor-scroll-area], .cm-editor, .cm-content")) return "editor"
  return "other"
}

export function resolveDropZoneAtPoint(x: number, y: number): DropZone {
  return resolveDropZoneFromElement(document.elementFromPoint(x, y))
}

/** Shell-safe path for terminal paste (spaces/special chars quoted). */
export function shellQuotePath(path: string): string {
  if (/^[\w@./~+-]+$/.test(path)) return path
  return `'${path.replace(/'/g, `'\"'\"'`)}'`
}

export function formatPathsForTerminal(paths: string[]): string {
  return paths.map(shellQuotePath).join(" ")
}

export function terminalPtyIdFromElement(el: Element | null): string | null {
  const panel = el?.closest("[data-gharargah-terminal-panel]")
  const id = panel?.getAttribute("data-gharargah-terminal-pty-id")
  return id && id.length > 0 ? id : null
}

export type ProcessDroppedPathsContext = {
  fs: FileSystemProvider
  normalizePath: (p: string) => string
  knownWorkspacePaths: string[]
  openWorkspace: (path: string) => void
  addWorkspaceFolder: (path: string) => void
  openFile: (uri: string, path: string) => void
  bootstrapFromLaunch: (config: LaunchConfig) => void
  setMessage: (msg: string) => void
}

function workspacePathIsOpen(normPath: string, known: string[]): boolean {
  return known.some(
    k => normPath === k || isPathUnderRoot(normPath, k) || isPathUnderRoot(k, normPath),
  )
}

export async function processDroppedPaths(
  paths: string[],
  ctx: ProcessDroppedPathsContext,
): Promise<void> {
  if (paths.length === 0) return

  const normalized = [...new Set(paths.map(p => ctx.normalizePath(p)))]
  const resolved: LaunchConfig[] = []

  for (const p of normalized) {
    try {
      resolved.push(await resolveDroppedPath(p, ctx.fs))
    } catch {
      ctx.setMessage(`Could not open: ${basename(p)}`)
    }
  }
  if (resolved.length === 0) return

  let workspacePath = resolved[0]!.workspacePath
  const filesToOpen: string[] = []

  for (const cfg of resolved) {
    if (cfg.filePath) filesToOpen.push(cfg.filePath)
    if (!cfg.filePath) workspacePath = cfg.workspacePath
  }

  const known = ctx.knownWorkspacePaths.map(p => ctx.normalizePath(p))
  const next = ctx.normalizePath(workspacePath)

  if (filesToOpen.length === 0) {
    if (known.some(k => normalizeAbsPath(k) === next)) return
    if (known.length > 0) {
      ctx.addWorkspaceFolder(next)
    } else {
      ctx.openWorkspace(next)
    }
    return
  }

  if (workspacePathIsOpen(next, known)) {
    for (const fp of filesToOpen) {
      ctx.openFile(pathToFileUri(fp), fp)
    }
    return
  }

  if (known.length > 0) {
    ctx.addWorkspaceFolder(next)
    for (const fp of filesToOpen) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => ctx.openFile(pathToFileUri(fp), fp))
      })
    }
    return
  }

  ctx.bootstrapFromLaunch({ workspacePath: next, filePath: filesToOpen[0] })
  for (let i = 1; i < filesToOpen.length; i++) {
    const fp = filesToOpen[i]!
    requestAnimationFrame(() => {
      requestAnimationFrame(() => ctx.openFile(pathToFileUri(fp), fp))
    })
  }
}

export async function handleDroppedPaths(
  paths: string[],
  zone: DropZone,
  targetEl: Element | null,
  ctx: ProcessDroppedPathsContext,
): Promise<void> {
  if (paths.length === 0) return

  if (zone === "terminal") {
    const ptyId = terminalPtyIdFromElement(targetEl)
    const terminal = typeof window !== "undefined" ? window.gharargah?.terminal : undefined
    if (ptyId && terminal) {
      void terminal.write(ptyId, formatPathsForTerminal(paths))
      return
    }
    ctx.setMessage("Terminal not ready for file drop")
    return
  }

  await processDroppedPaths(paths, ctx)
}
