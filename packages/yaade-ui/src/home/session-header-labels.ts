function cleanSessionHeaderLabel(value: string | null | undefined): string {
  return value?.trim() ?? ""
}

/**
 * Normalize labels only for comparison. Rendered labels keep their original
 * spelling so a project name or user-customized terminal title is not rewritten.
 */
export function normalizeSessionHeaderLabel(
  value: string | null | undefined,
): string {
  return cleanSessionHeaderLabel(value)
    .normalize("NFKC")
    .replace(/[\u2010-\u2015]/gu, "-")
    .replace(/\s+/gu, " ")
    .toLowerCase()
}

export function sessionHeaderLabelsMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const normalizedLeft = normalizeSessionHeaderLabel(left)
  return (
    normalizedLeft.length > 0 &&
    normalizedLeft === normalizeSessionHeaderLabel(right)
  )
}

/** Format the visible `project / context` title without repeating a label. */
export function formatSessionHeaderTitle(
  projectName: string | null | undefined,
  contextLabel: string | null | undefined,
): string {
  const project = cleanSessionHeaderLabel(projectName)
  const context = cleanSessionHeaderLabel(contextLabel)

  if (!project) return context
  if (!context || sessionHeaderLabelsMatch(project, context)) return project
  return `${project} / ${context}`
}

/** Return secondary metadata only when it adds information to the title. */
export function distinctSessionHeaderLabel(
  primary: string | null | undefined,
  secondary: string | null | undefined,
): string | null {
  const cleanSecondary = cleanSessionHeaderLabel(secondary)
  if (
    !cleanSecondary ||
    sessionHeaderLabelsMatch(primary, cleanSecondary)
  ) {
    return null
  }
  return cleanSecondary
}
