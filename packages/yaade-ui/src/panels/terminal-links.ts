import type { ILink, ILinkHandler, ILinkProvider, Terminal } from "@xterm/xterm"
import { fileUriToPath } from "@yaade/shared"

export type TerminalPathLinkHandler = (path: string, line?: number, column?: number) => void

type ParsedPathLink = {
  startIndex: number
  length: number
  path: string
  line?: number
  column?: number
}

type ParsedUrlLink = {
  startIndex: number
  length: number
  url: string
}

const FILE_URI_RE =
  /file:\/\/[^\s'")\]]+?(?::(\d+))?(?::(\d+))?(?=$|[\s'")\]])/g
const ABS_UNIX_PATH_RE =
  /(?:^|[\s('"])(\/(?:[^\s:']+\/)*[^\s:']+)(?::(\d+))?(?::(\d+))?/g
const REL_PATH_RE =
  /(?:^|[\s('"])((?:\.\/)?[\w][\w./-]*\.[A-Za-z0-9]+)(?::(\d+))?(?::(\d+))?/g

/** Match `@xterm/addon-web-links` strict URL regex (http/https only). */
const URL_RE =
  /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\\^<>`]*[^\s"':,.!?{}|\\\^~\[\]`()<>]/g

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/i.test(navigator.platform)
}

/** VS Code convention: Cmd on macOS, Ctrl elsewhere. */
export function isTerminalLinkModifier(event: Pick<MouseEvent, "metaKey" | "ctrlKey">): boolean {
  return isMacPlatform() ? event.metaKey : event.ctrlKey
}

export function openTerminalUrl(uri: string): void {
  let href: string
  try {
    const parsed = new URL(uri)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return
    href = parsed.href
  } catch {
    return
  }
  const win = window.open()
  if (!win) {
    console.warn("Opening terminal link blocked (window.open returned null)")
    return
  }
  try {
    win.opener = null
  } catch {
    // Electron can throw when clearing opener.
  }
  win.location.href = href
}

function pushUniquePath(links: ParsedPathLink[], next: ParsedPathLink): void {
  const overlaps = links.some(
    link =>
      next.startIndex < link.startIndex + link.length &&
      next.startIndex + next.length > link.startIndex,
  )
  if (!overlaps) links.push(next)
}

export function scanTerminalPathLinks(text: string): ParsedPathLink[] {
  const links: ParsedPathLink[] = []

  for (const match of text.matchAll(FILE_URI_RE)) {
    const raw = match[0]
    const line = match[1] ? Number.parseInt(match[1], 10) : undefined
    const column = match[2] ? Number.parseInt(match[2], 10) : undefined
    const withoutSuffix = raw.replace(/:(\d+)(?::\d+)?$/, "")
    pushUniquePath(links, {
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
    pushUniquePath(links, {
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
    pushUniquePath(links, {
      startIndex,
      length: path.length + suffix.length,
      path,
      line: Number.isFinite(line) ? line : undefined,
      column: Number.isFinite(column) ? column : undefined,
    })
  }

  return links.sort((a, b) => a.startIndex - b.startIndex)
}

export function scanTerminalUrlLinks(text: string): ParsedUrlLink[] {
  const links: ParsedUrlLink[] = []
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0]
    if (!url) continue
    links.push({
      startIndex: match.index ?? 0,
      length: url.length,
      url,
    })
  }
  return links
}

function attachLinkDecorations(link: ILink): void {
  // Underline + pointer on hover so links are discoverable; activate still
  // requires Cmd/Ctrl so plain clicks reach the PTY / selection.
  link.decorations = { underline: true, pointerCursor: true }
}

export function registerTerminalUrlLinks(term: Terminal): { dispose: () => void } {
  const provider: ILinkProvider = {
    provideLinks(bufferLineNumber, callback) {
      const line = term.buffer.active.getLine(bufferLineNumber - 1)
      if (!line) {
        callback(undefined)
        return
      }
      const text = line.translateToString(true)
      const parsed = scanTerminalUrlLinks(text)
      if (parsed.length === 0) {
        callback(undefined)
        return
      }
      const links: ILink[] = parsed.map(parsedLink => {
        const link: ILink = {
          range: {
            start: { x: parsedLink.startIndex + 1, y: bufferLineNumber },
            end: { x: parsedLink.startIndex + parsedLink.length, y: bufferLineNumber },
          },
          text: parsedLink.url,
          activate: (event) => {
            if (!isTerminalLinkModifier(event)) return
            openTerminalUrl(parsedLink.url)
          },
        }
        attachLinkDecorations(link)
        return link
      })
      callback(links)
    },
  }
  const disposable = term.registerLinkProvider(provider)
  return { dispose: () => disposable.dispose() }
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
      const links: ILink[] = parsed.map(parsedLink => {
        const link: ILink = {
          range: {
            start: { x: parsedLink.startIndex + 1, y: bufferLineNumber },
            end: {
              x: parsedLink.startIndex + parsedLink.length,
              y: bufferLineNumber,
            },
          },
          text: text.slice(parsedLink.startIndex, parsedLink.startIndex + parsedLink.length),
          activate: (event) => {
            if (!isTerminalLinkModifier(event)) return
            onOpenPath(parsedLink.path, parsedLink.line, parsedLink.column)
          },
        }
        attachLinkDecorations(link)
        return link
      })
      callback(links)
    },
  }
  const disposable = term.registerLinkProvider(provider)
  return { dispose: () => disposable.dispose() }
}

/** OSC 8 hyperlinks — same Cmd/Ctrl-click + underline behavior as scanned URLs. */
export function createTerminalOscLinkHandler(): ILinkHandler {
  return {
    activate(event, text) {
      if (!isTerminalLinkModifier(event)) return
      openTerminalUrl(text)
    },
  }
}
