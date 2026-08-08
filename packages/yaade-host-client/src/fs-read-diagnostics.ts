export type FsReadUriDiagnostic = {
  uri: string
  count: number
  bytes: number
  totalDurationMs: number
  errorCount: number
}

export type FsReadDiagnostics = {
  totalCount: number
  totalBytes: number
  totalDurationMs: number
  errorCount: number
  inFlightCount: number
  byUri: FsReadUriDiagnostic[]
}

type MutableFsReadDiagnostic = Omit<FsReadUriDiagnostic, "uri">

let enabled = false
let inFlightCount = 0
const readsByUri = new Map<string, MutableFsReadDiagnostic>()

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now()
}

/** Exact UTF-8 byte length without allocating another file-sized buffer. */
function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x80) {
      bytes++
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i++
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}

export function fsReadDiagnosticsEnabled(): boolean {
  return enabled
}

export async function readFileWithDiagnostics(
  uri: string,
  read: () => Promise<string>,
): Promise<string> {
  if (!enabled) return read()

  const startedAt = nowMs()
  const entry = readsByUri.get(uri) ?? {
    count: 0,
    bytes: 0,
    totalDurationMs: 0,
    errorCount: 0,
  }
  readsByUri.set(uri, entry)
  entry.count++
  inFlightCount++
  try {
    const value = await read()
    entry.bytes += utf8ByteLength(value)
    return value
  } catch (error) {
    entry.errorCount++
    throw error
  } finally {
    entry.totalDurationMs += nowMs() - startedAt
    inFlightCount = Math.max(0, inFlightCount - 1)
  }
}

export async function readTextFileWithDiagnostics<T extends { content: string }>(
  uri: string,
  read: () => Promise<T>,
): Promise<T> {
  if (!enabled) return read()

  const startedAt = nowMs()
  const entry = readsByUri.get(uri) ?? {
    count: 0,
    bytes: 0,
    totalDurationMs: 0,
    errorCount: 0,
  }
  readsByUri.set(uri, entry)
  entry.count++
  inFlightCount++
  try {
    const value = await read()
    entry.bytes += utf8ByteLength(value.content)
    return value
  } catch (error) {
    entry.errorCount++
    throw error
  } finally {
    entry.totalDurationMs += nowMs() - startedAt
    inFlightCount = Math.max(0, inFlightCount - 1)
  }
}

/**
 * Enable collection and return a cumulative, JSON-serializable snapshot.
 * Collection is off until the first diagnostics read so normal users do not
 * pay a second pass over file contents.
 */
export function getFsReadDiagnostics(): FsReadDiagnostics {
  enabled = true
  const byUri = [...readsByUri.entries()]
    .map(([uri, entry]) => ({ uri, ...entry }))
    .sort((a, b) => a.uri.localeCompare(b.uri))
  return {
    totalCount: byUri.reduce((sum, entry) => sum + entry.count, 0),
    totalBytes: byUri.reduce((sum, entry) => sum + entry.bytes, 0),
    totalDurationMs: byUri.reduce((sum, entry) => sum + entry.totalDurationMs, 0),
    errorCount: byUri.reduce((sum, entry) => sum + entry.errorCount, 0),
    inFlightCount,
    byUri,
  }
}
