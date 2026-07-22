import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

const appRoot = path.resolve(__dirname, "../../packages/gharargah-app")
const uiRoot = path.resolve(__dirname, "../../packages/gharargah-ui/src")

const browserTargets = ["chrome107", "edge107", "firefox104", "safari16"]

export default defineConfig({
  base: "/",
  define: {
    "import.meta.env.GHARARGAH_ENABLE_AGENT_CHAT": JSON.stringify(process.env.GHARARGAH_ENABLE_AGENT_CHAT ?? "0"),
  },
  build: {
    target: browserTargets,
    cssTarget: browserTargets,
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(appRoot, "index.html"),
      },
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@pierre/diffs")) return "diffs"
            if (id.includes("shiki") || id.includes("@shikijs")) return "shiki"
            if (id.includes("@xterm")) return "xterm"
          }
        },
      },
    },
  },
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", {}]],
      },
    }),
    tailwindcss(),
  ],
  root: appRoot,
  resolve: {
    alias: {
      "@gharargah/ui/styles.css": path.resolve(uiRoot, "styles/globals.css"),
      "@": uiRoot,
    },
  },
  server: {
    port: Number(process.env.JET_WEB_PORT ?? 5174),
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:4747",
      "/health": "http://127.0.0.1:4747",
      "/ws": { target: "ws://127.0.0.1:4747", ws: true },
    },
  },
  clearScreen: false,
})
