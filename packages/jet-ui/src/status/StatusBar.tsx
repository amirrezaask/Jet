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
}

export function StatusBar({
  message,
  lspStatus,
  workspaceName,
  workspacePath,
  gitBranch,
  showCursor = false,
  encoding = "UTF-8",
}: StatusBarProps) {
  const cursor = useSyncExternalStore(subscribeEditorCursor, getEditorCursor, getEditorCursor)
  const lspLabel =
    lspStatus === "connected" ? "LSP: connected" : lspStatus === "off" ? "LSP: off" : "LSP: n/a"

  const leftLabel = workspaceName ?? workspacePath ?? message ?? "Ready"

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-[var(--jet-border)] bg-[var(--jet-panel)] px-2 text-[10px] text-[var(--jet-text-muted)]">
      <span className="min-w-0 flex-1 truncate" title={workspacePath ?? undefined}>
        {leftLabel}
      </span>
      {gitBranch && <span className="shrink-0 font-mono text-[var(--jet-accent)]">{gitBranch}</span>}
      {message && workspaceName && (
        <span className="hidden shrink-0 truncate sm:inline max-w-[12rem]">{message}</span>
      )}
      <span className="shrink-0">{lspLabel}</span>
      {showCursor && cursor != null && (
        <span className="shrink-0 tabular-nums">
          Ln {cursor.line}, Col {cursor.column}
        </span>
      )}
      <span className="shrink-0">{encoding}</span>
    </footer>
  )
}
