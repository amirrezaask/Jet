import { cn } from "@/lib/utils.js"
import {
  sessionStatusLabel,
  type SessionCardStatus,
} from "./session-card-model.js"

export type StatusBadgeProps = {
  status: SessionCardStatus
  className?: string
}

export function StatusBadge(props: StatusBadgeProps) {
  const { status, className } = props
  return (
    <span
      data-gharargah-status-badge
      data-status={status}
      className={cn("gharargah-home-status-badge", className)}
    >
      {sessionStatusLabel(status)}
    </span>
  )
}
