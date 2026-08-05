/**
 * Resolve which folder/file Electron should pass to the host as launch workspace.
 * Kept separate from main.mjs so unit tests do not boot Electron.
 */
import os from "node:os"
import path from "node:path"

/**
 * Optional folder/file path after flags → host-server launch config.
 * Packaged Electron argv often includes the asar/app path — never treat that
 * as a user workspace (it sits outside $HOME and trips PATH_OUTSIDE_ALLOWED_ROOTS).
 */
export function launchPathFromArgv(argv, opts = {}) {
  const pkgDir = opts.packageDir
  const skip = new Set(["--dev"])
  for (const arg of argv.slice(1)) {
    if (arg.startsWith("-")) {
      if (skip.has(arg)) continue
      continue
    }
    // Skip electron binary path and the app entry (package dir / main.mjs).
    if (arg === ".") continue
    if (pkgDir && arg === pkgDir) continue
    if (arg.endsWith("main.mjs") || arg.includes(`${path.sep}electron`)) continue
    if (arg.endsWith(".asar") || arg.includes(`${path.sep}app.asar`)) continue
    if (arg.includes(`${path.sep}Resources${path.sep}`) && /yaade/i.test(arg)) continue
    if (path.isAbsolute(arg) || arg.includes("/") || arg.includes("\\")) {
      return path.resolve(arg)
    }
  }
  return undefined
}

/** Default host workspace when Electron did not get an explicit folder/file. */
export function defaultHostLaunchPath(runtimeRoot) {
  if (runtimeRoot) return os.homedir()
  return undefined
}
