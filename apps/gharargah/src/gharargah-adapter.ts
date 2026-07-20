import { createGharargahApi, loadTauriTransport } from "@gharargah/host-client"

export async function bootGharargahApi(): Promise<void> {
  const tauri = await loadTauriTransport()
  if (!tauri) {
    console.error("[gharargah] Tauri transport unavailable")
    return
  }
  window.gharargah = createGharargahApi(tauri)
}
