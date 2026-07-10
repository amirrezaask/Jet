import { getFsWorker } from "./background-pool.js"
import type { HostRegistry } from "./registry.js"
import type { HostServices } from "./services.js"

export function registerFsHandlers(registry: HostRegistry, services: HostServices): void {
  registry.handle("fs:readFile", async args =>
    getFsWorker().dispatch<string>("readFile", { uri: args[0] }),
  )

  registry.handle("fs:writeFile", async args => {
    await getFsWorker().dispatch<void>("writeFile", { uri: args[0], content: args[1] })
  })

  registry.handle("fs:readDir", async args => getFsWorker().dispatch("readDir", { uri: args[0] }))

  registry.handle("fs:stat", async args => getFsWorker().dispatch("stat", { uri: args[0] }))

  registry.handle("fs:showOpenFolderDialog", async () => services.dialog.showOpenFolderDialog())

  registry.handle("fs:showSaveFileDialog", async args =>
    services.dialog.showSaveFileDialog(args[0] as string | undefined),
  )
}
