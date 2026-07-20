import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react"
import type { JetAppearanceSettings, TerminalExplorerGroup, TerminalListEntry } from "@gharargah/ui"
import type { JetProject, WorkspaceFolder, WorkspaceService } from "@gharargah/workspace"

export type OverlayId =
  | "terminalList"
  | "folderPicker"
  | "switchFolder"
  | "cd"
  | "addWorkspace"
  | "settings"
  | "projectSwitcher"
  | "palette"

type OverlayState = {
  open: Record<OverlayId, boolean>
  appearanceSettings: JetAppearanceSettings
  projects: JetProject[]
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

type OverlayAction =
  | { type: "setOpen"; id: OverlayId; open: boolean }
  | { type: "setAppearanceSettings"; settings: JetAppearanceSettings }
  | { type: "setProjects"; projects: JetProject[] }
  | { type: "setPaletteCommands"; commands: OverlayState["paletteCommands"] }
  | { type: "setTerminalGroups"; groups: TerminalExplorerGroup[] }

function overlayReducer(state: OverlayState, action: OverlayAction): OverlayState {
  switch (action.type) {
    case "setOpen":
      if (state.open[action.id] === action.open) return state
      return { ...state, open: { ...state.open, [action.id]: action.open } }
    case "setAppearanceSettings":
      return { ...state, appearanceSettings: action.settings }
    case "setProjects":
      return { ...state, projects: action.projects }
    case "setPaletteCommands":
      return { ...state, paletteCommands: action.commands }
    case "setTerminalGroups":
      return { ...state, terminalGroups: action.groups }
    default:
      return state
  }
}

export type OverlayActions = {
  setOpen: (id: OverlayId, open: boolean) => void
  isOpen: (id: OverlayId) => boolean
  anyOverlayOpen: () => boolean
  setAppearanceSettings: (settings: JetAppearanceSettings) => void
  setProjects: (projects: JetProject[]) => void
  setPaletteCommands: (commands: OverlayState["paletteCommands"]) => void
  setTerminalGroups: (groups: TerminalExplorerGroup[]) => void
}

export type OverlayHandlers = {
  setOverlayOpen: (id: OverlayId, open: boolean) => void
  onAppearanceSettingsChange: (settings: JetAppearanceSettings) => void
  onTerminalSelect: (entry: TerminalListEntry) => void
  onRequestOpenFolder: () => void
  onFolderPickerSelect: (folder: WorkspaceFolder) => void
  onSelectFolder: (path: string) => void
  onAddWorkspaceSelect: (path: string) => void
  onResetAppearanceSettings: () => void
  onSelectProject: (path: string) => void
  onRunCommand: (id: string) => void
  onFolderPickerOpenChange: (open: boolean) => void
  resolveHomeDir: () => Promise<string>
}

type OverlayControllerValue = {
  state: OverlayState
  actions: OverlayActions
  workspace: WorkspaceService
  handlers: OverlayHandlers
}

const OverlayControllerContext = createContext<OverlayControllerValue | null>(null)

export function useOverlayController(): OverlayControllerValue {
  const ctx = useContext(OverlayControllerContext)
  if (!ctx) throw new Error("useOverlayController must be used within OverlayControllerProvider")
  return ctx
}

const DEFAULT_OPEN: Record<OverlayId, boolean> = {
  terminalList: false,
  folderPicker: false,
  switchFolder: false,
  cd: false,
  addWorkspace: false,
  settings: false,
  projectSwitcher: false,
  palette: false,
}

export function OverlayControllerProvider({
  children,
  initialAppearanceSettings,
  workspace,
  handlers,
}: {
  children: ReactNode
  initialAppearanceSettings: JetAppearanceSettings
  workspace: WorkspaceService
  handlers: OverlayHandlers
}) {
  const [state, dispatch] = useReducer(overlayReducer, {
    open: DEFAULT_OPEN,
    appearanceSettings: initialAppearanceSettings,
    projects: [],
    paletteCommands: [],
    terminalGroups: [],
  })

  const setOpen = useCallback((id: OverlayId, open: boolean) => {
    dispatch({ type: "setOpen", id, open })
  }, [])

  const isOpen = useCallback((id: OverlayId) => state.open[id], [state.open])

  const anyOverlayOpen = useCallback(
    () => Object.values(state.open).some(Boolean),
    [state.open],
  )

  const setAppearanceSettings = useCallback((settings: JetAppearanceSettings) => {
    dispatch({ type: "setAppearanceSettings", settings })
  }, [])

  const setProjects = useCallback((projects: JetProject[]) => {
    dispatch({ type: "setProjects", projects })
  }, [])

  const setPaletteCommands = useCallback((commands: OverlayState["paletteCommands"]) => {
    dispatch({ type: "setPaletteCommands", commands })
  }, [])

  const setTerminalGroups = useCallback((groups: TerminalExplorerGroup[]) => {
    dispatch({ type: "setTerminalGroups", groups })
  }, [])

  const actions = useMemo(
    (): OverlayActions => ({
      setOpen,
      isOpen,
      anyOverlayOpen,
      setAppearanceSettings,
      setProjects,
      setPaletteCommands,
      setTerminalGroups,
    }),
    [
      setOpen,
      isOpen,
      anyOverlayOpen,
      setAppearanceSettings,
      setProjects,
      setPaletteCommands,
      setTerminalGroups,
    ],
  )

  const value = useMemo(
    (): OverlayControllerValue => ({ state, actions, workspace, handlers }),
    [state, actions, workspace, handlers],
  )

  return (
    <OverlayControllerContext.Provider value={value}>{children}</OverlayControllerContext.Provider>
  )
}

/** Convenience accessors for overlay open flags used by keymap context. */
export function useOverlayOpenFlags() {
  const { state } = useOverlayController()
  return state.open
}

export type { OverlayState }
