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

import { fileUriToPath } from "./uri.js"

export { type FileUri, isFileUri, pathToFileUri, fileUriToPath } from "./uri.js"

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
    ".tsx": "tsx",
    ".mts": "mts",
    ".cts": "cts",
    ".js": "javascript",
    ".jsx": "jsx",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".rs": "rust",
    ".go": "go",
    ".json": "json",
    ".md": "markdown",
    ".css": "css",
    ".html": "html",
    ".htm": "html",
  }
  return map[ext] ?? "plaintext"
}

/** Map Jet language ids to LSP `textDocument/languageId` values. */
export function lspLanguageIdFromJet(languageId: string): string {
  switch (languageId) {
    case "tsx":
    case "mts":
    case "cts":
      return "typescript"
    case "jsx":
      return "javascript"
    default:
      return languageId
  }
}

export const UNTITLED_SCHEME = "untitled:"

export function isUntitledUri(uri: string): boolean {
  return uri.startsWith(UNTITLED_SCHEME)
}

export function makeUntitledUri(n: number): string {
  return `${UNTITLED_SCHEME}untitled-${n}`
}

export * from "./git.js"
export * from "./panels.js"
export * from "./search.js"
export * from "./diagnostics.js"
export * from "./motion.js"
export * from "./caret-motion.js"
export * from "./rad-motion.js"
export * from "./rad-scroll.js"
export * from "./wheel-delta.js"
