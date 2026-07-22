import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button.js"
import { Input } from "@/components/ui/input.js"
import { cn } from "@/lib/utils.js"

export type ProjectTodoComposerProps = {
  open: boolean
  onCancel: () => void
  onSubmit: (input: { text: string }) => void
  className?: string
  submitLabel?: string
}

/**
 * Uncontrolled text field — commit reads the live DOM value so
 * automation (and IME) cannot leave React state empty while the input shows text.
 */
export function ProjectTodoComposer(props: ProjectTodoComposerProps) {
  const { open, onCancel, onSubmit, className, submitLabel = "Add todo" } = props
  const inputRef = useRef<HTMLInputElement>(null)
  // Remount when opened so the field clears.
  const fieldKey = open ? "open" : "closed"

  useEffect(() => {
    if (!open) return
    const id = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(id)
  }, [open])

  if (!open) return null

  const readText = () => (inputRef.current?.value ?? "").trim()

  const commit = () => {
    const next = readText()
    if (!next) return false
    onSubmit({ text: next })
    if (inputRef.current) inputRef.current.value = ""
    return true
  }

  const onFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    e.stopPropagation()
    commit()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      e.stopPropagation()
      commit()
    }
  }

  return (
    <form
      data-gharargah-todo-composer
      className={cn(
        "flex flex-col gap-2 rounded-md border bg-card p-2.5",
        className,
      )}
      onSubmit={onFormSubmit}
    >
      <Input
        key={fieldKey}
        ref={inputRef}
        name="text"
        defaultValue=""
        onKeyDown={onKeyDown}
        placeholder="What needs doing?"
        aria-label="Todo"
        data-gharargah-todo-composer-text
        className="h-8 text-xs"
        autoComplete="off"
      />
      <div className="flex items-center justify-end gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-3xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 px-2 text-3xs"
          data-gharargah-todo-composer-submit
          onClick={e => {
            e.preventDefault()
            e.stopPropagation()
            commit()
          }}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
