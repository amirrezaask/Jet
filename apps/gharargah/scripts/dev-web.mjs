#!/usr/bin/env node
import {
  resolveAppDir,
  resolveRepoRoot,
  spawnAgentServer,
  spawnHostServer,
  spawnVite,
  wireChildLifecycle,
} from "./spawn-backend.mjs"

const appDir = resolveAppDir(import.meta.url)
const repoRoot = resolveRepoRoot(appDir)

const children = [spawnHostServer({ repoRoot })]
if ((process.env.GHARARGAH_ENABLE_AGENT_CHAT ?? "1") === "1") {
  children.push(spawnAgentServer({ repoRoot }))
}
children.push(spawnVite({ appDir }))

wireChildLifecycle(children)
