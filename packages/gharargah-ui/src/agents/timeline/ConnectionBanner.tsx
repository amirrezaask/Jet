import type { AgentConnectionState } from "@gharargah/agents"
import { CircleAlert, Loader2, PlugZap } from "lucide-react"
import { Button } from "../../components/ui/button.js"

export function ConnectionBanner(props: {
  connection: AgentConnectionState | null | undefined
  onAuthenticate?: (methodId: string) => void
}) {
  const { connection, onAuthenticate } = props
  if (!connection || !connection.status || connection.status === "connected") return null
  const isError = connection.status === "error" || connection.status === "disconnected"
  const Icon = isError ? CircleAlert : connection.status === "authenticating" ? PlugZap : Loader2
  const authMethods =
    connection.status === "authenticating" ? (connection.authMethods ?? []) : []
  return (
    <div
      className={
        isError
          ? "flex flex-wrap items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive"
          : "flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground"
      }
    >
      <Icon className={isError ? "size-3.5" : "size-3.5 animate-spin"} />
      <span className="min-w-0 flex-1">{connection.message ?? connection.status.replaceAll("_", " ")}</span>
      {connection.status === "authenticating" && onAuthenticate ? (
        authMethods.length > 0 ? (
          authMethods.map(methodId => (
            <Button
              key={methodId}
              type="button"
              size="xs"
              variant="secondary"
              onClick={() => onAuthenticate(methodId)}
            >
              {methodId}
            </Button>
          ))
        ) : (
          <Button type="button" size="xs" variant="secondary" onClick={() => onAuthenticate("")}>
            Authenticate
          </Button>
        )
      ) : null}
    </div>
  )
}
