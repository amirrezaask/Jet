import type { AgentToolCall } from "@gharargah/agents"
import { CheckCircle2, ChevronRight, CircleAlert, Loader2, Terminal } from "lucide-react"
import { useState } from "react"
import { Button } from "../../components/ui/button.js"

function elapsed(toolCall: AgentToolCall): string | null {
  if (!toolCall.startedAt || !toolCall.completedAt) return null
  const milliseconds = new Date(toolCall.completedAt).getTime() - new Date(toolCall.startedAt).getTime()
  return Number.isFinite(milliseconds) ? `${Math.max(0, Math.round(milliseconds / 1000))}s` : null
}

export function ToolCallCard(props: { toolCall: AgentToolCall }) {
  const { toolCall } = props
  const [open, setOpen] = useState(false)
  const Icon =
    toolCall.status === "completed" ? CheckCircle2 : toolCall.status === "failed" ? CircleAlert : toolCall.status === "running" ? Loader2 : Terminal
  return (
    <section className="rounded-lg border border-border bg-card">
      <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <ChevronRight className={open ? "size-3 rotate-90" : "size-3"} />
        <Icon className={toolCall.status === "running" ? "size-3.5 animate-spin" : "size-3.5"} />
        <span className="min-w-0 flex-1 truncate text-left font-mono text-xs">{toolCall.name}</span>
        <span className="text-3xs text-muted-foreground">{elapsed(toolCall) ?? toolCall.status}</span>
      </Button>
      {open ? (
        <div className="space-y-2 border-t border-border px-3 py-2">
          {toolCall.input ? <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">{toolCall.input}</pre> : null}
          {toolCall.output ? <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">{toolCall.output}</pre> : null}
          {toolCall.error ? <p className="text-xs text-destructive">{toolCall.error}</p> : null}
        </div>
      ) : null}
    </section>
  )
}
