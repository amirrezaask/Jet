import type { ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"

export type TerminalSessionModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
}

export function TerminalSessionModal(props: TerminalSessionModalProps) {
  const { open, onOpenChange, title, children } = props
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="stage"
        showCloseButton
        data-gharargah-terminal-modal
        className="flex flex-col"
        aria-describedby={undefined}
        onOpenAutoFocus={event => {
          // Prefer focusing the terminal surface, not dialog chrome.
          event.preventDefault()
          requestAnimationFrame(() => {
            document
              .querySelector<HTMLElement>(
                "[data-gharargah-terminal-modal] [data-gharargah-terminal-panel] .xterm-helper-textarea",
              )
              ?.focus()
          })
        }}
      >
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-12 text-left">
          <DialogTitle className="truncate text-sm font-medium">{title}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
