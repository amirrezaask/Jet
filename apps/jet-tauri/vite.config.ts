import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

const appRoot = path.resolve(__dirname, "../../packages/jet-app")
const uiRoot = path.resolve(__dirname, "../../packages/jet-ui/src")

// WKWebView on macOS 12+ ≈ Safari 15 — match Athas (instant-feel target, smaller parse cost).
const webviewTargets = ["chrome96", "edge96", "firefox94", "safari15"]

export default defineConfig({
  base: "./",
  define: {
    "import.meta.env.JET_ENABLE_AGENT_CHAT": JSON.stringify(process.env.JET_ENABLE_AGENT_CHAT ?? "0"),
  },
  build: {
    target: webviewTargets,
    cssTarget: webviewTargets,
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(appRoot, "index.tauri.html"),
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
    {
      name: "jet-tauri-bootstrap-entry",
      transformIndexHtml(html: string) {
        return html.replace(
          '<script type="module" src="/src/main.tsx"></script>',
          '<script type="module" src="/@tauri-bootstrap"></script>',
        )
      },
    },
  ],
  root: appRoot,
  resolve: {
    alias: {
      "/@tauri-bootstrap": path.resolve(__dirname, "src/bootstrap.ts"),
      "@jet/ui/styles.css": path.resolve(uiRoot, "styles/globals.css"),
      "@": uiRoot,
    },
  },
  server: {
    port: Number(process.env.JET_TAURI_DEV_PORT ?? 5174),
    strictPort: true,
    host: process.env.TAURI_DEV_HOST ?? "127.0.0.1",
    hmr: process.env.TAURI_DEV_HOST
      ? {
          protocol: "ws",
          host: process.env.TAURI_DEV_HOST,
          port: Number(process.env.JET_TAURI_DEV_PORT ?? 5174) + 1,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  clearScreen: false,
})
