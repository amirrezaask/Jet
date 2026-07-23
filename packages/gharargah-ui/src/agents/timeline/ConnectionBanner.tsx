import type { AgentConnectionState } from "@gharargah/agents"
import { CircleAlert, Loader2, PlugZap } from "lucide-react"

export function ConnectionBanner(props: { connection: AgentConnectionState | null | undefined }) {
  const { connection } = props
  if (!connection || connection.status === "connected") return null
  const isError = connection.status === "error" || connection.status === "disconnected"
  const Icon = isError ? CircleAlert : connection.status === "authenticating" ? PlugZap : Loader2
  return (
    <div className={isError ? "flex items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive" : "flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground"}>
      <Icon className={isError ? "size-3.5" : "size-3.5 animate-spin"} />
      <span>{connection.message ?? connection.status.replaceAll("_", " ")}</span>
    </div>
  )
}
