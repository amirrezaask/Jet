import type { MouseEvent, ReactElement } from "react"
import { cloneElement } from "react"
import { Plus } from "lucide-react"
import { Button } from "../components/ui/button.js"
import { formatKeyBinding } from "@/lib/format-key.js"
import { cn } from "@/lib/utils.js"

export type NewSessionButtonProps = {
  rootUri: string
  onNewSession: (rootUri: string) => void
  /** Replace default Plus icon trigger (e.g. empty-state dashed card). */
  trigger?: ReactElement<{ onClick?: (e: MouseEvent) => void; title?: string }>
  className?: string
}

const NEW_SESSION_HINT = `New session (${formatKeyBinding("Mod-n")})`

export function NewSessionButton(props: NewSessionButtonProps) {
  const { rootUri, onNewSession, trigger, className } = props

  const startSession = (e: MouseEvent) => {
    e.stopPropagation()
    onNewSession(rootUri)
  }

  if (trigger) {
    return cloneElement(trigger, {
      title: trigger.props.title ?? NEW_SESSION_HINT,
      onClick: (e: MouseEvent) => {
        trigger.props.onClick?.(e)
        startSession(e)
      },
    })
  }

  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      data-yaade-new-session
      className={cn("shrink-0", className)}
      title={NEW_SESSION_HINT}
      aria-label="New session"
      onClick={startSession}
    >
      <Plus className="size-3.5" />
    </Button>
  )
}
