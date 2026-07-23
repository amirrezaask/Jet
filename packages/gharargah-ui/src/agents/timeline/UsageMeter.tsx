import type { AgentUsage } from "@gharargah/agents"

export function UsageMeter(props: { usage: AgentUsage; compact?: boolean }) {
  const { usage, compact = false } = props
  const percent = usage.limit && usage.limit > 0 ? Math.min(100, (usage.used / usage.limit) * 100) : null
  const label = usage.limit ? `${usage.used}/${usage.limit}` : `${usage.used}`
  return (
    <div className={compact ? "flex items-center gap-1.5 text-3xs text-muted-foreground" : "space-y-1 text-xs text-muted-foreground"}>
      <span>{label}{usage.unit ? ` ${usage.unit}` : ""}</span>
      {percent !== null ? <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary" style={{ width: `${percent}%` }} /></span> : null}
    </div>
  )
}
