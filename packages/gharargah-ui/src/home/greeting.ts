export function timeOfDayGreeting(now = new Date()): "Good morning" | "Good afternoon" | "Good evening" {
  const hour = now.getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

export function formatHomeDate(now = new Date()): string {
  return now
    .toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    .toUpperCase()
}
