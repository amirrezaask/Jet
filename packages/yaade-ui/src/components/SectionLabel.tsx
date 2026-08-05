import { cn } from "../lib/utils.js"

export type SectionLabelProps = {
  children: React.ReactNode
  className?: string
}

/** Uppercase micro eyebrow label (Overseer-style section headers). */
export function SectionLabel({ children, className }: SectionLabelProps) {
  return (
    <p
      className={cn(
        "mb-2 text-3xs font-bold uppercase tracking-[0.09em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  )
}
