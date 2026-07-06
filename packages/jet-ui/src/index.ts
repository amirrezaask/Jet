export { PanelDock, type PanelDockProps, type PanelSlotMeta } from "./dock/PanelDock.js"
export {
  PanelFloatingPopover,
  type PanelFloatingPopoverProps,
  type PanelFloatCorner,
} from "./dock/PanelFloatingPopover.js"
export { PanelBody } from "./dock/PanelBody.js"
export { PanelTabBar, tabIdsOf, type PanelTab } from "./dock/PanelTabBar.js"
export { TabHost } from "./tabs/TabHost.js"
export {
  TabStore,
  TabTypeRegistry,
  type TabInstance,
  type TabType,
  type TabRenderCtx,
} from "./tabs/registry.js"
export { AppShell } from "./shell/AppShell.js"
export { JetTitleBar, type JetTitleBarAction, type JetTitleBarCheckboxAction, type JetTitleBarMenu } from "./shell/JetTitleBar.js"
export { focusExplorerPanel } from "./explorer/focus.js"
export { CommandPalette } from "./components/CommandPalette.js"
export { GotoLineModal } from "./components/GotoLineModal.js"
export { OutlineOverlay, type OutlineEntry } from "./components/OutlineOverlay.js"
export { QuickOpenOverlay } from "./components/QuickOpenOverlay.js"
export { BufferListOverlay } from "./components/BufferListOverlay.js"
export {
  LocationList,
  SearchLocationList,
  ReferencesLocationList,
  DefinitionsLocationList,
  DiagnosticsLocationList,
  TaskErrorsLocationList,
  problemsToListItems,
  searchHitToListItem,
  taskErrorsToListItems,
  lspLocationToListItem,
} from "./panels/location-list/index.js"
export { OpenFileOverlay } from "./components/OpenFileOverlay.js"
export { CdOverlay } from "./components/CdOverlay.js"
export { ProjectSwitcherOverlay } from "./components/ProjectSwitcherOverlay.js"
export { PaletteOverlay } from "./components/PaletteOverlay.js"
export { StatusBar } from "./status/StatusBar.js"
export { WhichKeyPanel, type WhichKeyEntry } from "./components/WhichKeyPanel.js"
export { setEditorCursor, getEditorCursor } from "./status/editor-cursor-store.js"
export { WelcomeView } from "./welcome/WelcomeView.js"
export { EditorTabHost, getEditorView, getAllEditorViews, syncAllEditorThemes, destroyEditorBuffer, destroyEditorPanel } from "./tabs/EditorTabHost.js"
export { ExplorerTab } from "./tabs/ExplorerTab.js"
export { OutputPanel } from "./panels/OutputPanel.js"
export { showEditorContextMenuAt } from "./components/EditorContextMenu.js"
export { bundledThemes, vercelDark, vercelLight, themeForScheme, type ColorScheme } from "./theme/bundled.js"
export { defaultJetTheme, applyJetThemeCss, applyColorScheme } from "@jet/codemirror"
export { jetMotion, jetOverlayContentClass, jetPopoverContentClass, jetPressClass } from "./motion/tokens.js"
export { useReducedMotion } from "./motion/useReducedMotion.js"
export { JetMotionDiv, JetTabDragGhost } from "./motion/JetOverlayMotion.js"
export {
  animateLayoutMorph,
  capturePanelLeafRects,
  type LayoutMorphOptions,
  type PanelRect,
} from "./motion/layoutMorph.js"
export { useJetCaretOverlay, JetCaretInput } from "./motion/useJetCaretOverlay.jsx"
export { cn } from "./lib/utils.js"
export { formatKeyBinding } from "./lib/format-key.js"
export { TooltipProvider } from "./components/ui/tooltip.js"
export { Toaster } from "./components/ui/sonner.js"
export { ConfirmDialogHost, requestConfirm } from "./components/ConfirmDialogHost.js"
export { showJetToast } from "./toast.js"
export { registerListPanel, getListPanel } from "./lib/list-registry.js"
export { ListRow, type ListRowProps } from "./components/ListRow.js"
export { FindReplacePopover } from "./components/FindReplacePopover.js"
