import type { CSSProperties } from "react"
import { cn } from "@/lib/utils.js"

export type DesktopWindowPlatform = "darwin" | "win32" | "linux"

export type GharargahWindowTitlebarProps = {
  platform: DesktopWindowPlatform
  title: string
  sidebar?: {
    collapsed: boolean
    width: number
  } | null
}

const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties

/**
 * Renderer-owned Electron chrome. On macOS the native traffic lights remain,
 * while the titlebar surface and its draggable area belong to the app.
 */
export function GharargahWindowTitlebar({
  platform,
  title,
  sidebar = null,
}: GharargahWindowTitlebarProps) {
  const hasTrafficLights = platform === "darwin"
  const sidebarWidth = sidebar
    ? sidebar.collapsed
      ? hasTrafficLights
        ? "var(--gharargah-traffic-light-inset)"
        : "3rem"
      : `${sidebar.width}px`
    : null

  return (
    <header
      aria-label="Application titlebar"
      data-gharargah-titlebar=""
      data-gharargah-titlebar-platform={platform}
      data-gharargah-titlebar-sidebar={
        sidebar ? (sidebar.collapsed ? "collapsed" : "expanded") : "none"
      }
      className="relative z-20 flex h-[var(--gharargah-window-chrome-height)] min-h-[var(--gharargah-window-chrome-height)] w-full shrink-0 select-none items-stretch border-b border-border/70 bg-background text-foreground"
      style={dragRegion}
    >
      {sidebar ? (
        <div
          data-gharargah-titlebar-sidebar-segment=""
          className={cn(
            "flex shrink-0 items-center border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-[var(--gharargah-motion-panel)] ease-[var(--gharargah-ease-drawer)]",
            sidebar.collapsed && "justify-start",
          )}
          style={{ ...dragRegion, width: sidebarWidth ?? undefined }}
        >
          {hasTrafficLights ? (
            <div
              aria-hidden
              data-gharargah-traffic-light-spacer=""
              style={dragRegion}
            />
          ) : null}
        </div>
      ) : hasTrafficLights ? (
        <div
          aria-hidden
          data-gharargah-traffic-light-spacer=""
          style={dragRegion}
        />
      ) : null}

      <div
        className="relative flex min-w-0 flex-1 items-center justify-center px-3"
        style={dragRegion}
      >
        {!sidebar ? (
          <span className="absolute left-3 truncate text-xs font-semibold tracking-tight text-muted-foreground">
            Gharargah
          </span>
        ) : null}
        <span
          data-gharargah-titlebar-title=""
          className="max-w-[60%] truncate text-3xs font-medium text-muted-foreground"
        >
          {title}
        </span>
      </div>

      {platform !== "darwin" ? (
        <div
          aria-hidden
          data-gharargah-window-controls-spacer=""
          className="w-[calc(100vw-env(titlebar-area-width,100vw)-env(titlebar-area-x,0px))] min-w-[8.5rem] shrink-0"
          style={dragRegion}
        />
      ) : null}
    </header>
  )
}
