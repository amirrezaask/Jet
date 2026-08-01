import { useSyncExternalStore } from "react"
import type { AgentEvent } from "@gharargah/agents"
import {
  describeAgentActivity,
  filterAgentActivityUiEvents,
  formatDurationMs,
} from "@gharargah/agents"
import { cn } from "@/lib/utils.js"

export type AgentActivityTimelineProps = {
  events: AgentEvent[]
  className?: string
}

function labelForEvent(event: AgentEvent): string {
  switch (event.kind) {
    case "session.started":
    case "session.resumed":
      return "Session started"
    case "session.ended":
      return "Session ended"
    case "session.failed":
      return "Session failed"
    case "prompt.submitted":
      return "Prompt submitted"
    case "turn.started":
      return "Turn started"
    case "turn.completed":
      return "Turn completed"
    case "turn.failed":
      return "Turn failed"
    case "tool.started":
      return event.tool
        ? `Running ${event.tool.name}`
        : "Tool started"
    case "tool.completed":
      return event.tool ? `Finished ${event.tool.name}` : "Tool completed"
    case "tool.failed":
      return event.tool ? `Command failed (${event.tool.name})` : "Tool failed"
    case "permission.requested":
      return "Permission requested"
    case "permission.resolved":
      return "Permission resolved"
    case "file.touched":
      return event.file?.path
        ? `Touched ${event.file.path}`
        : "File touched"
    case "compaction.started":
      return "Compaction started"
    case "compaction.completed":
      return "Compaction completed"
    case "subagent.started":
      return "Subagent started"
    case "subagent.completed":
      return "Subagent completed"
    case "subagent.failed":
      return "Subagent failed"
    case "process.started":
      return "Process started"
    case "process.exited":
      return "Process exited"
    default:
      return event.kind
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
  } catch {
    return iso
  }
}

export function AgentActivityTimeline({
  events,
  className,
}: AgentActivityTimelineProps) {
  const visible = filterAgentActivityUiEvents(events)
  if (visible.length === 0) {
    return (
      <div
        className={cn("p-4 text-3xs text-muted-foreground", className)}
        data-gharargah-agent-activity-empty
      >
        No activity yet.
      </div>
    )
  }
  return (
    <ol
      className={cn(
        "flex flex-col gap-1 overflow-auto p-3 font-mono text-3xs",
        className,
      )}
      data-gharargah-agent-activity-timeline
    >
      {visible.map(event => (
        <li
          key={event.id}
          className="flex gap-2 border-b border-border/40 py-1 last:border-0"
          data-gharargah-agent-activity-row
          data-kind={event.kind}
        >
          <time
            className="shrink-0 tabular-nums text-muted-foreground"
            dateTime={event.occurredAt}
          >
            {formatTime(event.occurredAt)}
          </time>
          <span className="min-w-0 flex-1 text-foreground">
            {labelForEvent(event)}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** Shared clock tick for live duration labels (one timer for the dashboard). */
let clockMs = Date.now()
const clockListeners = new Set<() => void>()
let clockTimer: ReturnType<typeof setInterval> | null = null

function ensureClock(): void {
  if (clockTimer) return
  clockTimer = setInterval(() => {
    clockMs = Date.now()
    for (const l of clockListeners) l()
  }, 1_000)
}

export function useSharedClockMs(): number {
  return useSyncExternalStore(
    (onStoreChange) => {
      clockListeners.add(onStoreChange)
      ensureClock()
      return () => {
        clockListeners.delete(onStoreChange)
        if (clockListeners.size === 0 && clockTimer) {
          clearInterval(clockTimer)
          clockTimer = null
        }
      }
    },
    () => clockMs,
    () => clockMs,
  )
}

export { describeAgentActivity, formatDurationMs }
