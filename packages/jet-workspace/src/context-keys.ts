import type { JetKeyBinding } from "./keymaps.js"

export type KeymapContext = {
  editorFocus: boolean
  paletteOpen: boolean
  quickOpenOpen: boolean
  openFileOpen: boolean
  gotoLineOpen: boolean
  workspaceOpen: boolean
  explorerFocus: boolean
  gitFocus: boolean
  terminalFocus: boolean
  searchFocus: boolean
}

export function anyOverlayOpen(ctx: KeymapContext): boolean {
  return ctx.paletteOpen || ctx.quickOpenOpen || ctx.openFileOpen || ctx.gotoLineOpen
}

export function matchesWhen(binding: JetKeyBinding, ctx: KeymapContext): boolean {
  return binding.when?.(ctx) ?? true
}

export function keyEventMatchesBinding(e: KeyboardEvent, key: string): boolean {
  const parts = key.split("-")
  const keyPart = parts[parts.length - 1]!
  const needsMod = parts.includes("Mod")
  const needsShift = parts.includes("Shift")
  const needsAlt = parts.includes("Alt")
  const mod = e.metaKey || e.ctrlKey
  if (needsMod !== mod) return false
  if (needsShift !== e.shiftKey) return false
  if (needsAlt !== e.altKey) return false
  if (keyPart.length === 1) return e.key.toLowerCase() === keyPart.toLowerCase()
  return e.key === keyPart
}
