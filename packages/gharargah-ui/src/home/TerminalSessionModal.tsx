import type { ReactNode } from "react"
import { GitBranch, XIcon } from "lucide-react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"
import { Button } from "@/components/ui/button.js"

export type TerminalSessionModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  gitBranch?: string | null
  children: ReactNode
}

export function TerminalSessionModal(props: TerminalSessionModalProps) {
  const { open, onOpenChange, title, gitBranch, children } = props
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="stage"
        showCloseButton={false}
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
        <DialogHeader className="flex shrink-0 flex-row items-center gap-3 border-b border-border px-4 py-3 text-left sm:text-left">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-medium">{title}</DialogTitle>
            {gitBranch ? (
              <p
                data-gharargah-terminal-git-branch
                className="mt-0.5 flex items-center gap-1 truncate font-mono text-3xs text-muted-foreground"
              >
                <GitBranch className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{gitBranch}</span>
              </p>
            ) : null}
          </div>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-gharargah-terminal-modal-close
              aria-label="Close terminal"
              className="shrink-0"
            >
              <XIcon className="size-4" />
            </Button>
          </DialogClose>
        </DialogHeader>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
