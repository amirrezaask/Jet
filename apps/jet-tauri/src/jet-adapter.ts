import { createHttpTransport, createJetApi, loadTauriTransport } from "@jet/host-client"

export async function bootJetApi(): Promise<void> {
  const tauri = await loadTauriTransport()
  if (tauri) {
    window.jet = createJetApi(tauri)
    return
  }

  const hostUrl = import.meta.env.VITE_JET_HOST_URL as string | undefined
  if (!hostUrl) {
    console.error("[jet-tauri] Tauri transport unavailable and VITE_JET_HOST_URL is not set")
    return
  }
  window.jet = createJetApi(createHttpTransport(hostUrl))
}
