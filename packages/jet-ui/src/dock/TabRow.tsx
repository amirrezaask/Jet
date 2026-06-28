import { X } from "lucide-react"
import type { PanelId, TabGroup, TabId } from "@jet/shared"
import type { TabRegistry } from "@jet/workspace"
import { cn } from "../lib/utils.js"

export function TabRow({
  panelId,
  group,
  registry,
  focused,
  onSelect,
  onClose,
  onDragStart,
  onDragEnd,
}: {
  panelId: PanelId
  group: TabGroup
  registry: TabRegistry
  focused: boolean
  onSelect: (tabId: TabId) => void
  onClose: (tabId: TabId) => void
  onDragStart: (tabId: TabId, panelId: PanelId) => void
  onDragEnd: () => void
}) {
  return (
    <div
      className={cn(
        "flex h-7 shrink-0 items-end gap-px border-b border-[var(--jet-border)] bg-[var(--jet-panel)] px-1",
        focused && "bg-[var(--jet-panel-raised)]",
      )}
    >
      {group.tabs.map((tabId, i) => {
        const meta = registry.meta(tabId)
        const active = i === group.active
        return (
          <div
            key={tabId.id}
            draggable
            onDragStart={() => onDragStart(tabId, panelId)}
            onDragEnd={onDragEnd}
            className={cn(
              "group flex max-w-[160px] cursor-pointer items-center gap-1 rounded-t px-2 py-1 text-xs",
              active
                ? "bg-[var(--jet-bg)] text-[var(--jet-text)]"
                : "text-[var(--jet-text-muted)] hover:bg-[var(--jet-hover)]",
            )}
            onClick={() => onSelect(tabId)}
          >
            <span className="truncate">
              {meta.dirty ? "● " : ""}
              {meta.label}
            </span>
            {meta.closeable && (
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100"
                onClick={e => {
                  e.stopPropagation()
                  onClose(tabId)
                }}
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
