import { Settings } from "lucide-react"
import { Button } from "@/components/ui/button.js"
import { SidebarFooter, SidebarSeparator } from "@/components/ui/sidebar.js"
import { cn } from "@/lib/utils.js"

export type SidebarFooterStatusProps = {
  connected?: boolean
  serverLabel?: string
  onOpenSettings?: () => void
}

export function SidebarFooterStatus({
  connected = true,
  serverLabel = "Local host",
  onOpenSettings,
}: SidebarFooterStatusProps) {
  return (
    <SidebarFooter className="gap-1 border-t border-sidebar-border p-2">
      <div
        className="flex items-center gap-2 px-1 text-3xs text-sidebar-foreground/70"
        data-yaade-sidebar-connection=""
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            connected ? "bg-[var(--yaade-success,#22c55e)]" : "bg-destructive",
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">
          {connected ? "Connected" : "Reconnecting…"}
          {serverLabel ? (
            <span className="block truncate opacity-80">{serverLabel}</span>
          ) : null}
        </span>
        {onOpenSettings ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="size-6"
            aria-label="Settings"
            data-yaade-sidebar-settings=""
            onClick={onOpenSettings}
          >
            <Settings className="size-3.5" />
          </Button>
        ) : null}
      </div>
      <SidebarSeparator className="mx-0" />
    </SidebarFooter>
  )
}
