/** Presentation status for Mission Control session tiles. */
export type SessionCardStatus =
  | "running"
  | "testing"
  | "planning"
  | "queued"
  | "approval"
  | "idle"
  | "failed"

export type SessionProvider = "jet" | "claude" | "cursor" | "codex"

export type SessionCardModel = {
  id: string
  projectId: string
  kind: "agent" | "terminal"
  provider?: SessionProvider
  /** Display name for provider/agent row (e.g. "Claude", "Terminal"). */
  providerLabel: string
  title: string
  description?: string
  status: SessionCardStatus
  requiresApproval?: boolean
}

/** Runtime PTY statuses used by terminal sessions. */
export type TerminalRuntimeStatus = "starting" | "running" | "exited" | "failed"

export function mapRuntimeStatusToCardStatus(
  status: TerminalRuntimeStatus,
): SessionCardStatus {
  switch (status) {
    case "starting":
    case "running":
      return "running"
    case "failed":
      return "failed"
    case "exited":
      return "idle"
  }
}

export function detectSessionProvider(
  launchCommand?: string,
): SessionProvider | undefined {
  if (!launchCommand) return undefined
  const cmd = launchCommand.trim().split(/\s+/)[0]?.toLowerCase() ?? ""
  if (cmd === "claude" || cmd.endsWith("/claude")) return "claude"
  if (cmd === "codex" || cmd.endsWith("/codex")) return "codex"
  if (cmd === "cursor-agent" || cmd.endsWith("/cursor-agent") || cmd === "cursor") {
    return "cursor"
  }
  return undefined
}

export function providerDisplayLabel(
  kind: "agent" | "terminal",
  provider?: SessionProvider,
): string {
  if (kind === "terminal" && !provider) return "Terminal"
  switch (provider) {
    case "claude":
      return "Claude"
    case "cursor":
      return "Cursor"
    case "codex":
      return "Codex"
    case "jet":
      return "Jet"
    default:
      return kind === "agent" ? "Agent" : "Terminal"
  }
}

export function defaultSessionDescription(
  kind: "agent" | "terminal",
  status: SessionCardStatus,
): string {
  if (status === "failed") return "Session failed."
  if (status === "approval") return "Changes require review before continuing."
  if (status === "queued") return "Waiting in queue."
  if (status === "planning") return "Planning next steps."
  if (status === "testing") return "Running checks."
  if (kind === "terminal") {
    return status === "running" ? "Shell active." : "Ready for commands."
  }
  return status === "running" ? "Session in progress." : "Agent standing by."
}

export function sessionStatusLabel(status: SessionCardStatus): string {
  switch (status) {
    case "running":
      return "Running"
    case "testing":
      return "Testing"
    case "planning":
      return "Planning"
    case "queued":
      return "Queued"
    case "approval":
      return "Approval"
    case "idle":
      return "Idle"
    case "failed":
      return "Failed"
  }
}

