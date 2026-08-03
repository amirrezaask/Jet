import type { CSSProperties } from "react"
import { cn } from "@/lib/utils.js"

export type DesktopWindowPlatform = "darwin" | "win32" | "linux"

export type YaadeWindowTitlebarProps = {
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
export function YaadeWindowTitlebar({
  platform,
  title,
  sidebar = null,
}: YaadeWindowTitlebarProps) {
  const hasTrafficLights = platform === "darwin"
  // Match floating sidebar container border-box (padding is inside width).
  const floatingCollapsedWidth =
    "calc(var(--sidebar-width-icon, 3rem) + 1rem + 2px)"
  const sidebarWidth = sidebar
    ? sidebar.collapsed
      ? hasTrafficLights
        ? `max(var(--yaade-traffic-light-inset), ${floatingCollapsedWidth})`
        : floatingCollapsedWidth
      : `${sidebar.width}px`
    : null

  return (
    <header
      aria-label="Application titlebar"
      data-yaade-titlebar=""
      data-yaade-titlebar-platform={platform}
      data-yaade-titlebar-sidebar={
        sidebar ? (sidebar.collapsed ? "collapsed" : "expanded") : "none"
      }
      data-yaade-liquid-glass="chrome"
      className="relative z-20 flex h-[var(--yaade-window-chrome-height)] min-h-[var(--yaade-window-chrome-height)] w-full shrink-0 select-none items-stretch border-b border-transparent bg-transparent text-foreground"
      style={dragRegion}
    >
      {sidebar ? (
        <div
          data-yaade-titlebar-sidebar-segment=""
          className={cn(
            "flex shrink-0 items-center border-r border-transparent bg-transparent text-sidebar-foreground",
            sidebar.collapsed && "justify-start",
          )}
          style={{ ...dragRegion, width: sidebarWidth ?? undefined }}
        >
          {hasTrafficLights ? (
            <div
              aria-hidden
              data-yaade-traffic-light-spacer=""
              style={dragRegion}
            />
          ) : null}
        </div>
      ) : hasTrafficLights ? (
        <div
          aria-hidden
          data-yaade-traffic-light-spacer=""
          style={dragRegion}
        />
      ) : null}

      <div
        className="relative flex min-w-0 flex-1 items-center justify-center px-3"
        style={dragRegion}
      >
        {!sidebar ? (
          <span className="absolute left-3 truncate text-xs font-semibold tracking-tight text-muted-foreground">
            YAADE
          </span>
        ) : null}
        <span
          data-yaade-titlebar-title=""
          className="max-w-[60%] truncate text-3xs font-medium text-muted-foreground"
        >
          {title}
        </span>
      </div>

      {platform !== "darwin" ? (
        <div
          aria-hidden
          data-yaade-window-controls-spacer=""
          className="w-[calc(100vw-env(titlebar-area-width,100vw)-env(titlebar-area-x,0px))] min-w-[8.5rem] shrink-0"
          style={dragRegion}
        />
      ) : null}
    </header>
  )
}
