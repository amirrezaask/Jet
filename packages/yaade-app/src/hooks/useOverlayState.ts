import { useCallback, useMemo, useReducer } from "react"
import type { OverlayId } from "./OverlayController.js"

type OverlayOpenState = Record<OverlayId, boolean>

const INITIAL: OverlayOpenState = {
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
  palette: false,
}

type Action = { type: "set"; id: OverlayId; open: boolean }

function reducer(state: OverlayOpenState, action: Action): OverlayOpenState {
  if (state[action.id] === action.open) return state
  return { ...state, [action.id]: action.open }
}

export function useOverlayState() {
  const [open, dispatch] = useReducer(reducer, INITIAL)

  const setOpen = useCallback((id: OverlayId, value: boolean) => {
    dispatch({ type: "set", id, open: value })
  }, [])

  const setters = useMemo(
    () => ({
      setGotoLineOpen: (v: boolean) => setOpen("gotoLine", v),
      setQuickOpenOpen: (v: boolean) => setOpen("quickOpen", v),
      setBufferListOpen: (v: boolean) => setOpen("bufferList", v),
      setTerminalListOpen: (v: boolean) => setOpen("terminalList", v),
      setOpenFileOpen: (v: boolean) => setOpen("openFile", v),
      setFolderPickerOpen: (v: boolean) => setOpen("folderPicker", v),
      setSwitchFolderOpen: (v: boolean) => setOpen("switchFolder", v),
      setCdOpen: (v: boolean) => setOpen("cd", v),
      setAddWorkspaceOpen: (v: boolean) => setOpen("addWorkspace", v),
      setSettingsOpen: (v: boolean) => setOpen("settings", v),
      setProjectSwitcherOpen: (v: boolean) => setOpen("projectSwitcher", v),
      setPaletteOpen: (v: boolean) => setOpen("palette", v),
    }),
    [setOpen],
  )

  const anyOpen = useCallback(() => Object.values(open).some(Boolean), [open])

  return {
    open,
    setOpen,
    anyOpen,
    ...setters,
    paletteOpen: open.palette,
    gotoLineOpen: open.gotoLine,
    quickOpenOpen: open.quickOpen,
    bufferListOpen: open.bufferList,
    terminalListOpen: open.terminalList,
    openFileOpen: open.openFile,
    folderPickerOpen: open.folderPicker,
    switchFolderOpen: open.switchFolder,
    cdOpen: open.cd,
    addWorkspaceOpen: open.addWorkspace,
    settingsOpen: open.settings,
    projectSwitcherOpen: open.projectSwitcher,
  }
}
