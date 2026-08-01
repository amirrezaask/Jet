import { Data, Schema } from "effect"

/** Canonical ADE session PTY lifecycle status (persisted in roster). */
export const TerminalSessionStatus = Schema.Literal("starting", "running", "exited", "failed")
export type TerminalSessionStatus = Schema.Schema.Type<typeof TerminalSessionStatus>

/**
 * Lifecycle events that may change `TerminalSessionStatus`.
 * Modal open/close is NOT an event — UI detach ≠ PTY stop.
 */
export type SessionLifecycleEvent =
  | {
      readonly _tag: "PtyBound"
      readonly pendingExit?: { readonly exitCode: number; readonly signal?: number }
    }
  | { readonly _tag: "PtyUnbound" }
  | {
      readonly _tag: "ProcessExited"
      readonly exitCode: number
      readonly signal?: number
    }
  | { readonly _tag: "Failed" }
  | { readonly _tag: "AwaitResume" }
  | { readonly _tag: "Restart" }
  | { readonly _tag: "ResumeArchived" }
  | { readonly _tag: "Archive" }
  | { readonly _tag: "Hydrate"; readonly status: TerminalSessionStatus }

export class InvalidSessionTransitionError extends Data.TaggedError("InvalidSessionTransition")<{
  readonly tabId: string
  readonly from: TerminalSessionStatus
  readonly event: SessionLifecycleEvent["_tag"]
  readonly message: string
}> {}

/**
 * Pure status reducer. Matches historical imperative mutators in
 * `terminal-session.ts` — permissive across all four statuses.
 */
export function nextSessionStatus(
  current: TerminalSessionStatus,
  event: SessionLifecycleEvent,
): TerminalSessionStatus {
  switch (event._tag) {
    case "PtyBound":
      return event.pendingExit ? "exited" : "running"
    case "PtyUnbound":
      return current
    case "ProcessExited":
      return "exited"
    case "Failed":
      return "failed"
    case "AwaitResume":
    case "Restart":
    case "ResumeArchived":
      return "starting"
    case "Archive":
      return current === "starting" || current === "running" ? "exited" : current
    case "Hydrate":
      return event.status
  }
}

/** Documented allowed (from → event) pairs; all current product paths are included. */
const ALLOWED: ReadonlyMap<
  SessionLifecycleEvent["_tag"],
  ReadonlySet<TerminalSessionStatus>
> = new Map([
  ["PtyBound", new Set(["starting", "running", "exited", "failed"])],
  ["PtyUnbound", new Set(["starting", "running", "exited", "failed"])],
  ["ProcessExited", new Set(["starting", "running", "exited", "failed"])],
  ["Failed", new Set(["starting", "running", "exited", "failed"])],
  ["AwaitResume", new Set(["starting", "running", "exited", "failed"])],
  ["Restart", new Set(["starting", "running", "exited", "failed"])],
  ["ResumeArchived", new Set(["exited", "failed"])],
  ["Archive", new Set(["starting", "running", "exited", "failed"])],
  ["Hydrate", new Set(["starting", "running", "exited", "failed"])],
])

export function isLegalSessionTransition(
  current: TerminalSessionStatus,
  event: SessionLifecycleEvent,
): boolean {
  return ALLOWED.get(event._tag)?.has(current) ?? false
}

export function assertLegalSessionTransition(
  tabId: string,
  current: TerminalSessionStatus,
  event: SessionLifecycleEvent,
): void {
  if (isLegalSessionTransition(current, event)) return
  throw new InvalidSessionTransitionError({
    tabId,
    from: current,
    event: event._tag,
    message: `illegal session transition: ${current} + ${event._tag}`,
  })
}
