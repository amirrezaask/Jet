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
export { SidebarProvider, SidebarInset } from "./components/ui/sidebar.js"
export {
  JetWorkspaceSidebar,
  JetSidebarViewTabs,
  type JetSidebarView,
  type JetWorkspaceSidebarProps,
} from "./shell/JetWorkspaceSidebar.js"
export { focusExplorerPanel } from "./explorer/focus.js"
export { focusTerminalExplorerPanel } from "./terminal-explorer/focus.js"
export { CommandPalette } from "./components/CommandPalette.js"
export { PaletteShell, type PaletteShellItem, type PaletteShellProps } from "./components/palette/PaletteShell.js"
export {
  Lister,
  fuzzyFilter,
  fuzzyScore,
  type ListerDataSource,
  type ListerFilterMode,
  type ListerItemContext,
  type ListerNode,
  type ListerNodeId,
  type ListerProps,
} from "./lister/index.js"
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
  lspLocationsToListItems,
  type LocationListProps,
  type LocationListTabProps,
} from "./panels/location-list/index.js"
export { CdOverlay } from "./components/CdOverlay.js"
export { ProjectSwitcherOverlay } from "./components/ProjectSwitcherOverlay.js"
export { PaletteOverlay } from "./components/PaletteOverlay.js"
export {
  SettingsOverlay,
  type JetAppearanceSettings,
  type JetDensity,
  type JetCursorStyle,
  type JetCursorMotion,
} from "./components/SettingsOverlay.js"
export { StatusBar } from "./status/StatusBar.js"
export { WhichKeyPanel, type WhichKeyEntry } from "./components/WhichKeyPanel.js"
export { setEditorCursor, getEditorCursor } from "./status/editor-cursor-store.js"
export { EditorTabHost, getEditorView, getAllEditorViews, syncAllEditorThemes, destroyEditorBuffer, destroyEditorPanel } from "./tabs/EditorTabHost.js"
export { ExplorerTab } from "./tabs/ExplorerTab.js"
export { AgentChatView } from "./agents/AgentChatView.js"
export { AgentExplorerTab, type AgentExplorerWorkspaceGroup } from "./agents/AgentExplorerTab.js"
export {
  TerminalExplorerTab,
  type TerminalAgentShortcut,
  type TerminalExplorerGroup,
  type TerminalExplorerEntry,
} from "./tabs/TerminalExplorerTab.js"
export { OutputPanel } from "./panels/OutputPanel.js"
export { TerminalPanel } from "./panels/TerminalPanel.js"
export { showEditorContextMenuAt } from "./components/EditorContextMenu.js"
export { createContextMenuHost, dispatchContextMenuAt } from "./components/ContextMenuHost.js"
export { PromptDialog, type PromptDialogProps } from "./components/PromptDialog.js"
export { Text, textVariants, type TextProps } from "./components/Text.js"
export { Surface, surfaceVariants, type SurfaceProps } from "./components/Surface.js"
export {
  bundledThemes,
  bundledThemeList,
  defaultDark,
  defaultLight,
  defaultThemeId,
  defaultThemeIdForScheme,
  getThemeById,
  siblingThemeForScheme,
  themeFamilyForId,
  themePreviewSwatches,
  vercelDark,
  vercelLight,
  themeForScheme,
  type ColorScheme,
} from "./theme/bundled.js"
export { syncNativeChromeFromTheme, readThemedNativeChrome } from "./theme/native-chrome.js"
export { defaultJetTheme, applyJetThemeCss, applyColorScheme } from "@jet/codemirror"
export { jetMotion, jetOverlayContentClass, jetPopoverContentClass, jetPressClass, jetHotGlowClass } from "./motion/tokens.js"
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
export { registerListPanel, getListPanel, getListItems, focusListPanel, focusFirstListItem, getListPanelController, type ListFocusAction, type ListPanelController } from "./lib/list-registry.js"
export { ListRow, type ListRowProps } from "./components/ListRow.js"
export { SettingsField } from "./components/SettingsField.js"
export { FindReplacePopover } from "./components/FindReplacePopover.js"
