import type {
  NotificationPreferences,
  NotificationType,
} from "@gharargah/shared"
import {
  DEFAULT_NOTIFICATION_PREFERENCES as DEFAULTS,
} from "@gharargah/shared"

export function mergeNotificationPreferences(
  partial?: Partial<NotificationPreferences> | null,
): NotificationPreferences {
  return {
    ...DEFAULTS,
    ...(partial ?? {}),
  }
}

export type PreferenceCategory =
  | "completed"
  | "input-required"
  | "permission-required"
  | "failure"
  | "background-output"
  | "other"

export function categoryForType(type: NotificationType): PreferenceCategory {
  switch (type) {
    case "turn-completed":
      return "completed"
    case "input-required":
      return "input-required"
    case "permission-required":
      return "permission-required"
    case "failed":
    case "process-exited":
      return "failure"
    case "background-output":
      return "background-output"
    default:
      return "other"
  }
}

/** Preferences gate presentation only — never session attention tracking. */
export function shouldCreateInAppNotification(
  prefs: NotificationPreferences,
  type: NotificationType,
): boolean {
  const category = categoryForType(type)
  switch (category) {
    case "completed":
      return prefs.notifyOnCompleted
    case "input-required":
      return prefs.notifyOnInputRequired
    case "permission-required":
      return prefs.notifyOnPermissionRequired
    case "failure":
      return prefs.notifyOnFailure
    case "background-output":
      return prefs.includeBackgroundOutput
    case "other":
      return true
  }
}

export type DesktopSuppressionContext = {
  prefs: NotificationPreferences
  type: NotificationType
  viewingSessionId: string | null | undefined
  notificationSessionId: string | null | undefined
  permission: NotificationPermission | "unsupported"
  wasDeduped: boolean
  recentlyDelivered: boolean
}

export type NotificationPermission = "granted" | "denied" | "default"

export function evaluateDesktopDelivery(
  ctx: DesktopSuppressionContext,
): { deliver: boolean; reason?: string } {
  if (!ctx.prefs.desktopEnabled) {
    return { deliver: false, reason: "desktop-disabled" }
  }
  if (!shouldCreateInAppNotification(ctx.prefs, ctx.type)) {
    return { deliver: false, reason: "category-disabled" }
  }
  if (ctx.wasDeduped) {
    return { deliver: false, reason: "deduplicated" }
  }
  if (ctx.recentlyDelivered) {
    return { deliver: false, reason: "recently-delivered" }
  }
  if (
    ctx.viewingSessionId &&
    ctx.notificationSessionId &&
    ctx.viewingSessionId === ctx.notificationSessionId
  ) {
    return { deliver: false, reason: "viewing-session" }
  }
  if (ctx.permission === "denied") {
    return { deliver: false, reason: "permission-denied" }
  }
  if (ctx.type === "background-output") {
    return { deliver: false, reason: "low-priority" }
  }
  if (ctx.permission !== "granted" && ctx.permission !== "unsupported") {
    return { deliver: false, reason: "permission-default" }
  }
  return { deliver: true }
}

export { DEFAULTS as DEFAULT_NOTIFICATION_PREFERENCES }
