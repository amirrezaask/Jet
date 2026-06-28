import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import electron from "vite-plugin-electron/simple"
import path from "node:path"

const electronOutDir = path.resolve(__dirname, "dist-electron")

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        entry: path.resolve(__dirname, "src/main/main.ts"),
        vite: {
          build: {
            outDir: electronOutDir,
            rollupOptions: {
              external: ["electron", "ws"],
            },
          },
        },
      },
      preload: {
        input: path.resolve(__dirname, "src/preload/preload.ts"),
        vite: {
          build: {
            outDir: electronOutDir,
          },
        },
      },
    }),
  ],
  root: path.resolve(__dirname, "../../packages/jet-app"),
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@jet/ui/styles.css": path.resolve(__dirname, "../../packages/jet-ui/src/styles/globals.css"),
    },
  },
})
