import * as React from "react"
import { cn } from "@/lib/utils.js"

type MessageScrollerProps = {
  className?: string
  children: React.ReactNode
  stickToBottom?: boolean
}

function MessageScroller({ className, children, stickToBottom = true }: MessageScrollerProps) {
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const stickRef = React.useRef(stickToBottom)

  stickRef.current = stickToBottom

  React.useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el || !stickRef.current) return
    el.scrollTop = el.scrollHeight
  }, [children])

  const onScroll = React.useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    stickRef.current = distance < 48
  }, [])

  return (
    <div
      ref={viewportRef}
      data-slot="message-scroller"
      onScroll={onScroll}
      className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden", className)}
    >
      <div data-slot="message-scroller-content" className="flex flex-col gap-3 p-3">
        {children}
      </div>
    </div>
  )
}

function MessageScrollerItem({
  className,
  ...props
}: React.ComponentProps<"div"> & { messageId?: string }) {
  return <div data-slot="message-scroller-item" className={cn("w-full", className)} {...props} />
}

export { MessageScroller, MessageScrollerItem }
