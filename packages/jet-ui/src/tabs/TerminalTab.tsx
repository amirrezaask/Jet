import { useEffect, useRef } from "react"
import { Terminal } from "lucide-react"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import type { WorkspaceService } from "@jet/workspace"
import "@xterm/xterm/css/xterm.css"

export function TerminalTab({ workspace }: { workspace: WorkspaceService }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)

  useEffect(() => {
    const terminalApi = window.jet?.terminal
    if (!terminalApi || !workspace.root || !containerRef.current) return

    const term = new XTerm({
      theme: {
        background: "#101010",
        foreground: "#cdd6f4",
        cursor: "#cba6f7",
      },
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()
    termRef.current = term

    let termId: string | null = null
    let unsub: (() => void) | null = null

    void terminalApi.create(workspace.root.uri).then(({ id }) => {
      termId = id
      unsub = terminalApi.onData(id, data => term.write(data))
      term.onData(data => void terminalApi.write(id, data))
      const ro = new ResizeObserver(() => {
        fit.fit()
        void terminalApi.resize(id, term.cols, term.rows)
      })
      ro.observe(containerRef.current!)
      termRef.current = term
      return () => ro.disconnect()
    })

    return () => {
      unsub?.()
      if (termId) void terminalApi.dispose(termId)
      term.dispose()
      termRef.current = null
    }
  }, [workspace.root])

  if (!window.jet?.terminal) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 text-[var(--jet-text-muted)]"
        role="region"
        aria-label="Terminal"
      >
        <Terminal className="size-8 opacity-40" />
        <p className="text-sm">Integrated terminal</p>
        <p className="max-w-xs text-center text-xs opacity-70">
          Terminal requires Electron (node-pty + xterm). Browser mode shows this placeholder.
        </p>
      </div>
    )
  }

  return <div ref={containerRef} className="h-full w-full bg-[#101010] p-1" />
}
