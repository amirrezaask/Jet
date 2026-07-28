import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm"
import { fileUriToPath } from "@gharargah/shared"

export type TerminalPathLinkHandler = (path: string, line?: number, column?: number) => void

type ParsedLink = {
  startIndex: number
  length: number
  path: string
  line?: number
  column?: number
}

const FILE_URI_RE =
  /file:\/\/[^\s'")\]]+?(?::(\d+))?(?::(\d+))?(?=$|[\s'")\]])/g
const ABS_UNIX_PATH_RE =
  /(?:^|[\s('"])(\/(?:[^\s:']+\/)*[^\s:']+)(?::(\d+))?(?::(\d+))?/g
const REL_PATH_RE =
  /(?:^|[\s('"])((?:\.\/)?[\w][\w./-]*\.[A-Za-z0-9]+)(?::(\d+))?(?::(\d+))?/g

function pushUnique(links: ParsedLink[], next: ParsedLink): void {
  const overlaps = links.some(
    link =>
      next.startIndex < link.startIndex + link.length &&
      next.startIndex + next.length > link.startIndex,
  )
  if (!overlaps) links.push(next)
}

export function scanTerminalPathLinks(text: string): ParsedLink[] {
  const links: ParsedLink[] = []

  for (const match of text.matchAll(FILE_URI_RE)) {
    const raw = match[0]
    const line = match[1] ? Number.parseInt(match[1], 10) : undefined
    const column = match[2] ? Number.parseInt(match[2], 10) : undefined
    const withoutSuffix = raw.replace(/:(\d+)(?::\d+)?$/, "")
    pushUnique(links, {
      startIndex: match.index ?? 0,
      length: raw.length,
      path: fileUriToPath(withoutSuffix),
      line: Number.isFinite(line) ? line : undefined,
      column: Number.isFinite(column) ? column : undefined,
    })
  }

  for (const match of text.matchAll(ABS_UNIX_PATH_RE)) {
    const path = match[1]
    if (!path) continue
    const line = match[2] ? Number.parseInt(match[2], 10) : undefined
    const column = match[3] ? Number.parseInt(match[3], 10) : undefined
    const startIndex = (match.index ?? 0) + match[0].indexOf(path)
    pushUnique(links, {
      startIndex,
      length: path.length + (match[2] ? `:${match[2]}${match[3] ? `:${match[3]}` : ""}`.length : 0),
      path,
      line: Number.isFinite(line) ? line : undefined,
      column: Number.isFinite(column) ? column : undefined,
    })
  }

  for (const match of text.matchAll(REL_PATH_RE)) {
    const path = match[1]
    if (!path || path.startsWith("file://")) continue
    const line = match[2] ? Number.parseInt(match[2], 10) : undefined
    const column = match[3] ? Number.parseInt(match[3], 10) : undefined
    const suffix = match[2]
      ? `:${match[2]}${match[3] ? `:${match[3]}` : ""}`
      : ""
    const startIndex = (match.index ?? 0) + match[0].indexOf(path)
    pushUnique(links, {
      startIndex,
      length: path.length + suffix.length,
      path,
      line: Number.isFinite(line) ? line : undefined,
      column: Number.isFinite(column) ? column : undefined,
    })
  }

  return links.sort((a, b) => a.startIndex - b.startIndex)
}

export function registerTerminalPathLinks(
  term: Terminal,
  onOpenPath: TerminalPathLinkHandler,
): { dispose: () => void } {
  const provider: ILinkProvider = {
    provideLinks(bufferLineNumber, callback) {
      const line = term.buffer.active.getLine(bufferLineNumber - 1)
      if (!line) {
        callback(undefined)
        return
      }
      const text = line.translateToString(true)
      const parsed = scanTerminalPathLinks(text)
      if (parsed.length === 0) {
        callback(undefined)
        return
      }
      const links: ILink[] = parsed.map(link => ({
        range: {
          start: { x: link.startIndex + 1, y: bufferLineNumber },
          end: { x: link.startIndex + link.length + 1, y: bufferLineNumber },
        },
        text: text.slice(link.startIndex, link.startIndex + link.length),
        activate: () => onOpenPath(link.path, link.line, link.column),
      }))
      callback(links)
    },
  }
  const disposable = term.registerLinkProvider(provider)
  return { dispose: () => disposable.dispose() }
}
