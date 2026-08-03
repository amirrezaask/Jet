import { KeyBindingKbd } from "@/components/KeyBindingKbd.js"

export type WhichKeyEntry = {
  key: string
  desc: string
}

export function WhichKeyPanel({
  prefix,
  entries,
}: {
  prefix: string
  entries: WhichKeyEntry[]
}) {
  return (
    <div className="border-t border-border bg-muted px-4 py-2.5">
      <div className="mb-2 flex items-baseline gap-2 text-xs text-foreground">
        <KeyBindingKbd binding={prefix} />
        <span className="text-muted-foreground">— waiting for key</span>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {entries.map((entry, i) => (
          <div key={i} className="flex min-w-[148px] items-baseline gap-2">
            <KeyBindingKbd binding={entry.key} className="min-w-[2.5rem] justify-center" />
            <span className="text-sm text-muted-foreground">{entry.desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
