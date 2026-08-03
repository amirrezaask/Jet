import type {
  AppNotification,
  NotificationPreferences,
} from "@yaade/shared"

/** Client-side mirror of host desktop suppression policy. */
export function evaluateDesktopDeliveryClient(input: {
  prefs: NotificationPreferences | null
  notification: AppNotification
  viewingSessionId: string | null
  recentDesktop: Map<string, number>
}): { deliver: boolean; reason?: string } {
  const prefs = input.prefs
  if (!prefs?.desktopEnabled) return { deliver: false, reason: "desktop-disabled" }
  const n = input.notification
  if (n.type === "background-output") return { deliver: false, reason: "low-priority" }
  if (
    input.viewingSessionId &&
    n.sessionId &&
    input.viewingSessionId === n.sessionId
  ) {
    return { deliver: false, reason: "viewing-session" }
  }
  const last = input.recentDesktop.get(n.id)
  if (last && Date.now() - last < 60_000) {
    return { deliver: false, reason: "recently-delivered" }
  }
  if (typeof Notification === "undefined") {
    return { deliver: false, reason: "unsupported" }
  }
  if (Notification.permission === "denied") {
    return { deliver: false, reason: "permission-denied" }
  }
  if (Notification.permission !== "granted") {
    return { deliver: false, reason: "permission-default" }
  }
  switch (n.type) {
    case "turn-completed":
      if (!prefs.notifyOnCompleted) return { deliver: false, reason: "category-disabled" }
      break
    case "input-required":
      if (!prefs.notifyOnInputRequired)
        return { deliver: false, reason: "category-disabled" }
      break
    case "permission-required":
      if (!prefs.notifyOnPermissionRequired)
        return { deliver: false, reason: "category-disabled" }
      break
    case "failed":
    case "process-exited":
      if (!prefs.notifyOnFailure) return { deliver: false, reason: "category-disabled" }
      break
  }
  return { deliver: true }
}

export function maybeShowDesktopNotification(
  n: AppNotification,
  options?: { soundEnabled?: boolean; onClick?: () => void },
): void {
  if (typeof Notification === "undefined") return
  if (Notification.permission !== "granted") return
  try {
    const note = new Notification(n.title, {
      body: n.message ?? undefined,
      tag: n.id,
      silent: !options?.soundEnabled,
    })
    note.onclick = () => {
      window.focus()
      options?.onClick?.()
      note.close()
    }
  } catch {
    /* ignore Notification constructor errors */
  }
}
