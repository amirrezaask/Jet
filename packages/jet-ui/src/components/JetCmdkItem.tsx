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
      className={`cursor-pointer rounded-sm px-3 py-2 text-sm ${className}`}
      style={selected ? { background: "var(--jet-hover)" } : undefined}
    >
      {children}
    </CommandPrimitive.Item>
  )
}
