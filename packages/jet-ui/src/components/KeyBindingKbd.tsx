import { Kbd, KbdGroup } from "@/components/ui/kbd.js"
import { cn } from "@/lib/utils.js"

export function KeyBindingKbd({
  binding,
  className,
}: {
  binding: string
  className?: string
}) {
  const parts = binding.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  if (parts.length === 1) {
    return <Kbd className={className}>{parts[0]}</Kbd>
  }
  return (
    <KbdGroup className={cn("gap-0.5", className)}>
      {parts.map((part, index) => (
        <Kbd key={`${part}-${index}`}>{part}</Kbd>
      ))}
    </KbdGroup>
  )
}
