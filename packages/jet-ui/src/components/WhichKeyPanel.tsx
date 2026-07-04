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
    <div className="border-t border-border bg-[var(--jet-surface-inset)] px-4 py-2.5">
      <div className="mb-2 jet-mono-data text-[length:var(--jet-fs-2xs)] text-[var(--jet-phosphor)]">
        {prefix}
        <span className="text-muted-foreground"> — waiting for key</span>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {entries.map((entry, i) => (
          <div key={i} className="flex min-w-[148px] items-baseline gap-2">
            <span className="jet-kbd-chip min-w-[2.5rem] justify-center">{entry.key}</span>
            <span className="text-[length:var(--jet-fs-sm)] text-muted-foreground">{entry.desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
