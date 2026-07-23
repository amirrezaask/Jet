import type { AgentPlan } from "@gharargah/agents"
import { Check, Circle, Loader2, X } from "lucide-react"

const statusIcon = {
  pending: Circle,
  in_progress: Loader2,
  completed: Check,
  failed: X,
} as const

export function PlanCard(props: { plan: AgentPlan }) {
  return (
    <section className="rounded-lg border border-border bg-card p-3" data-gharargah-plan="">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">Plan</h3>
      <ol className="space-y-1.5">
        {props.plan.entries.map(entry => {
          const Icon = statusIcon[entry.status]
          return <li key={entry.id} className="flex items-center gap-2 text-sm"><Icon className={entry.status === "in_progress" ? "size-3.5 animate-spin" : "size-3.5"} /><span>{entry.label}</span></li>
        })}
      </ol>
    </section>
  )
}
