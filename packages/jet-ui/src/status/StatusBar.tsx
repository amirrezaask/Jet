import { useSyncExternalStore } from "react"
import { formatKeyBinding } from "../lib/format-key.js"
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

const HINT_SEGMENTS = [
  { key: "Cmd-Shift-p", desc: "commands" },
  { key: "Cmd-p", desc: "quick open" },
  { key: "Cmd-k Cmd-f", desc: "find file" },
  { key: "Cmd-s", desc: "save" },
  { key: "Cmd-Shift-f", desc: "search" },
  { key: "Cmd-w", desc: "close" },
]

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
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-[var(--jet-border)] bg-[var(--jet-panel)] px-2 text-[length:var(--jet-fs-xs)] normal-case tracking-[0.08em] text-[var(--jet-text-muted)]">
      <span className="inline-block h-4 w-px shrink-0 bg-[var(--jet-accent)]" aria-hidden />
      <span
        className="min-w-0 shrink truncate uppercase text-[var(--jet-text)]"
        title={workspacePath ?? undefined}
      >
        {workspaceLabel}
      </span>
      {gitBranch && (
        <span className="jet-mono-data shrink-0 uppercase text-[var(--jet-accent)]">{gitBranch}</span>
      )}
      {message ? (
        <span className="min-w-0 max-w-[20rem] flex-1 shrink truncate text-[var(--jet-text)]">
          {message}
        </span>
      ) : (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-1 overflow-hidden text-[length:var(--jet-fs-sm)] opacity-60">
          {HINT_SEGMENTS.map(seg => (
            <span key={seg.key} className="jet-mono-data whitespace-nowrap">
              <span className="font-semibold text-[var(--jet-accent)]">{formatKeyBinding(seg.key)}</span>
              {" "}
              {seg.desc}
            </span>
          ))}
        </div>
      )}

      {activeFileName && (
        <span className="jet-mono-data flex min-w-0 shrink-0 items-center gap-2">
          {activeFileDirty && (
            <span className="text-[var(--jet-accent)]" aria-hidden>
              ●
            </span>
          )}
          <span className="truncate text-[var(--jet-text)]">{activeFileName}</span>
          {lang && <span className="uppercase tracking-[0.09em] opacity-50">{lang}</span>}
        </span>
      )}
      {cursor != null && (
        <span className="jet-mono-data shrink-0 opacity-[.78]">
          Ln {cursor.line}, Col {cursor.column}
        </span>
      )}
      {activeFileName && <span className="jet-mono-data shrink-0 opacity-40">UTF-8 · LF</span>}

      <span className="jet-mono-data flex shrink-0 items-center gap-1 uppercase">
        <span className={lspDotClass(lspStatus)} aria-hidden>
          ●
        </span>
        <span>LSP {lspShortLabel(lspStatus)}</span>
      </span>
    </footer>
  )
}
