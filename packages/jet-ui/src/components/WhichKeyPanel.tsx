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
    <div className="border-t border-[var(--jet-border)] bg-[var(--jet-panel)] px-4 pb-[11px] pt-[9px]">
      <div
        className="mb-[9px] text-[length:var(--jet-fs-2xs)] uppercase tracking-[0.13em] opacity-45"
        style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
      >
        {prefix} — prefix command
      </div>
      <div className="flex flex-wrap gap-x-[30px] gap-y-[7px]">
        {entries.map((entry, i) => (
          <div key={i} className="flex min-w-[158px] items-baseline gap-[10px]">
            <span className="min-w-[34px] text-right font-semibold text-[var(--jet-accent)]">
              {entry.key}
            </span>
            <span className="text-[length:var(--jet-fs-base)] opacity-85">{entry.desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
