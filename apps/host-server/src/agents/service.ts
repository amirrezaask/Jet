import type { DatabaseSync } from "node:sqlite"
import {
  getCliAgentDriver,
  makeProcessExitedEvent,
  makeProcessStartedEvent,
  projectAgentNotification,
  publicAgentSnapshot,
  reduceAgentEvent,
  type AgentEvent,
  type AgentNotification,
  type AgentProvider,
  type AgentSessionSnapshot,
  type NotificationProjectionContext,
} from "@gharargah/agents"
import type {
  AppNotification,
  IngestNotificationRequest,
  NotificationType,
} from "@gharargah/shared"
import { ensureAgentTelemetrySchema } from "./schema.js"
import type { NotificationService, IngestResult } from "../notifications/service.js"

export type AgentSnapshotStreamEvent =
  | {
      type: "agents.snapshot"
      sessionId: string
      snapshot: Omit<AgentSessionSnapshot, "_internal">
      nativeSessionId?: string
    }
  | {
      type: "agents.event"
      sessionId: string
      event: AgentEvent
    }

export type AgentIngestContext = {
  provider: AgentProvider
  sessionId: string
  processId?: string
  projectId?: string
  cwd?: string
  focusedSessionId?: string | null
  appFocused?: boolean
  projectName?: string
  sessionTitle?: string
}

export type AgentIngestResult = {
  events: AgentEvent[]
  snapshot: Omit<AgentSessionSnapshot, "_internal"> | null
  notifications: AgentNotification[]
  notificationResults: IngestResult[]
}

type EmitFn = (event: AgentSnapshotStreamEvent) => void

function nowIso(): string {
  return new Date().toISOString()
}

function asAgentProvider(value: string | null | undefined): AgentProvider | null {
  if (
    value === "claude" ||
    value === "codex" ||
    value === "cursor" ||
    value === "opencode" ||
    value === "grok"
  ) {
    return value
  }
  return null
}

function mapNotifKindToType(
  kind: AgentNotification["kind"],
): NotificationType {
  switch (kind) {
    case "permission_required":
      return "permission-required"
    case "turn_completed":
      return "turn-completed"
    case "turn_failed":
    case "session_failed":
      return "failed"
    case "session_terminated":
      return "process-exited"
  }
}

function agentNotifToIngest(
  n: AgentNotification,
  ctx: AgentIngestContext & { nativeSessionId?: string },
): IngestNotificationRequest {
  return {
    source: "provider-hook",
    provider: n.provider,
    type: mapNotifKindToType(n.kind),
    severity:
      n.severity === "error"
        ? "error"
        : n.severity === "warning"
          ? "warning"
          : "info",
    title: n.title,
    message: n.message,
    sessionId: n.sessionId,
    projectId: n.projectId ?? ctx.projectId ?? null,
    projectName: ctx.projectName ?? null,
    sessionTitle: ctx.sessionTitle ?? null,
    eventId: n.sourceEventId,
    providerTurnId: n.providerTurnId ?? null,
    providerSessionId: ctx.nativeSessionId ?? null,
    providerEvent: n.kind,
    requiresAction: n.kind === "permission_required",
    metadata: {
      agentNotificationKind: n.kind,
      sourceEventId: n.sourceEventId,
      persistent: n.persistent,
    },
  }
}

export class AgentTelemetryService {
  private readonly snapshots = new Map<string, AgentSessionSnapshot>()

  constructor(
    private readonly db: DatabaseSync,
    private readonly notifications: NotificationService,
    private readonly emit: EmitFn,
  ) {
    ensureAgentTelemetrySchema(db)
    this.hydrateFromDb()
  }

  private hydrateFromDb(): void {
    try {
      const rows = this.db
        .prepare(
          `SELECT session_id, snapshot_json FROM agent_session_snapshots`,
        )
        .all() as Array<{ session_id: string; snapshot_json: string }>
      for (const row of rows) {
        try {
          const snap = JSON.parse(row.snapshot_json) as AgentSessionSnapshot
          this.snapshots.set(row.session_id, snap)
        } catch {
          /* skip */
        }
      }
    } catch {
      /* table may be empty */
    }
  }

  getSnapshot(
    sessionId: string,
  ): Omit<AgentSessionSnapshot, "_internal"> | null {
    const snap = this.snapshots.get(sessionId)
    return snap ? publicAgentSnapshot(snap) : null
  }

