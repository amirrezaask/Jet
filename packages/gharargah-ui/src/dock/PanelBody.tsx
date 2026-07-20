import { memo } from "react"
import type { PanelId, PanelView } from "@gharargah/shared"
import type { TabStore, TabTypeRegistry } from "../tabs/registry.js"
import { TabHost } from "../tabs/TabHost.js"
import { PanelEmptyState } from "./PanelEmptyState.js"

function PanelBodyInner({
  panelId,
  view,
  store,
  registry,
  focused,
}: {
  panelId: PanelId
  view: PanelView
  store: TabStore
  registry: TabTypeRegistry
  focused: boolean
}) {
  if (view.kind === "empty") {
    return <PanelEmptyState />
  }
  const tabIds = view.tabIds.length ? view.tabIds : [view.activeTabId]
  return (
    <TabHost
      tabIds={tabIds}
      activeTabId={view.activeTabId}
      panelId={panelId}
      focused={focused}
      store={store}
      registry={registry}
    />
  )
}

export const PanelBody = memo(PanelBodyInner)
