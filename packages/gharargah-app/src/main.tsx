import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RegistryProvider } from "@effect-atom/atom-react"
import "@gharargah/ui/styles.css"
import { GharargahApp } from "./App.js"
import { AppErrorBoundary } from "./AppErrorBoundary.js"
import { createGharargahApi, createWebTransport, HostClient, HostClientLive } from "@gharargah/host-client"
import { Layer } from "effect"

const startupWindow = window as Window & { __gharargahStartupBootstrapAt?: number }
startupWindow.__gharargahStartupBootstrapAt ??= performance.now()

const transport = createWebTransport()
/** Promise shim over Effect HostClient — kept for Electron / legacy call sites. */
window.gharargah = createGharargahApi(transport)

/** Effect HostClient layer available for atom runtimes / future command paths. */
;(window as Window & { __gharargahHostClientLive?: Layer.Layer<HostClient> }).__gharargahHostClientLive =
  HostClientLive(transport)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RegistryProvider>
      <AppErrorBoundary>
        <GharargahApp />
      </AppErrorBoundary>
    </RegistryProvider>
  </StrictMode>,
)
