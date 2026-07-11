import { ensureTauriE2eBuild, restoreTauriE2eConf } from "../shell/launch-tauri.js"

export default async function globalSetup(): Promise<void> {
  const argv = process.argv.join(" ")
  if (argv.includes("tauri-e2e") || process.env.JET_SHELL === "tauri") {
    process.env.JET_SHELL = "tauri"
    ensureTauriE2eBuild()
  }
}
