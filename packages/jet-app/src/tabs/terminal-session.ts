const ptyByTabId = new Map<string, string>()
const cwdByTabId = new Map<string, string>()
const launchCommandByTabId = new Map<string, string>()

export function registerTerminalSession(
  tabId: string,
  cwdRootUri: string,
  launchCommand?: string,
): void {
  cwdByTabId.set(tabId, cwdRootUri)
  if (launchCommand) launchCommandByTabId.set(tabId, launchCommand)
}

export function terminalCwdForTab(tabId: string): string {
  return cwdByTabId.get(tabId) ?? ""
}

export function terminalLaunchCommandForTab(tabId: string): string | undefined {
  return launchCommandByTabId.get(tabId)
}

export function trackTerminalPtyId(tabId: string, ptyId: string | null): void {
  if (ptyId) ptyByTabId.set(tabId, ptyId)
  else ptyByTabId.delete(tabId)
}

export function terminalPtyIdForTab(tabId: string): string | undefined {
  return ptyByTabId.get(tabId)
}

export function clearTerminalSession(tabId: string): void {
  ptyByTabId.delete(tabId)
  cwdByTabId.delete(tabId)
  launchCommandByTabId.delete(tabId)
}
