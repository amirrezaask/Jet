import type { ReactNode } from "react"

export function SettingsField({
  label,
  detail,
  children,
}: {
  label: string
  detail?: string
  children: ReactNode
}) {
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[minmax(10rem,14rem)_minmax(14rem,1fr)] sm:gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {detail ? <div className="mt-1 text-3xs text-muted-foreground">{detail}</div> : null}
      </div>
      <div className="min-w-0 sm:justify-self-stretch">{children}</div>
    </div>
  )
}
