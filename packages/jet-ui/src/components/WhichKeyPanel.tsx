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
    <div className="border-t border-border bg-muted px-4 py-2">
      <div className="mb-2 text-xs text-muted-foreground">{prefix} — prefix command</div>
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        {entries.map((entry, i) => (
          <div key={i} className="flex min-w-[158px] items-baseline gap-2">
            <span className="min-w-[34px] text-right font-mono text-sm font-medium text-foreground">
              {entry.key}
            </span>
            <span className="text-sm text-muted-foreground">{entry.desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
