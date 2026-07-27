import type {
  AgentPermissionOption,
  AgentPermissionRequest,
  ProviderApprovalDecision,
  ProviderRequestKind,
  ResolveAgentPermissionInput,
} from "@gharargah/agents"
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
            ? "Allow once"
            : option === "allow_always"
              ? "Always allow this session"
              : option === "reject_always"
                ? "Decline"
                : "Decline",
      }
    }
    return option
  })
}

function kindTitle(kind: ProviderRequestKind | null | undefined, fallback: string): string {
  switch (kind) {
    case "command":
      return "Command approval"
    case "file-read":
      return "File-read approval"
    case "file-change":
      return "File-change approval"
    default:
      return fallback || "Approval required"
  }
}

function resolvePayload(
  permissionId: string,
  decision: ResolveAgentPermissionInput["decision"],
  approvalDecision: ProviderApprovalDecision,
  optionId?: string,
): Pick<
  ResolveAgentPermissionInput,
  "permissionId" | "decision" | "optionId" | "approvalDecision"
> {
  return {
    permissionId,
    decision,
    approvalDecision,
    ...(optionId ? { optionId } : {}),
  }
}

export function PermissionCard(props: {
  permission: AgentPermissionRequest
  disabled?: boolean
  onCancelTurn?: () => void
  onResolve: (
    input: Pick<
      ResolveAgentPermissionInput,
      "permissionId" | "decision" | "optionId" | "approvalDecision"
    >,
  ) => void
}) {
  const { permission, disabled = false, onCancelTurn, onResolve } = props
  const options = normalizeOptions(permission)
  const allowsAlways = options.some(option => option.kind === "allow_always")
  const rejectOption =
    options.find(option => option.kind === "reject_once") ??
    options.find(option => option.kind === "reject_always") ??
    options.find(option => option.kind === "unknown")
  const allowOnce = options.find(option => option.kind === "allow_once")
  const allowAlways = options.find(option => option.kind === "allow_always")
  const title = kindTitle(permission.requestKind, permission.title)

  function cancelTurn() {
    if (onCancelTurn) {
      onCancelTurn()
      return
    }
    onResolve(resolvePayload(permission.id, "reject_once", "cancel"))
  }

  return (
    <section
      className="rounded-xl border border-border/40 bg-muted/15 p-3"
      data-slot="permission-card"
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{title}</h3>
          {permission.description ? (
            <p className="mt-1 text-xs text-muted-foreground">{permission.description}</p>
          ) : null}
          {permission.detail ? (
            <p className="mt-1 font-mono text-xs text-foreground/90">{permission.detail}</p>
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
              onResolve(
                resolvePayload(permission.id, "allow_once", "accept", allowOnce.id),
              )
            }
          >
            Allow once
          </Button>
        ) : null}
        {allowsAlways && allowAlways ? (
          <Button
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              onResolve(
                resolvePayload(
                  permission.id,
                  "allow_always",
                  "acceptForSession",
                  allowAlways.id,
                ),
              )
            }
          >
            Always allow this session
          </Button>
        ) : null}
        {rejectOption ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={disabled}
            onClick={() =>
              onResolve(
                resolvePayload(
                  permission.id,
                  rejectOption.kind === "reject_always" ? "reject_always" : "reject_once",
                  "decline",
                  rejectOption.id,
                ),
              )
            }
          >
            Decline
          </Button>
        ) : null}
        <Button size="xs" variant="ghost" disabled={disabled} onClick={cancelTurn}>
          Cancel turn
        </Button>
      </div>
    </section>
  )
}