  listEvents(
    sessionId: string,
    opts?: { limit?: number; before?: string },
  ): AgentEvent[] {
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500)
    const rows = opts?.before
      ? (this.db
          .prepare(
            `SELECT payload_json FROM agent_events
             WHERE session_id = ? AND occurred_at < ?
             ORDER BY occurred_at DESC LIMIT ?`,
          )
          .all(sessionId, opts.before, limit) as Array<{
          payload_json: string
        }>)
      : (this.db
          .prepare(
            `SELECT payload_json FROM agent_events
             WHERE session_id = ?
             ORDER BY occurred_at DESC LIMIT ?`,
          )
          .all(sessionId, limit) as Array<{ payload_json: string }>)
    const events: AgentEvent[] = []
    for (const row of rows) {
      try {
        events.push(JSON.parse(row.payload_json) as AgentEvent)
      } catch {
        /* skip */
      }
    }
    return events.reverse()
  }

  /** Apply one already-normalized AgentEvent. */
  applyEvent(
    event: AgentEvent,
    projection?: NotificationProjectionContext,
  ): AgentIngestResult {
    const prev = this.snapshots.get(event.sessionId)
    const driver = getCliAgentDriver(event.provider)
    const next = reduceAgentEvent(prev, event, {
      capabilities: driver.getCapabilities(),
    })
    this.snapshots.set(event.sessionId, next)
    this.persistEvent(event)
    this.persistSnapshot(next)

    const pub = publicAgentSnapshot(next)
    this.emit({
      type: "agents.event",
      sessionId: event.sessionId,
      event,
    })
    this.emit({
      type: "agents.snapshot",
      sessionId: event.sessionId,
      snapshot: pub,
      nativeSessionId: next.nativeSessionId || undefined,
    })

    const ctx: NotificationProjectionContext = projection ?? {}
    const projected = projectAgentNotification(event, ctx)
    const notifications: AgentNotification[] = projected ? [projected] : []
    const notificationResults: IngestResult[] = []

    // First user prompt → durable session title for sidebar / roster.
    if (event.kind === "prompt.submitted") {
      const promptRaw = event.metadata?.prompt
      if (typeof promptRaw === "string") {
        const title = promptRaw.replace(/\s+/g, " ").trim().slice(0, 72)
        const binding = this.notifications.bindingForSession(event.sessionId)
        const current = (binding?.sessionTitle ?? ctx.sessionTitle ?? "").trim()
        const generic =
          !current ||
          /^(cursor|claude|codex|opencode|grok|agent|terminal|cursor agent)$/i.test(
            current,
          )
        if (title && generic) {
          this.notifications.bindSession({
            sessionId: event.sessionId,
            projectId: binding?.projectId ?? event.projectId ?? null,
            projectName: binding?.projectName ?? ctx.projectName ?? null,
            sessionTitle: title,
            provider: event.provider,
            ptyId: binding?.ptyId ?? null,
          })
          // App listens for notification.created.sessionTitle to refresh sidebar.
          notificationResults.push(
            this.notifications.ingest({
              source: "provider-hook",
              provider: event.provider,
              type: "provider-notification",
              title,
              message: null,
              sessionId: event.sessionId,
              projectId: binding?.projectId ?? event.projectId ?? null,
              projectName: binding?.projectName ?? ctx.projectName ?? null,
              sessionTitle: title,
              eventId: `session-title:${event.id}`,
              providerSessionId: event.nativeSessionId || null,
              providerEvent: "session-title",
              requiresAction: false,
              metadata: { sessionTitleFrom: "prompt" },
            }),
          )
        }
      }
    }

    // Resume path: surface native session id immediately on session start/resume
    // even when no attention notification is projected.
    if (
      (event.kind === "session.started" || event.kind === "session.resumed") &&
      event.nativeSessionId
    ) {
      notificationResults.push(
        this.notifications.ingest({
          source: "provider-hook",
          provider: event.provider,
          type: "session-started",
          title: `${event.provider} session started`,
          message: null,
          sessionId: event.sessionId,
          projectId: event.projectId ?? null,
          eventId: event.id,
          providerSessionId: event.nativeSessionId,
          providerEvent: event.kind,
          requiresAction: false,
          metadata: { agentEventKind: event.kind },
        }),
      )
    }

    // Resolve permission notifications when permission.resolved arrives.
    if (event.kind === "permission.resolved" && event.permission?.id) {
      this.notifications.ingest({
        source: "provider-hook",
        provider: event.provider,
        type: "permission-required",
        title: "Permission resolved",
        message: null,
        sessionId: event.sessionId,
        eventId: `resolve:${event.id}`,
        requiresAction: false,
        resolveOf: {
          type: "permission-required",
          eventId: null,
          providerSessionId: event.nativeSessionId || null,
          providerTurnId: null,
        },
        metadata: { resolvedPermissionId: event.permission.id },
      })
    }

    for (const n of notifications) {
      const result = this.notifications.ingest(
        agentNotifToIngest(n, {
          provider: event.provider,
          sessionId: event.sessionId,
          projectId: event.projectId,
          nativeSessionId: event.nativeSessionId || undefined,
        }),
      )
      notificationResults.push(result)
    }

    return {
      events: [event],
      snapshot: pub,
      notifications,
      notificationResults,
    }
  }

  /** Normalize a native provider hook body and apply resulting events. */
  ingestNative(
    payload: unknown,
    context: AgentIngestContext,
  ): AgentIngestResult {
    const driver = getCliAgentDriver(context.provider)
    const binding = this.notifications.bindingForSession(context.sessionId)
    const processId =
      context.processId ??
      binding?.ptyId ??
      `session:${context.sessionId}`
    const receivedAt = nowIso()
    const normalized = driver.normalizeHookEvent({
      payload,
      sessionId: context.sessionId,
      processId,
      provider: context.provider,
      receivedAt,
      projectId: context.projectId ?? binding?.projectId ?? undefined,
      cwd: context.cwd,
    })

    const allEvents: AgentEvent[] = []
    const allNotifs: AgentNotification[] = []
    const allNotifResults: IngestResult[] = []
    let lastSnap: Omit<AgentSessionSnapshot, "_internal"> | null = null

    const projection: NotificationProjectionContext = {
      focusedSessionId: context.focusedSessionId,
      appFocused: context.appFocused,
      projectName: context.projectName ?? binding?.projectName ?? undefined,
      sessionTitle: context.sessionTitle ?? binding?.sessionTitle ?? undefined,
    }

    for (const event of normalized) {
      const result = this.applyEvent(event, projection)
      allEvents.push(...result.events)
      allNotifs.push(...result.notifications)
      allNotifResults.push(...result.notificationResults)
      lastSnap = result.snapshot
    }

    return {
      events: allEvents,
      snapshot: lastSnap,
      notifications: allNotifs,
      notificationResults: allNotifResults,
    }
  }

  onProcessStarted(input: {
    provider: AgentProvider
    sessionId: string
    processId: string
    nativeSessionId?: string
    nativeProcessId?: number
    projectId?: string
    cwd?: string
  }): AgentIngestResult {
    return this.applyEvent(makeProcessStartedEvent(input))
  }

  onProcessExited(input: {
    provider: AgentProvider
    sessionId: string
    processId: string
    nativeSessionId?: string
    exitCode?: number
    expectedExit?: boolean
    projectId?: string
    cwd?: string
  }): AgentIngestResult {
    return this.applyEvent(makeProcessExitedEvent(input))
  }

  private persistEvent(event: AgentEvent): void {
    try {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO agent_events(
            id, session_id, provider, kind, occurred_at, received_at,
            native_session_id, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.id,
          event.sessionId,
          event.provider,
          event.kind,
          event.occurredAt,
          event.receivedAt,
          event.nativeSessionId || null,
          JSON.stringify(event),
        )
    } catch {
      /* ignore persistence errors — in-memory still updated */
    }
  }

  private persistSnapshot(snap: AgentSessionSnapshot): void {
    try {
      const pub = publicAgentSnapshot(snap)
      this.db
        .prepare(
          `INSERT INTO agent_session_snapshots(
            session_id, provider, native_session_id, snapshot_json, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            provider=excluded.provider,
            native_session_id=excluded.native_session_id,
            snapshot_json=excluded.snapshot_json,
            updated_at=excluded.updated_at`,
        )
        .run(
          snap.id,
          snap.provider,
          snap.nativeSessionId || null,
          JSON.stringify(pub),
          nowIso(),
        )
    } catch {
      /* ignore */
    }
  }
}

export function parseAgentProviderParam(
  value: string | null,
): AgentProvider | null {
  return asAgentProvider(value)
}
