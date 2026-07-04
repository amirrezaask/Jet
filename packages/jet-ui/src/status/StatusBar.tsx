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
    <footer className="flex h-6 shrink-0 items-center gap-2 border-t border-border bg-muted px-2 text-xs text-muted-foreground">
      <span
        className="min-w-0 shrink truncate text-foreground"
        title={workspacePath ?? undefined}
      >
        {workspaceLabel}
      </span>
      {gitBranch && (
        <>
          <Separator orientation="vertical" className="h-3" />
          <span className="jet-mono-data shrink-0 text-foreground">{gitBranch}</span>
        </>
      )}
      {message ? (
        <span className="min-w-0 max-w-[20rem] flex-1 shrink truncate text-foreground">{message}</span>
      ) : (
        <span className="min-w-0 flex-1" aria-hidden />
      )}

      {activeFileName && (
        <span className="jet-mono-data flex min-w-0 shrink-0 items-center gap-2">
          {activeFileDirty && (
            <span className="text-foreground" aria-hidden>
              ●
            </span>
          )}
          <span className="truncate text-foreground">{activeFileName}</span>
          {lang && <span className="opacity-50">{lang}</span>}
        </span>
      )}
      {cursor != null && (
        <span className="jet-mono-data shrink-0 opacity-80">
          Ln {cursor.line}, Col {cursor.column}
        </span>
      )}
      {activeFileName && <span className="jet-mono-data shrink-0 opacity-40">UTF-8 · LF</span>}

      <span className="jet-mono-data flex shrink-0 items-center gap-1">
        <span className={lspDotClass(lspStatus)} aria-hidden>
          ●
        </span>
        <span>LSP {lspShortLabel(lspStatus)}</span>
      </span>
    </footer>
  )
}
