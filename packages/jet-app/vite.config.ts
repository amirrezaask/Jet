import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@jet/ui/styles.css": path.resolve(__dirname, "../jet-ui/src/styles/globals.css"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
})
