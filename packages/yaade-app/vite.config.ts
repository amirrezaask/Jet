import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@yaade/ui/styles.css": path.resolve(__dirname, "../yaade-ui/src/styles/globals.css"),
      "@": path.resolve(__dirname, "../yaade-ui/src"),
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
