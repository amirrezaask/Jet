import { useEffect, useRef, type ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"
import { Label } from "@/components/ui/label.js"
import { JetCaretInput } from "@/motion/useJetCaretOverlay.js"

export interface PromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  placeholder?: string
  hint?: ReactNode
  inputId?: string
  labelText?: string
  onSubmit: (value: string) => void
  validate?: (value: string) => boolean
}

export function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  hint,
  inputId = "jet-prompt-input",
  labelText = title,
  onSubmit,
  validate,
}: PromptDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const handleSubmit = () => {
    const raw = inputRef.current?.value.trim() ?? ""
    if (!raw) return
    if (validate && !validate(raw)) return
    onSubmit(raw)
    onOpenChange(false)
    if (inputRef.current) inputRef.current.value = ""
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={inputId} className="sr-only">
            {labelText}
          </Label>
          <JetCaretInput
            id={inputId}
            ref={inputRef}
            placeholder={placeholder}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleSubmit()
              }
            }}
          />
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
