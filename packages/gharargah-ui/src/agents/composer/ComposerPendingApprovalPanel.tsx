import type {
  AgentPermissionRequest,
  ProviderRequestKind,
  ResolveAgentPermissionInput,
} from "@gharargah/agents"
import { Button } from "../../components/ui/button.js"

function kindLabel(kind: ProviderRequestKind | null | undefined): string {
  switch (kind) {
    case "command":
      return "Command"
    case "file-read":
      return "File-read"
    case "file-change":
      return "File-change"
    default:
      return "Approval"
  }
}

export function ComposerPendingApprovalPanel(props: {
  permission: AgentPermissionRequest
  pendingCount: number
  isResponding?: boolean
  onResolve: (
    input: Pick<
      ResolveAgentPermissionInput,
      "permissionId" | "decision" | "optionId" | "approvalDecision"
    >,
  ) => void
  onCancelTurn?: () => void
}) {
  const {
    permission,
    pendingCount,
    isResponding = false,
    onResolve,
    onCancelTurn,
  } = props

  function cancelTurn() {
    if (onCancelTurn) {
      onCancelTurn()
      return
    }
    onResolve({
      permissionId: permission.id,
      decision: "reject_once",
      approvalDecision: "cancel",
    })
  }

  return (
    <section
      className="mb-2 rounded-xl border border-border/50 bg-muted/20 p-3"
      data-slot="composer-pending-approval"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">
            {kindLabel(permission.requestKind)} approval
          </p>
          {permission.detail ? (
            <p className="mt-1 font-mono text-xs text-foreground/90">{permission.detail}</p>
          ) : permission.description ? (
            <p className="mt-1 text-xs text-muted-foreground">{permission.description}</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">{permission.title}</p>
          )}
        </div>
        {pendingCount > 1 ? (
          <span className="shrink-0 text-3xs text-muted-foreground">1/{pendingCount}</span>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={isResponding}
          onClick={cancelTurn}
        >
          Cancel turn
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={isResponding}
          onClick={() =>
            onResolve({
              permissionId: permission.id,
              decision: "reject_once",
              approvalDecision: "decline",
            })
          }
        >
          Decline
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={isResponding}
          onClick={() =>
            onResolve({
              permissionId: permission.id,
              decision: "allow_always",
              approvalDecision: "acceptForSession",
            })
          }
        >
          Always allow this session
        </Button>
        <Button
          type="button"
          size="xs"
          disabled={isResponding}
          onClick={() =>
            onResolve({
              permissionId: permission.id,
              decision: "allow_once",
              approvalDecision: "accept",
            })
          }
        >
          Approve once
        </Button>
      </div>
    </section>
  )
}
