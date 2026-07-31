import type {
  AgentPermissionRequest,
  ProviderRequestKind,
  ResolveAgentPermissionInput,
} from "@gharargah/agents"
import { useEffect } from "react"
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isResponding) return
      // Approving runs a command or writes a file, so only honour the shortcut
      // when the user is actually focused on this composer — never from the
      // terminal pane, another session, or an unfocused document.
      const target = event.target
      if (!(target instanceof Element) || !target.closest("[data-chat-composer-form]")) {
        return
      }
      // Focus already on one of the buttons below — let it activate itself
      // rather than firing the shortcut on top of the click.
      if (target.closest('[data-slot="composer-pending-approval"]')) return
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        onResolve({
          permissionId: permission.id,
          decision: "allow_once",
          approvalDecision: "accept",
        })
      }
      if (event.key === "Escape") {
        event.preventDefault()
        onResolve({
          permissionId: permission.id,
          decision: "reject_once",
          approvalDecision: "decline",
        })
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isResponding, onResolve, permission.id])

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
            <pre
              aria-label="Approval detail"
              className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs text-foreground/90"
            >
              {permission.detail}
            </pre>
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
          Always allow
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
          Allow once
        </Button>
      </div>
    </section>
  )
}
