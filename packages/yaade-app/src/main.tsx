import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@yaade/ui/styles.css"
import { AppRoot } from "./AppRoot.js"
import { AppErrorBoundary } from "./AppErrorBoundary.js"
import { createYaadeApi, createWebTransport } from "@yaade/host-client"
import { applyInitialAppearance } from "./hooks/useAppearanceSettings.js"

const startupWindow = window as Window & { __yaadeStartupBootstrapAt?: number }
startupWindow.__yaadeStartupBootstrapAt ??= performance.now()
applyInitialAppearance()

const transport = createWebTransport()
/** Promise shim over Effect HostClient — kept for Electron / legacy call sites. */
window.yaade = createYaadeApi(transport)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AppRoot />
    </AppErrorBoundary>
  </StrictMode>,
)
