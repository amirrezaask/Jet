import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@jet/ui/styles.css"
import { JetApp } from "./App.js"
import { AppErrorBoundary } from "./AppErrorBoundary.js"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <JetApp />
    </AppErrorBoundary>
  </StrictMode>,
)
