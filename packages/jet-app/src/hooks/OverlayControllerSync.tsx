import { useEffect } from "react"
import { useOverlayController, type OverlayId } from "./OverlayController.js"
import type { JetAppearanceSettings, OutlineEntry } from "@jet/ui"
import type { JetProject } from "@jet/workspace"

type SyncProps = {
  open: Record<OverlayId, boolean>
  appearanceSettings: JetAppearanceSettings
  projects: JetProject[]
  outlineSymbols: OutlineEntry[]
  searchSupported: boolean
  searchScanReady: boolean
  paletteCommands: Array<{
    id: string
    title: string
    category?: string
    keybinding?: string
    aliases?: string[]
    recent?: boolean
  }>
}

export function OverlayControllerSync({
  open,
  appearanceSettings,
  projects,
  outlineSymbols,
  searchSupported,
  searchScanReady,
  paletteCommands,
}: SyncProps) {
  const { actions } = useOverlayController()

  useEffect(() => {
    for (const [id, value] of Object.entries(open) as [OverlayId, boolean][]) {
      actions.setOpen(id, value)
    }
  }, [open, actions])

  useEffect(() => {
    actions.setAppearanceSettings(appearanceSettings)
  }, [appearanceSettings, actions])

  useEffect(() => {
    actions.setProjects(projects)
  }, [projects, actions])

  useEffect(() => {
    actions.setOutlineSymbols(outlineSymbols)
  }, [outlineSymbols, actions])

  useEffect(() => {
    actions.setSearchState(searchSupported, searchScanReady)
  }, [searchSupported, searchScanReady, actions])

  useEffect(() => {
    actions.setPaletteCommands(paletteCommands)
  }, [paletteCommands, actions])

  return null
}
