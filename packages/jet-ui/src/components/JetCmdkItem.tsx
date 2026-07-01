import { Command as CommandPrimitive, useCommandState } from "cmdk"
import type { ReactNode } from "react"

export function JetCmdkItem({
  value,
  onSelect,
  children,
  className = "",
}: {
  value: string
  onSelect: () => void
  children: ReactNode
  className?: string
}) {
  const selected = useCommandState(state => state.value === value)
  return (
    <CommandPrimitive.Item
      value={value}
      onSelect={onSelect}
      className={`flex cursor-pointer items-center gap-1 rounded-sm px-[14px] py-[3px] text-[length:var(--jet-fs-base)] ${
        selected ? "text-[var(--jet-text)]" : "text-[var(--jet-text-muted)]"
      } ${className}`}
    >
      <span className="w-4 shrink-0 text-center font-bold text-[var(--jet-accent)]" aria-hidden>
        {selected ? "›" : ""}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </CommandPrimitive.Item>
  )
}
