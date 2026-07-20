import { useEffect } from "react"
import { useOverlayController, type OverlayId } from "./OverlayController.js"
import type { JetAppearanceSettings, OutlineEntry, TerminalExplorerGroup } from "@gharargah/ui"
import type { JetProject } from "@gharargah/workspace"

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
  terminalGroups: TerminalExplorerGroup[]
}

export function OverlayControllerSync({
  open,
  appearanceSettings,
  projects,
  outlineSymbols,
  searchSupported,
  searchScanReady,
  paletteCommands,
  terminalGroups,
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

  useEffect(() => {
    actions.setTerminalGroups(terminalGroups)
  }, [terminalGroups, actions])

  return null
}
