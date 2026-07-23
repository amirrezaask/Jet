import type { AgentConnectionState } from "@gharargah/agents"
import { Bug } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "../../components/ui/button.js"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js"

function redact(value: unknown): string {
  return JSON.stringify(
    value,
    (key, item) => (/token|secret|authorization|password/i.test(key) ? "[redacted]" : item),
    2,
  )
}

export function AcpInspector(props: {
  connection: AgentConnectionState | null | undefined
  trace?: unknown
  onLoadTrace?: () => Promise<unknown>
  onForceStop?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [trace, setTrace] = useState<unknown>(props.trace)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setTrace(props.trace)
  }, [props.trace])

  useEffect(() => {
    if (!open || !props.onLoadTrace) return
    let cancelled = false
    setLoading(true)
    void props
      .onLoadTrace()
      .then(next => {
        if (!cancelled) setTrace(next)
      })
      .catch(error => {
        if (!cancelled) {
          setTrace({
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, props.onLoadTrace])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Inspect ACP session"
        onClick={() => setOpen(true)}
      >
        <Bug />
      </Button>
      <DialogContent size="wide">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span>ACP inspector</span>
            {props.onForceStop ? (
              <Button type="button" size="xs" variant="destructive" onClick={() => props.onForceStop?.()}>
                Force stop
              </Button>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {props.connection?.status ?? "No connection state"}
            {loading ? " · loading…" : null}
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-[50vh] overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs text-muted-foreground">
          {redact(trace ?? [])}
        </pre>
      </DialogContent>
    </Dialog>
  )
}
