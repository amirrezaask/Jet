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
  sidebarChrome,
}: {
  center?: ReactNode
  right?: ReactNode
  sidebarOpen: boolean
  sidebarWidth: string
  sidebarChrome?: ReactNode
}) {
  return (
    <div
      data-jet-titlebar
      data-tauri-drag-region
      className="flex min-h-[var(--jet-titlebar-height)] shrink-0 text-xs select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div
        data-jet-titlebar-sidebar
        data-sidebar-open={sidebarOpen || undefined}
        data-tauri-drag-region="deep"
        className="flex shrink-0 items-stretch border-r border-sidebar-border bg-sidebar pr-2"
        style={{
          width: sidebarOpen ? sidebarWidth : "var(--jet-traffic-light-inset)",
          WebkitAppRegion: "drag",
        } as React.CSSProperties}
      >
        {/* Traffic-light clearance: full-height drag + dbl-click maximize (Electron
            -webkit-app-region; Tauri data-tauri-drag-region — bare attr is self-only). */}
        <div
          aria-hidden
          data-jet-traffic-light-spacer
          data-tauri-drag-region="true"
          className="shrink-0 self-stretch"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />
        {sidebarOpen && sidebarChrome ? (
          <div
            className="flex min-w-0 flex-1 items-center pl-1"
            data-tauri-drag-region="false"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            {sidebarChrome}
          </div>
        ) : null}
      </div>
      <div
        data-jet-titlebar-main
        className="flex min-w-0 flex-1 items-center border-b border-border bg-background px-2"
      >
        <div
          data-tauri-drag-region
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
