import { memo } from "react"
import type { PanelId, PanelView } from "@jet/shared"
import type { TabStore, TabTypeRegistry } from "../tabs/registry.js"
import { TabHost } from "../tabs/TabHost.js"
import { PanelEmptyState } from "./PanelEmptyState.js"

function PanelBodyInner({
  panelId,
  view,
  store,
  registry,
  focused,
  renderRevision,
}: {
  panelId: PanelId
  view: PanelView
  store: TabStore
  registry: TabTypeRegistry
  focused: boolean
  renderRevision?: string | number
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
      renderRevision={renderRevision}
    />
  )
}

export const PanelBody = memo(PanelBodyInner)
