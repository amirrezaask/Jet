import type {
  DidChangeWatchedFilesRegistrationOptions,
  FileSystemWatcher,
} from "vscode-languageserver-protocol"

export type WorkspaceFileChangeKind = "created" | "changed" | "deleted"

export type WorkspaceFileChange = {
  uri: string
  kind: WorkspaceFileChangeKind
}

const WATCH_KIND = {
  created: 1,
  changed: 2,
  deleted: 4,
} as const

function escapeRegex(character: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character
}

/** LSP glob matcher supporting `*`, `**`, `?`, character ranges, and braces. */
export function lspGlobMatches(pattern: string, candidate: string): boolean {
  let expression = ""
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        index++
        if (pattern[index + 1] === "/") {
          index++
          expression += "(?:.*/)?"
        } else {
          expression += ".*"
        }
      } else {
        expression += "[^/]*"
      }
      continue
    }
    if (character === "?") {
      expression += "[^/]"
      continue
    }
    if (character === "[") {
      const end = pattern.indexOf("]", index + 1)
      if (end >= 0) {
        expression += pattern.slice(index, end + 1)
        index = end
        continue
      }
    }
    if (character === "{") {
      const end = pattern.indexOf("}", index + 1)
      if (end >= 0) {
        const choices = pattern.slice(index + 1, end).split(",").map(choice =>
          choice.split("").map(escapeRegex).join(""),
        )
        expression += `(?:${choices.join("|")})`
        index = end
        continue
      }
    }
    expression += escapeRegex(character)
  }
  return new RegExp(`^${expression}$`).test(candidate.replaceAll("\\", "/"))
}

function uriPath(uri: string): string | null {
  try {
    return decodeURIComponent(new URL(uri).pathname).replaceAll("\\", "/")
  } catch {
    return null
  }
}

function relativePath(baseUri: string, uri: string): string | null {
  const base = uriPath(baseUri)?.replace(/\/$/, "")
  const file = uriPath(uri)
  if (!base || !file || (file !== base && !file.startsWith(`${base}/`))) return null
  return file === base ? "" : file.slice(base.length + 1)
}

function watcherPattern(
  watcher: FileSystemWatcher,
  projectRootUri: string,
): { baseUri: string; pattern: string } | null {
  if (typeof watcher.globPattern === "string") {
    return { baseUri: projectRootUri, pattern: watcher.globPattern }
  }
  const baseUri = typeof watcher.globPattern.baseUri === "string"
    ? watcher.globPattern.baseUri
    : watcher.globPattern.baseUri.uri
  return { baseUri, pattern: watcher.globPattern.pattern }
}

export function watchedFileChanges(
  options: DidChangeWatchedFilesRegistrationOptions,
  projectRootUri: string,
  event: WorkspaceFileChange,
): Array<{ uri: string; type: 1 | 2 | 3 }> {
  const kind = WATCH_KIND[event.kind]
  for (const watcher of options.watchers) {
    if (((watcher.kind ?? 7) & kind) === 0) continue
    const glob = watcherPattern(watcher, projectRootUri)
    if (!glob) continue
    const candidate = relativePath(glob.baseUri, event.uri)
    if (candidate != null && lspGlobMatches(glob.pattern, candidate)) {
      return [{
        uri: event.uri,
        type: event.kind === "created" ? 1 : event.kind === "changed" ? 2 : 3,
      }]
    }
  }
  return []
}
