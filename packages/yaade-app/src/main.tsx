import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RegistryProvider } from "@effect-atom/atom-react"
import "@yaade/ui/styles.css"
import { YaadeApp } from "./App.js"
import { AppErrorBoundary } from "./AppErrorBoundary.js"
import { createYaadeApi, createWebTransport, HostClient, HostClientLive } from "@yaade/host-client"
import { Layer } from "effect"
import { installAgentSessionTitleBridge } from "./agent-session-title-bridge.js"

const startupWindow = window as Window & { __yaadeStartupBootstrapAt?: number }
startupWindow.__yaadeStartupBootstrapAt ??= performance.now()

const transport = createWebTransport()
/** Promise shim over Effect HostClient — kept for Electron / legacy call sites. */
window.yaade = createYaadeApi(transport)
installAgentSessionTitleBridge()

/** Effect HostClient layer available for atom runtimes / future command paths. */
;(window as Window & { __yaadeHostClientLive?: Layer.Layer<HostClient> }).__yaadeHostClientLive =
  HostClientLive(transport)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RegistryProvider>
      <AppErrorBoundary>
        <YaadeApp />
      </AppErrorBoundary>
    </RegistryProvider>
  </StrictMode>,
)
