export type PendingEditorNavigation = {
  line: number
  column: number
  endLine?: number
  endColumn?: number
}

const pendingNavigation = new Map<string, PendingEditorNavigation>()
const pendingInitialContent = new Map<string, string>()

function canonicalUri(uri: string): string {
  return uri
}

export function setPendingEditorNavigation(
  uri: string,
  nav: PendingEditorNavigation,
): void {
  pendingNavigation.set(canonicalUri(uri), nav)
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
  pendingInitialContent.set(canonicalUri(uri), content)
}

export function consumePendingInitialContent(uri: string): string | undefined {
  const key = canonicalUri(uri)
  const content = pendingInitialContent.get(key)
  if (content != null) pendingInitialContent.delete(key)
  return content
}
