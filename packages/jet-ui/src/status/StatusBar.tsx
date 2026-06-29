import { useSyncExternalStore } from "react"
import { getEditorCursor, subscribeEditorCursor } from "./editor-cursor-store.js"

export type StatusBarProps = {
  message: string | null
  lspStatus: "connected" | "off" | "unavailable"
  workspaceName?: string | null
  workspacePath?: string | null
  gitBranch?: string | null
  showCursor?: boolean
  encoding?: string
  hasWorkspace?: boolean
}

function lspDotClass(status: StatusBarProps["lspStatus"]): string {
  switch (status) {
    case "connected":
      return "text-[var(--jet-success)]"
    case "off":
      return "text-[var(--jet-warning)]"
    default:
      return "text-[var(--jet-text-muted)]"
  }
}

function lspShortLabel(status: StatusBarProps["lspStatus"]): string {
  switch (status) {
    case "connected":
      return "connected"
    case "off":
      return "off"
    default:
      return "n/a"
  }
}

export function StatusBar({
  message,
  lspStatus,
  workspaceName,
  workspacePath,
  gitBranch,
  showCursor = false,
  encoding = "UTF-8",
  hasWorkspace = false,
}: StatusBarProps) {
  const cursor = useSyncExternalStore(subscribeEditorCursor, getEditorCursor, getEditorCursor)

  const workspaceLabel = hasWorkspace
    ? (workspaceName ?? workspacePath ?? "Workspace")
    : "No folder open"

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-[var(--jet-border)] bg-[var(--jet-panel)] px-2 text-[calc(10rem/13)] text-[var(--jet-text-muted)]">
      <span className="min-w-0 flex-1 truncate" title={workspacePath ?? undefined}>
        {workspaceLabel}
      </span>
      {gitBranch && (
        <span className="jet-mono-data shrink-0 text-[var(--jet-accent)]">{gitBranch}</span>
      )}
      {message && (
        <span className="min-w-0 max-w-[14rem] shrink truncate text-[var(--jet-text)]">
          {message}
        </span>
      )}
      <span className="jet-mono-data flex shrink-0 items-center gap-1">
        <span className={lspDotClass(lspStatus)} aria-hidden>
          ●
        </span>
        <span>LSP {lspShortLabel(lspStatus)}</span>
      </span>
      {showCursor && cursor != null && (
        <span className="jet-mono-data shrink-0">
          Ln {cursor.line}, Col {cursor.column}
        </span>
      )}
      <span className="jet-mono-data shrink-0">{encoding}</span>
    </footer>
  )
}
