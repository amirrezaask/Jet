import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils.js"

export type GharargahTitleBarProps = {
  showWindowChrome?: boolean
  crumb?: string | null
  trailing?: ReactNode
  className?: string
}

export function GharargahTitleBar(props: GharargahTitleBarProps) {
  const { showWindowChrome, crumb, trailing, className } = props
  return (
    <header
      data-gharargah-titlebar
      className={cn(
        "flex h-[var(--gharargah-window-chrome-height)] shrink-0 items-center gap-2 border-b border-border bg-background px-2",
        className,
      )}
      style={
        showWindowChrome
          ? ({ paddingLeft: "var(--gharargah-traffic-light-inset)" } as CSSProperties)
          : undefined
      }
    >
      {crumb ? (
        <span className="min-w-0 truncate text-xs text-muted-foreground">{crumb}</span>
      ) : null}
      {trailing ? <div className="ml-auto flex items-center gap-1">{trailing}</div> : null}
    </header>
  )
}
