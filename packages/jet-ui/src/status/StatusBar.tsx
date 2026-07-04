import { useSyncExternalStore } from "react"
import { Separator } from "@/components/ui/separator.js"
import { getEditorCursor, subscribeEditorCursor } from "./editor-cursor-store.js"

export type StatusBarProps = {
  message: string | null
  lspStatus: "connected" | "off" | "unavailable"
  workspaceName?: string | null
  workspacePath?: string | null
  gitBranch?: string | null
  hasWorkspace?: boolean
  activeFileName?: string | null
  activeLanguageId?: string | null
  activeFileDirty?: boolean
}

function lspDotClass(status: StatusBarProps["lspStatus"]): string {
  switch (status) {
    case "connected":
      return "text-[var(--jet-success)]"
    case "off":
      return "text-[var(--jet-warning)]"
    default:
      return "text-muted-foreground"
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
  hasWorkspace = false,
  activeFileName,
  activeLanguageId,
  activeFileDirty = false,
}: StatusBarProps) {
  const cursor = useSyncExternalStore(subscribeEditorCursor, getEditorCursor, getEditorCursor)

  const workspaceLabel = hasWorkspace
    ? (workspaceName ?? workspacePath ?? "Workspace")
    : "No folder open"
  const lang = (activeLanguageId ?? "").toUpperCase()

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-[var(--jet-surface-inset)] px-3 text-[length:var(--jet-fs-2xs)] text-muted-foreground">
      <span className="jet-status-zone min-w-0 shrink" title={workspacePath ?? undefined}>
        <span className={hasWorkspace ? "text-foreground" : undefined}>{workspaceLabel}</span>
        {gitBranch && (
          <>
            <Separator orientation="vertical" className="h-3" />
            <span className="jet-mono-data text-foreground">{gitBranch}</span>
          </>
        )}
      </span>

      {message ? (
        <span className="jet-status-zone min-w-0 max-w-[24rem] flex-1 shrink truncate text-foreground">
          {message}
        </span>
      ) : (
        <span className="min-w-0 flex-1" aria-hidden />
      )}

      {activeFileName && (
        <span className="jet-status-zone jet-mono-data shrink-0">
          {activeFileDirty && (
            <span className="text-[var(--jet-phosphor)]" aria-label="Unsaved changes">
              ●
            </span>
          )}
          <span className="max-w-[12rem] truncate text-foreground">{activeFileName}</span>
          {lang && <span className="opacity-45">{lang}</span>}
        </span>
      )}

      {cursor != null && (
        <span className="jet-status-zone jet-mono-data shrink-0 tabular-nums">
          Ln {cursor.line}, Col {cursor.column}
        </span>
      )}

      {activeFileName && (
        <span className="jet-status-zone jet-mono-data shrink-0 opacity-40">UTF-8 · LF</span>
      )}

      <span className="jet-status-zone jet-mono-data shrink-0">
        <span className={lspDotClass(lspStatus)} aria-hidden>
          ●
        </span>
        <span>LSP {lspShortLabel(lspStatus)}</span>
      </span>
    </footer>
  )
}
