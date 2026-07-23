import type { AgentPermissionOption, AgentPermissionRequest, ResolveAgentPermissionInput } from "@gharargah/agents"
import { ShieldAlert } from "lucide-react"
import { Button } from "../../components/ui/button.js"

function normalizeOptions(
  permission: AgentPermissionRequest,
): AgentPermissionOption[] {
  const raw = permission.options ?? []
  return raw.map(option => {
    if (typeof option === "string") {
      return {
        id: option,
        kind:
          option === "allow_once" ||
          option === "allow_always" ||
          option === "reject_once" ||
          option === "reject_always"
            ? option
            : option === "reject"
              ? "reject_once"
              : "unknown",
        label:
          option === "allow_once"
            ? "Allow"
            : option === "allow_always"
              ? "Always allow"
              : option === "reject_always"
                ? "Reject always"
                : "Reject",
      }
    }
    return option
  })
}

export function PermissionCard(props: {
  permission: AgentPermissionRequest
  disabled?: boolean
  onResolve: (
    input: Pick<ResolveAgentPermissionInput, "permissionId" | "decision" | "optionId">,
  ) => void
}) {
  const { permission, disabled = false, onResolve } = props
  const options = normalizeOptions(permission)
  const allowsAlways = options.some(option => option.kind === "allow_always")
  const rejectOption =
    options.find(option => option.kind === "reject_once") ??
    options.find(option => option.kind === "reject_always") ??
    options.find(option => option.kind === "unknown")
  const allowOnce = options.find(option => option.kind === "allow_once")
  const allowAlways = options.find(option => option.kind === "allow_always")

  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{permission.title}</h3>
          {permission.description ? (
            <p className="mt-1 text-xs text-muted-foreground">{permission.description}</p>
          ) : null}
          {permission.scope ? (
            <p className="mt-1 text-3xs text-muted-foreground">Always allow: {permission.scope}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {allowOnce ? (
          <Button
            size="xs"
            disabled={disabled}
            onClick={() =>
              onResolve({
                permissionId: permission.id,
                optionId: allowOnce.id,
                decision: "allow_once",
              })
            }
          >
            {allowOnce.label || "Allow"}
          </Button>
        ) : null}
        {allowsAlways && allowAlways ? (
          <Button
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              onResolve({
                permissionId: permission.id,
                optionId: allowAlways.id,
                decision: "allow_always",
              })
            }
          >
            {allowAlways.label || "Always allow"}
          </Button>
        ) : null}
        {rejectOption ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={disabled}
            onClick={() =>
              onResolve({
                permissionId: permission.id,
                optionId: rejectOption.id,
                decision: rejectOption.kind === "reject_always" ? "reject_always" : "reject_once",
              })
            }
          >
            {rejectOption.label || "Reject"}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
