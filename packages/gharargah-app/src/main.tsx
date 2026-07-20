import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@gharargah/ui/styles.css"
import { GharargahApp } from "./App.js"
import { AppErrorBoundary } from "./AppErrorBoundary.js"

const startupWindow = window as Window & { __gharargahStartupBootstrapAt?: number }
startupWindow.__gharargahStartupBootstrapAt ??= performance.now()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <GharargahApp />
    </AppErrorBoundary>
  </StrictMode>,
)
