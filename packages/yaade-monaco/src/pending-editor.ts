import { canonicalizeFileUri } from "@yaade/shared"

export type PendingEditorNavigation = {
  line: number
  column: number
  endLine?: number
  endColumn?: number
}

const pendingNavigation = new Map<string, PendingEditorNavigation>()
const pendingInitialContent = new Map<string, string>()
const MAX_PENDING_ENTRIES = 256

function canonicalUri(uri: string): string {
  if (uri.startsWith("file://")) return canonicalizeFileUri(uri)
  return uri
}

function setBounded<T>(map: Map<string, T>, key: string, value: T): void {
  map.delete(key)
  map.set(key, value)
  if (map.size <= MAX_PENDING_ENTRIES) return
  const oldest = map.keys().next().value
  if (oldest != null) map.delete(oldest)
}

export function setPendingEditorNavigation(
  uri: string,
  nav: PendingEditorNavigation,
): void {
  setBounded(pendingNavigation, canonicalUri(uri), nav)
}

export function consumePendingEditorNavigation(
  uri: string,
): PendingEditorNavigation | undefined {
  const key = canonicalUri(uri)
  const nav = pendingNavigation.get(key)
  if (nav) pendingNavigation.delete(key)
  return nav
}

export function setPendingInitialContent(uri: string, content: string): void {
  setBounded(pendingInitialContent, canonicalUri(uri), content)
}

export function consumePendingInitialContent(uri: string): string | undefined {
  const key = canonicalUri(uri)
  const content = pendingInitialContent.get(key)
  if (content != null) pendingInitialContent.delete(key)
  return content
}
