import { PromptDialog } from "./PromptDialog.js"

const GOTO_LINE_RE = /^(\d+)(?::(\d+))?$/

export function GotoLineModal({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (line: number, column: number) => void
}) {
  return (
    <PromptDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Go to Line"
      description="Enter a line number or line:column."
      placeholder="Line or line:column"
      hint="Example: 42 or 42:10"
      inputId="goto-line-input"
      labelText="Line"
      validate={raw => {
        const match = GOTO_LINE_RE.exec(raw)
        if (!match) return false
        return Number.parseInt(match[1]!, 10) >= 1
      }}
      onSubmit={raw => {
        const match = GOTO_LINE_RE.exec(raw)
        if (!match) return
        const line = Number.parseInt(match[1]!, 10)
        const column = match[2] ? Number.parseInt(match[2], 10) : 1
        onSubmit(line, column)
      }}
    />
  )
}
