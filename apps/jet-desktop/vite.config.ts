import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import electron from "vite-plugin-electron/simple"
import path from "node:path"

const electronOutDir = path.resolve(__dirname, "dist-electron")
const repoRoot = path.resolve(__dirname, "../..")

function forwardDevArgs(): string[] {
  const fromEnv = process.env.JET_LAUNCH_ARGS
  if (fromEnv) {
    try {
      const parsed = JSON.parse(fromEnv) as unknown
      if (Array.isArray(parsed)) {
        return parsed.filter((a): a is string => typeof a === "string" && !a.startsWith("-"))
      }
    } catch {
      /* fall through */
    }
  }
  const dash = process.argv.indexOf("--")
  const raw = dash >= 0 ? process.argv.slice(dash + 1) : process.argv.slice(2)
  return raw.filter(a => !a.startsWith("-"))
}

function resolveLaunchArgs(extra: string[]): string[] {
  return extra.map(arg => path.resolve(repoRoot, arg))
}

/**
 * Strip Vite's `crossorigin` attribute from bundled <script> / <link>.
 * Packaged Electron loads index.html via file:// — the CORS mode triggered
 * by crossorigin blocks the CSS and its @font-face URLs, so Geist never
 * loads and shadcn tokens miss their custom-property references. The dev
 * server serves over HTTP with CORS headers, so dev looks fine and only
 * release ships broken chrome.
 */
function stripCrossoriginFromHtml() {
  return {
    name: "jet-strip-crossorigin",
    transformIndexHtml(html: string) {
      return html.replace(/\s+crossorigin/g, "")
    },
  }
}

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", {}]],
      },
    }),
    tailwindcss(),
    stripCrossoriginFromHtml(),
    electron({
      main: {
        entry: path.resolve(__dirname, "src/main/main.ts"),
        onstart({ startup }) {
          const extra = forwardDevArgs()
          const argv = [".", "--no-sandbox"]
          if (extra.length > 0) argv.push("--", ...resolveLaunchArgs(extra))
          startup(argv)
        },
        vite: {
          build: {
            outDir: electronOutDir,
            rollupOptions: {
              external: ["electron", "ws", "node-pty", "@ff-labs/fff-node"],
              input: {
                main: path.resolve(__dirname, "src/main/main.ts"),
                "workers/fs-io": path.resolve(__dirname, "src/main/workers/fs-io.ts"),
                "workers/git-ops": path.resolve(__dirname, "src/main/workers/git-ops.ts"),
                "workers/search-ops": path.resolve(__dirname, "src/main/workers/search-ops.ts"),
                "workers/fs-watch": path.resolve(__dirname, "src/main/workers/fs-watch.ts"),
              },
              output: {
                entryFileNames: chunk => (chunk.name === "main" ? "main.js" : `${chunk.name}.js`),
              },
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
      "@": path.resolve(__dirname, "../../packages/jet-ui/src"),
    },
  },
})
