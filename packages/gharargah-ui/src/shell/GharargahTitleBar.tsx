import type { CSSProperties, ReactNode } from "react"
import { Home } from "lucide-react"
import { Button } from "@/components/ui/button.js"
import { cn } from "@/lib/utils.js"

export type GharargahTitleBarProps = {
  showWindowChrome?: boolean
  crumb?: string | null
  onHome: () => void
  trailing?: ReactNode
  className?: string
}

export function GharargahTitleBar(props: GharargahTitleBarProps) {
  const { showWindowChrome, crumb, onHome, trailing, className } = props
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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-gharargah-home-button
        className="gap-1.5 text-xs"
        onClick={onHome}
        aria-label="Home"
      >
        <Home className="size-3.5" />
        Home
      </Button>
      <span className="text-xs font-semibold tracking-[0.12em] text-foreground uppercase">Gharargah</span>
      {crumb ? (
        <>
          <span className="text-muted-foreground">/</span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">{crumb}</span>
        </>
      ) : null}
      {trailing ? <div className="ml-auto flex items-center gap-1">{trailing}</div> : null}
    </header>
  )
}
