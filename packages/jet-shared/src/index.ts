export type Disposable = { dispose(): void }

export class Emitter<T> {
  private listeners = new Set<(value: T) => void>()

  event = (listener: (value: T) => void): Disposable => {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  fire(value: T): void {
    for (const listener of this.listeners) listener(value)
  }
}

export function pathToFileUri(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  if (normalized.startsWith("/")) return `file://${normalized}`
  return `file:///${normalized}`
}

export function fileUriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri
  let path = decodeURIComponent(uri.slice(7))
  // file:///C:/... on Windows
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1)
  return path
}

export function basename(uriOrPath: string): string {
  const path = uriOrPath.startsWith("file://") ? fileUriToPath(uriOrPath) : uriOrPath
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

export function extname(uriOrPath: string): string {
  const name = basename(uriOrPath)
  const dot = name.lastIndexOf(".")
  return dot >= 0 ? name.slice(dot) : ""
}

export function languageIdFromPath(path: string): string {
  const ext = extname(path).toLowerCase()
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".rs": "rust",
    ".json": "json",
    ".md": "markdown",
    ".css": "css",
    ".html": "html",
    ".htm": "html",
  }
  return map[ext] ?? "plaintext"
}

export * from "./git.js"
export * from "./panels.js"
