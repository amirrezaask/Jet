import fs from "node:fs/promises"
import path from "node:path"
import { stat } from "./fs.js"
import { pathToUri } from "./paths.js"

export type LaunchConfig = {
  workspacePath: string
  filePath?: string
  source?: "default" | "explicit" | "external"
}

export const WORKSPACE_MARKERS = [
  ".git",
  "package.json",
  "tsconfig.json",
  "Cargo.toml",
  "go.mod",
  ".jet",
] as const

async function markerExists(dir: string, marker: string): Promise<boolean> {
  const uri = pathToUri(path.join(dir, marker))
  try {
    const info = await stat(uri)
    if (marker === ".git") return info.isDirectory
    return !info.isDirectory
  } catch {
    return false
  }
}

export async function findWorkspaceRoot(startDir: string): Promise<string> {
  let current = path.resolve(startDir)
  for (let i = 0; i < 20; i++) {
    for (const marker of WORKSPACE_MARKERS) {
      if (await markerExists(current, marker)) return current
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return path.resolve(startDir)
}

export async function resolveLaunchTarget(
  userArgs: string[],
  cwd: string,
): Promise<LaunchConfig> {
  const resolvedCwd = path.resolve(cwd)
  const positional = userArgs.filter(a => !a.startsWith("-"))

  let targetPath: string
  if (positional.length === 0) {
    targetPath = resolvedCwd
  } else {
    targetPath = path.resolve(resolvedCwd, positional[0]!)
  }

  try {
    const info = await fs.stat(targetPath)
    if (info.isDirectory()) {
      return { workspacePath: targetPath }
    }
    const parentDir = path.dirname(targetPath)
    const workspacePath = await findWorkspaceRoot(parentDir)
    return { workspacePath, filePath: targetPath }
  } catch {
    return { workspacePath: resolvedCwd }
  }
}
