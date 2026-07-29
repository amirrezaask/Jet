import type { AgentProvider } from "@gharargah/shared"

export type ProviderNotificationLaunch = {
  command: string
  args: string[]
  driver: "hook" | "osc"
}

export type ProviderNotificationLaunchContext = {
  sessionId: string
  origin: string
}

function ingestUrl(
  provider: AgentProvider,
  context: ProviderNotificationLaunchContext,
): string {
  const url = new URL("/api/v1/notifications/ingest", context.origin)
  url.searchParams.set("provider", provider)
  url.searchParams.set("sessionId", context.sessionId)
  return url.toString()
}

function claudeSettings(url: string): string {
  const handler = { type: "http", url, timeout: 5 }
  const entry = { hooks: [handler] }
  return JSON.stringify({
    hooks: {
      Notification: [{ matcher: "", ...entry }],
      Stop: [entry],
      StopFailure: [entry],
    },
  })
}

function codexNotifyOverride(url: string): string {
  // Codex appends its JSON payload as the final argv item. The fixed argv[0]
  // makes that payload `$1`, while curl receives it without shell re-parsing.
  const script =
    'curl --silent --show-error --max-time 5 --request POST --header "content-type: application/json" --data-binary "$1" "$0" >/dev/null'
  return `notify=${JSON.stringify(["sh", "-c", script, url])}`
}

/**
 * Session-scoped provider notification wiring. It never edits a user's global
 * provider config; providers without a stable per-launch hook use OSC.
 */
export function notificationLaunchForProvider(
  provider: AgentProvider,
  command: string,
  context: ProviderNotificationLaunchContext,
): ProviderNotificationLaunch {
  const url = ingestUrl(provider, context)
  if (provider === "claude") {
    return {
      command,
      args: ["--settings", claudeSettings(url)],
      driver: "hook",
    }
  }
  if (provider === "codex") {
    return {
      command,
      args: ["-c", codexNotifyOverride(url)],
      driver: "hook",
    }
  }
  return { command, args: [], driver: "osc" }
}
