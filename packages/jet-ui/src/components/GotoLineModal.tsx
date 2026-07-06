import { useEffect, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"
import { Label } from "@/components/ui/label.js"
import { JetCaretInput } from "@/motion/useJetCaretOverlay.js"

export function GotoLineModal({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (line: number, column: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const handleSubmit = () => {
    const raw = inputRef.current?.value.trim() ?? ""
    if (!raw) return
    const match = /^(\d+)(?::(\d+))?$/.exec(raw)
    if (!match) return
    const line = Number.parseInt(match[1]!, 10)
    const column = match[2] ? Number.parseInt(match[2], 10) : 1
    if (line < 1) return
    onSubmit(line, column)
    onOpenChange(false)
    if (inputRef.current) inputRef.current.value = ""
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Go to Line</DialogTitle>
          <DialogDescription>Enter a line number or line:column.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="goto-line-input" className="sr-only">
            Line
          </Label>
          <JetCaretInput
            id="goto-line-input"
            ref={inputRef}
            placeholder="Line or line:column"
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleSubmit()
              }
            }}
          />
          <p className="text-xs text-muted-foreground">Example: 42 or 42:10</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
