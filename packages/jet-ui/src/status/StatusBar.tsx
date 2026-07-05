import { useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button.js"
import { Separator } from "@/components/ui/separator.js"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover.js"
import { getEditorCursor, subscribeEditorCursor } from "./editor-cursor-store.js"

export type StatusBarProps = {
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
      return "text-primary"
    case "off":
      return "text-muted-foreground"
    default:
      return "text-muted-foreground/60"
  }
}

function lspLabel(status: StatusBarProps["lspStatus"]): string {
  switch (status) {
    case "connected":
      return "Language server connected"
    case "off":
      return "Language server off"
    default:
      return "Language server unavailable"
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

function lspDetail(status: StatusBarProps["lspStatus"]): string {
  switch (status) {
    case "connected":
      return "Diagnostics, completions, and navigation are available for supported languages."
    case "off":
      return "No language server is attached. Open a TypeScript or Rust file to connect."
    default:
      return "Language server bridge is unavailable in this environment."
  }
}

export function StatusBar({
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
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-muted px-3 text-xs text-muted-foreground">
      {workspacePath ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="jet-status-zone min-w-0 shrink cursor-default">
              <span className={hasWorkspace ? "text-foreground" : undefined}>{workspaceLabel}</span>
              {gitBranch && (
                <>
                  <Separator orientation="vertical" className="h-3" />
                  <span className="jet-mono-data text-foreground">{gitBranch}</span>
                </>
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>{workspacePath}</TooltipContent>
        </Tooltip>
      ) : (
        <span className="jet-status-zone min-w-0 shrink">
          <span className={hasWorkspace ? "text-foreground" : undefined}>{workspaceLabel}</span>
          {gitBranch && (
            <>
              <Separator orientation="vertical" className="h-3" />
              <span className="jet-mono-data text-foreground">{gitBranch}</span>
            </>
          )}
        </span>
      )}

      <span className="min-w-0 flex-1" aria-hidden />

      {activeFileName && (
        <span className="jet-status-zone jet-mono-data min-w-0 shrink">
          {activeFileDirty && (
            <span className="text-primary" aria-label="Unsaved changes">
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

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className="jet-status-zone jet-mono-data shrink-0 cursor-default"
            aria-label={lspLabel(lspStatus)}
          >
            <span className={lspDotClass(lspStatus)} aria-hidden>
              ●
            </span>
            <span>LSP {lspShortLabel(lspStatus)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" sideOffset={6} className="w-64 p-3">
          <PopoverHeader>
            <PopoverTitle>Language Server</PopoverTitle>
            <PopoverDescription>{lspLabel(lspStatus)}</PopoverDescription>
          </PopoverHeader>
          <p className="mt-2 text-xs text-muted-foreground">{lspDetail(lspStatus)}</p>
        </PopoverContent>
      </Popover>
    </footer>
  )
}
