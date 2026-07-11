import { restoreTauriE2eConf } from "../shell/launch-tauri.js"

export default async function globalTeardown(): Promise<void> {
  restoreTauriE2eConf()
}
