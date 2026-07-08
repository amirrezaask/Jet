import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@jet/ui/styles.css"
import { JetApp } from "./App.js"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <JetApp />
  </StrictMode>,
)
