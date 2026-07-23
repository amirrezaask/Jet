import type { AgentPermissionRequest, ResolveAgentPermissionInput } from "@gharargah/agents"
import { ShieldAlert } from "lucide-react"
import { Button } from "../../components/ui/button.js"

export function PermissionCard(props: {
  permission: AgentPermissionRequest
  disabled?: boolean
  onResolve: (input: Pick<ResolveAgentPermissionInput, "permissionId" | "decision">) => void
}) {
  const { permission, disabled = false, onResolve } = props
  const allowsAlways = permission.options?.includes("allow_always") ?? true
  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{permission.title}</h3>
          {permission.description ? <p className="mt-1 text-xs text-muted-foreground">{permission.description}</p> : null}
          {permission.scope ? <p className="mt-1 text-3xs text-muted-foreground">Always allow: {permission.scope}</p> : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="xs" disabled={disabled} onClick={() => onResolve({ permissionId: permission.id, decision: "allow_once" })}>Allow</Button>
        {allowsAlways ? <Button size="xs" variant="outline" disabled={disabled} onClick={() => onResolve({ permissionId: permission.id, decision: "allow_always" })}>Always allow</Button> : null}
        <Button size="xs" variant="ghost" disabled={disabled} onClick={() => onResolve({ permissionId: permission.id, decision: "reject" })}>Reject</Button>
      </div>
    </section>
  )
}
