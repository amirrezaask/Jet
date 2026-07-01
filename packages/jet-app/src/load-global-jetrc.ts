import type { JetKeyBinding } from "@jet/workspace"

/** Context passed to `~/.jet/jetrc.ts` at app startup. */
export type JetGlobalContext = {
  projects: {
    setScanRoots(roots: string[]): void
  }
  addKeybindings(bindings: JetKeyBinding[]): void
  showMessage(message: string): void
}

export type LoadGlobalJetrcOptions = {
  homeDir: string
  fetchScanRoots?: () => Promise<string[]>
  onKeybindings?: (bindings: JetKeyBinding[]) => void
  showMessage?: (message: string) => void
}

export async function loadGlobalJetrc(
  registry: { setScanRoots(roots: string[]): void },
  opts: LoadGlobalJetrcOptions,
): Promise<void> {
  let roots: string[] = []
  if (opts.fetchScanRoots) {
    try {
      roots = await opts.fetchScanRoots()
    } catch (e) {
      console.warn("Failed to load global jetrc:", e)
    }
  }
  if (roots.length > 0) registry.setScanRoots(roots)
}
