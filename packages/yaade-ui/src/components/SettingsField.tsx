import type { ReactNode } from "react"

export function SettingsField({
  label,
  detail,
  children,
  htmlFor,
}: {
  label: string
  detail?: string
  children: ReactNode
  htmlFor?: string
}) {
  const Label = htmlFor ? "label" : "div"

  return (
    <div
      className="grid items-start gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(10rem,13rem)_minmax(14rem,1fr)] sm:gap-6"
      data-yaade-settings-field=""
    >
      <div className="min-w-0">
        <Label
          className="text-sm font-medium leading-snug text-foreground"
          htmlFor={htmlFor}
        >
          {label}
        </Label>
        {detail ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {detail}
          </p>
        ) : null}
      </div>
      <div className="min-w-0 sm:justify-self-stretch sm:pt-0.5">
        {children}
      </div>
    </div>
  )
}
