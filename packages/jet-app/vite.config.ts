import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

export default defineConfig({
  define: {
    "import.meta.env.JET_ENABLE_AGENT_CHAT": JSON.stringify(process.env.JET_ENABLE_AGENT_CHAT ?? "0"),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@jet/ui/styles.css": path.resolve(__dirname, "../jet-ui/src/styles/globals.css"),
      "@": path.resolve(__dirname, "../jet-ui/src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@pierre/diffs") || id.includes("shiki")) return "git-diff"
          if (id.includes("@xterm")) return "xterm"
        },
      },
    },
  },
})
