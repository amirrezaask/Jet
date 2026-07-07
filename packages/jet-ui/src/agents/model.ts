import type { ProviderDriverKind } from "./t3contracts.js"

export type SelectableModelOption = {
  slug: string
  name: string
}

export function resolveSelectableModel(
  _provider: ProviderDriverKind,
  value: string | null | undefined,
  options: ReadonlyArray<SelectableModelOption>,
): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const direct = options.find(option => option.slug === trimmed)
  if (direct) return direct.slug
  const byName = options.find(option => option.name.toLowerCase() === trimmed.toLowerCase())
  if (byName) return byName.slug
  return null
}
