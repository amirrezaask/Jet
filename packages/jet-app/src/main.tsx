import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserJetAPI } from "@jet/browser"
import "@jet/ui/styles.css"
import { JetApp } from "./App.js"

if (!window.jet && import.meta.env.VITE_JET_WEB) {
  window.jet = createBrowserJetAPI()
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <JetApp />
  </StrictMode>,
)
