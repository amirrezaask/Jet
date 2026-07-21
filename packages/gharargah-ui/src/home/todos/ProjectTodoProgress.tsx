import { cn } from "@/lib/utils.js"

export type ProjectTodoProgressProps = {
  total: number
  done: number
  className?: string
  /** circular | linear — default circular for header density */
  variant?: "circular" | "linear"
}

export function ProjectTodoProgress(props: ProjectTodoProgressProps) {
  const { total, done, className, variant = "circular" } = props
  const ratio = total === 0 ? 0 : done / total
  const pct = Math.round(ratio * 100)

  if (variant === "linear") {
    return (
      <div
        data-gharargah-todo-progress
        data-variant="linear"
        className={cn("h-1 w-full overflow-hidden rounded-full bg-muted/60", className)}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`${done} of ${total} todos complete`}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-[var(--gharargah-motion-fast)] ease-[var(--gharargah-ease-out)] motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
    )
  }

  const size = 14
  const stroke = 2
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - ratio)

  return (
    <svg
      data-gharargah-todo-progress
      data-variant="circular"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0 -rotate-90 text-primary", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={`${done} of ${total} todos complete`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-muted/50"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-[stroke-dashoffset] duration-[var(--gharargah-motion-fast)] ease-[var(--gharargah-ease-out)] motion-reduce:transition-none"
      />
    </svg>
  )
}
