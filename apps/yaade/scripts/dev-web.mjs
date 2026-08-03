#!/usr/bin/env node
import {
  resolveAppDir,
  resolveRepoRoot,
  spawnHostServer,
  spawnVite,
  wireChildLifecycle,
} from "./spawn-backend.mjs"

const appDir = resolveAppDir(import.meta.url)
const repoRoot = resolveRepoRoot(appDir)

const children = [spawnHostServer({ repoRoot }), spawnVite({ appDir })]

wireChildLifecycle(children)
