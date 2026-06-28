import type { Plugin } from "vite"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)))

function defaultAllowedRoots(): string[] {
  const env = process.env.JET_DEV_ROOTS
  if (env) {
    return env.split(path.delimiter).map(p => path.resolve(p))
  }
  return [repoRoot, path.join(repoRoot, "fixtures")].map(p => path.resolve(p))
}

export function jetDevHostPlugin(): Plugin {
  const allowedRoots = defaultAllowedRoots()

  return {
    name: "jet-dev-host",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const { handleJetDevRequest } = await import("@jet/node-host")
          const handled = await handleJetDevRequest(req, res, { allowedRoots })
          if (!handled) next()
        } catch (err) {
          next(err as Error)
        }
      })
    },
  }
}
