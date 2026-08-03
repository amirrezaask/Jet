const PROJECT_NAME_PARTS = /[\p{L}\p{N}]+/gu

function firstCharacter(value: string): string {
  const upper = value.toUpperCase()
  return Array.from(upper)[0] ?? ""
}

/**
 * Return a compact, stable project identity for the collapsed sidebar rail.
 * Multi-part names use their first two initials; single-part names use one.
 */
export function projectMonogram(projectName: string): string {
  const parts = projectName.normalize("NFKC").match(PROJECT_NAME_PARTS) ?? []
  if (parts.length === 0) return "P"

  const initials =
    parts.length === 1
      ? firstCharacter(parts[0]!)
      : `${firstCharacter(parts[0]!)}${firstCharacter(parts[1]!)}`

  return initials || "P"
}
