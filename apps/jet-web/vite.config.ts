import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { jetDevHostPlugin } from "./vite-plugin-jet-dev-host.js"

const appRoot = path.resolve(fileURLToPath(new URL("../../packages/jet-app", import.meta.url)))

export default defineConfig({
  plugins: [react(), tailwindcss(), jetDevHostPlugin()],
  root: appRoot,
  envDir: appRoot,
  define: {
    "import.meta.env.VITE_JET_WEB": JSON.stringify("1"),
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@jet/ui/styles.css": path.resolve(appRoot, "../jet-ui/src/styles/globals.css"),
    },
  },
  build: {
    outDir: path.resolve(fileURLToPath(new URL(".", import.meta.url)), "dist"),
    emptyOutDir: true,
  },
})
