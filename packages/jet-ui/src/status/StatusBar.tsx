export type StatusBarProps = {
  message: string | null
  lspStatus: "connected" | "off" | "unavailable"
  line?: number
  column?: number
  encoding?: string
}

export function StatusBar({ message, lspStatus, line, column, encoding = "UTF-8" }: StatusBarProps) {
  const lspLabel =
    lspStatus === "connected" ? "LSP: connected" : lspStatus === "off" ? "LSP: off" : "LSP: n/a"

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-[var(--jet-border)] bg-[var(--jet-panel)] px-2 text-[10px] text-[var(--jet-text-muted)]">
      <span className="min-w-0 flex-1 truncate">{message ?? "Ready"}</span>
      <span className="shrink-0">{lspLabel}</span>
      {line != null && column != null && (
        <span className="shrink-0 tabular-nums">
          Ln {line}, Col {column}
        </span>
      )}
      <span className="shrink-0">{encoding}</span>
    </footer>
  )
}
