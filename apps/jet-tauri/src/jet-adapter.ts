import { createJetApi, loadTauriTransport } from "@jet/host-client"

export async function bootJetApi(): Promise<void> {
  const tauri = await loadTauriTransport()
  if (!tauri) {
    console.error("[jet-tauri] Tauri transport unavailable")
    return
  }
  window.jet = createJetApi(tauri)
}
