import type { PanelId } from "@gharargah/shared"
import type { DropSiteKind } from "./panel-drop-zones.js"

export const TAB_DND_PREFIX = "tab"
export const DROP_DND_PREFIX = "drop"
export const TABBAR_DND_PREFIX = "tabbar"

export type TabDragData = {
  type: "tab"
  panelId: PanelId
  tabId: string
  label: string
  dirty?: boolean
}

export function tabDndId(panelId: PanelId, tabId: string): string {
  return `${TAB_DND_PREFIX}:${panelId.id}:${tabId}`
}

export function parseTabDndId(id: string): { panelId: PanelId; tabId: string } | null {
  const parts = id.split(":")
  if (parts.length < 3 || parts[0] !== TAB_DND_PREFIX) return null
  const panelNum = Number(parts[1])
  const tabId = parts.slice(2).join(":")
  if (!Number.isFinite(panelNum) || !tabId) return null
  return { panelId: { id: panelNum }, tabId }
}

export function dropDndId(panelId: PanelId, zone: DropSiteKind): string {
  return `${DROP_DND_PREFIX}:${panelId.id}:${zone}`
}

export function parseDropDndId(id: string): { panelId: PanelId; zone: DropSiteKind } | null {
  const parts = id.split(":")
  if (parts.length !== 3 || parts[0] !== DROP_DND_PREFIX) return null
  const panelNum = Number(parts[1])
  const zone = parts[2] as DropSiteKind
  if (!Number.isFinite(panelNum)) return null
  return { panelId: { id: panelNum }, zone }
}

export function tabBarDndId(panelId: PanelId): string {
  return `${TABBAR_DND_PREFIX}:${panelId.id}`
}

export function parseTabBarDndId(id: string): PanelId | null {
  const parts = id.split(":")
  if (parts.length !== 2 || parts[0] !== TABBAR_DND_PREFIX) return null
  const panelNum = Number(parts[1])
  if (!Number.isFinite(panelNum)) return null
  return { id: panelNum }
}
