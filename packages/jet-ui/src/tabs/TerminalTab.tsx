import { Terminal } from "lucide-react"

export function TerminalTab() {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-2 text-[var(--jet-text-muted)]"
      role="region"
      aria-label="Terminal"
    >
      <Terminal className="size-8 opacity-40" />
      <p className="text-sm">Integrated terminal</p>
      <p className="max-w-xs text-center text-xs opacity-70">
        Coming soon — Electron will use node-pty + xterm. Browser mode shows this placeholder.
      </p>
    </div>
  )
}
