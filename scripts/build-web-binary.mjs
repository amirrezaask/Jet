#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import process from "node:process"

const repoRoot = path.resolve(import.meta.dirname, "..")

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run("pnpm", ["--filter", "gharargah", "build"])
// release-max: full LTO for the shipped sidecar; day-to-day --release stays fast.
run("cargo", [
  "build",
  "--profile",
  "release-max",
  "--manifest-path",
  "apps/server/Cargo.toml",
])

const hostTriple = execFileSync("rustc", ["-vV"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\n")
  .find(line => line.startsWith("host: "))
  ?.slice("host: ".length)
if (!hostTriple) {
  throw new Error("Could not determine the Rust host target")
}

const serverBinary = path.join(
  repoRoot,
  "apps/server/target/release-max",
  process.platform === "win32" ? "jet.exe" : "jet",
)
const sidecarDir = path.join(repoRoot, "apps/gharargah/src-tauri/binaries")
const sidecarBinary = path.join(
  sidecarDir,
  process.platform === "win32"
    ? `jet-${hostTriple}.exe`
    : `jet-${hostTriple}`,
)
mkdirSync(sidecarDir, { recursive: true })
copyFileSync(serverBinary, sidecarBinary)

const tauriArgs = ["--filter", "gharargah", "tauri:build"]
if (process.platform === "darwin") {
  const sourceIcon = path.join(repoRoot, "apps/gharargah/app-icon.png")
  const generatedDir = path.join(
    repoRoot,
    "apps/gharargah/src-tauri/generated",
  )
  const iconsetDir = path.join(generatedDir, "Gharargah.iconset")
  rmSync(generatedDir, { force: true, recursive: true })
  mkdirSync(iconsetDir, { recursive: true })
  for (const [name, size] of [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ]) {
    run("sips", [
      "-z",
      String(size),
      String(size),
      sourceIcon,
      "--out",
      path.join(iconsetDir, name),
    ])
  }
  run("iconutil", [
    "-c",
    "icns",
    iconsetDir,
    "--output",
    path.join(generatedDir, "icon.icns"),
  ])
  tauriArgs.push(
    "--config",
    "src-tauri/tauri.macos.conf.json",
    "--bundles",
    "app,dmg",
  )
}
run("pnpm", tauriArgs)

console.log("Jet server executable: apps/server/target/release-max/jet")
console.log("Desktop bundles: apps/gharargah/src-tauri/target/release/bundle")
