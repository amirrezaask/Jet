import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react"
import type { JetAppearanceSettings, OutlineEntry, TerminalExplorerGroup, TerminalListEntry } from "@gharargah/ui"
import type { JetProject, WorkspaceFolder, WorkspaceService } from "@gharargah/workspace"

export type OverlayId =
  | "gotoLine"
  | "quickOpen"
  | "bufferList"
  | "terminalList"
  | "openFile"
  | "folderPicker"
  | "switchFolder"
  | "cd"
  | "addWorkspace"
  | "settings"
  | "projectSwitcher"
  | "outline"
  | "palette"

type OverlayState = {
  open: Record<OverlayId, boolean>
  outlineSymbols: OutlineEntry[]
  appearanceSettings: JetAppearanceSettings
  projects: JetProject[]
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

type OverlayAction =
  | { type: "setOpen"; id: OverlayId; open: boolean }
  | { type: "setOutlineSymbols"; symbols: OutlineEntry[] }
  | { type: "setAppearanceSettings"; settings: JetAppearanceSettings }
  | { type: "setProjects"; projects: JetProject[] }
  | { type: "setSearchState"; supported: boolean; scanReady: boolean }
  | { type: "setPaletteCommands"; commands: OverlayState["paletteCommands"] }
  | { type: "setTerminalGroups"; groups: TerminalExplorerGroup[] }

function overlayReducer(state: OverlayState, action: OverlayAction): OverlayState {
  switch (action.type) {
    case "setOpen":
      if (state.open[action.id] === action.open) return state
      return { ...state, open: { ...state.open, [action.id]: action.open } }
    case "setOutlineSymbols":
      return { ...state, outlineSymbols: action.symbols }
    case "setAppearanceSettings":
      return { ...state, appearanceSettings: action.settings }
    case "setProjects":
      return { ...state, projects: action.projects }
    case "setSearchState":
      return { ...state, searchSupported: action.supported, searchScanReady: action.scanReady }
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
  setOutlineSymbols: (symbols: OutlineEntry[]) => void
  setAppearanceSettings: (settings: JetAppearanceSettings) => void
  setProjects: (projects: JetProject[]) => void
  setSearchState: (supported: boolean, scanReady: boolean) => void
  setPaletteCommands: (commands: OverlayState["paletteCommands"]) => void
  setTerminalGroups: (groups: TerminalExplorerGroup[]) => void
}

export type OverlayHandlers = {
  setOverlayOpen: (id: OverlayId, open: boolean) => void
  onAppearanceSettingsChange: (settings: JetAppearanceSettings) => void
  onGotoLineSubmit: (line: number, column: number) => void
  onQuickOpenSearch: (query: string, workspaceId: string | null) => Promise<string[]>
  onQuickOpenSelect: (displayPath: string, query: string, workspaceId: string | null) => void
  onBufferSelect: (uri: string) => void
  onTerminalSelect: (entry: TerminalListEntry) => void
  onOpenFile: (uri: string, path: string) => void
  onRequestOpenFolder: () => void
  onFolderPickerSelect: (folder: WorkspaceFolder) => void
  onSelectFolder: (path: string) => void
  onAddWorkspaceSelect: (path: string) => void
  onResetAppearanceSettings: () => void
  onSelectProject: (path: string) => void
  onOutlineSelect: (line: number) => void
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
  gotoLine: false,
  quickOpen: false,
  bufferList: false,
  terminalList: false,
  openFile: false,
  folderPicker: false,
  switchFolder: false,
  cd: false,
  addWorkspace: false,
  settings: false,
  projectSwitcher: false,
  outline: false,
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
    outlineSymbols: [],
    appearanceSettings: initialAppearanceSettings,
    projects: [],
    searchSupported: false,
    searchScanReady: false,
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

  const setOutlineSymbols = useCallback((symbols: OutlineEntry[]) => {
    dispatch({ type: "setOutlineSymbols", symbols })
  }, [])

  const setAppearanceSettings = useCallback((settings: JetAppearanceSettings) => {
    dispatch({ type: "setAppearanceSettings", settings })
  }, [])

  const setProjects = useCallback((projects: JetProject[]) => {
    dispatch({ type: "setProjects", projects })
  }, [])

  const setSearchState = useCallback((supported: boolean, scanReady: boolean) => {
    dispatch({ type: "setSearchState", supported, scanReady })
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
      setOutlineSymbols,
      setAppearanceSettings,
      setProjects,
      setSearchState,
      setPaletteCommands,
      setTerminalGroups,
    }),
    [
      setOpen,
      isOpen,
      anyOverlayOpen,
      setOutlineSymbols,
      setAppearanceSettings,
      setProjects,
      setSearchState,
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
