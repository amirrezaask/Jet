import { createHttpTransport, createJetApi } from "@jet/host-client"

const hostUrl = import.meta.env.VITE_JET_HOST_URL as string | undefined
if (!hostUrl) {
  console.error("[jet-tauri] VITE_JET_HOST_URL is not set — window.jet will be unavailable")
} else {
  window.jet = createJetApi(createHttpTransport(hostUrl))
}
