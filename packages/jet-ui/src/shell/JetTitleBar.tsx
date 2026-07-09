import type { ReactNode } from "react"

/**
 * Custom window titlebar for macOS `titleBarStyle: 'hiddenInset'`.
 * The native controls sit on the sidebar surface while the document title sits
 * on the editor surface. The full row remains available for future chrome.
 */
export function JetTitleBar({
  center,
  right,
  sidebarOpen,
  sidebarWidth,
}: {
  center?: ReactNode
  right?: ReactNode
  sidebarOpen: boolean
  sidebarWidth: string
}) {
  return (
    <div
      data-jet-titlebar
      className="flex min-h-[var(--jet-titlebar-height)] shrink-0 border-b border-border text-xs select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div
        data-jet-titlebar-sidebar
        data-sidebar-open={sidebarOpen || undefined}
        className="flex shrink-0 items-center border-r border-sidebar-border bg-sidebar"
        style={{
          width: sidebarOpen ? sidebarWidth : "var(--jet-traffic-light-inset)",
        }}
      >
        <div aria-hidden data-jet-traffic-light-spacer />
      </div>
      <div
        data-jet-titlebar-main
        className="flex min-w-0 flex-1 items-center bg-background px-2"
      >
        <div
          className="min-w-0 flex-1 truncate text-center text-muted-foreground"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          {center}
        </div>
        <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>{right}</div>
      </div>
    </div>
  )
}
