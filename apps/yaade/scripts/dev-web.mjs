#!/usr/bin/env node
import {
  DEFAULT_HOST,
  DEFAULT_HOST_PORT,
  DEFAULT_VITE_PORT,
  findAvailablePort,
  resolveAppDir,
  resolveRepoRoot,
  spawnHostServer,
  spawnVite,
  wireChildLifecycle,
} from "./spawn-backend.mjs"

const appDir = resolveAppDir(import.meta.url)
const repoRoot = resolveRepoRoot(appDir)
const host = process.env.JET_HOST ?? DEFAULT_HOST
const preferredHostPort = Number(process.env.JET_PORT ?? DEFAULT_HOST_PORT)
const preferredVitePort = Number(process.env.JET_WEB_PORT ?? DEFAULT_VITE_PORT)

const hostPort = await findAvailablePort(host, preferredHostPort)
const vitePort = await findAvailablePort(host, preferredVitePort)

if (hostPort !== preferredHostPort) {
  console.warn(
    `[dev-web] host port ${preferredHostPort} busy → using ${hostPort}`,
  )
}
if (vitePort !== preferredVitePort) {
  console.warn(
    `[dev-web] vite port ${preferredVitePort} busy → using ${vitePort}`,
  )
}

const env = {
  ...process.env,
  JET_HOST: host,
  JET_PORT: String(hostPort),
  JET_WEB_PORT: String(vitePort),
}

const children = [
  spawnHostServer({ repoRoot, host, port: hostPort, env }),
  spawnVite({ appDir, port: vitePort, env }),
]

wireChildLifecycle(children)
