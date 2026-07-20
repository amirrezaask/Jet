import { ensureTauriE2eBuild } from "../shell/launch-tauri.js"

export default async function globalSetup(): Promise<void> {
  const argv = process.argv.join(" ")
  if (argv.includes("tauri-e2e") || process.env.GHARARGAH_SHELL === "tauri") {
    process.env.GHARARGAH_SHELL = "tauri"
    ensureTauriE2eBuild()
  }
}
