import { loadGlobalJetrcScanRoots } from "@jet/node-host"
import { registerAgentHandlers } from "./agents.js"
import { prewarmBackgroundWorkers } from "./background-pool.js"
import { registerFsHandlers } from "./fs.js"
import { registerGitHandlers } from "./git.js"
import { registerLspHandlers } from "./lsp-bridge.js"
import { registerPerfHandlers } from "./perf.js"
import { registerSearchHandlers } from "./search.js"
import { registerTaskHandlers } from "./tasks.js"
import { registerTerminalHandlers } from "./terminal.js"
import { registerWorkspaceHost } from "./workspace-host.js"
import { HostRegistry } from "./registry.js"
import type { HostServices } from "./services.js"

export function createHostRegistry(services: HostServices): HostRegistry {
  const registry = new HostRegistry()
  registerFsHandlers(registry, services)
  registerGitHandlers(registry)
  registerAgentHandlers(registry)
  registerWorkspaceHost(registry)
  registerSearchHandlers(registry)
  registerLspHandlers(registry)
  registerPerfHandlers(registry)
  registerTaskHandlers(registry)
  registerTerminalHandlers(registry)

  registry.handle("jet:getLaunchConfig", async () => services.launch.getLaunchConfig())
  registry.handle("jet:getHomeDir", async () => services.getHomeDir())
  registry.handle("jet:loadGlobalJetrcScanRoots", async () => services.loadGlobalJetrcScanRoots())
  registry.handle("ui:syncNativeChrome", async args => {
    await services.nativeChrome.syncNativeChrome(
      args[0] as { background: string; foreground: string },
    )
  })

  prewarmBackgroundWorkers()
  return registry
}

export function createDefaultSidecarServices(
  launch: HostServices["launch"],
  homeDir: string,
): HostServices {
  return {
    dialog: {
      showOpenFolderDialog: async () => null,
      showSaveFileDialog: async () => null,
    },
    nativeChrome: {
      syncNativeChrome: async () => {},
    },
    launch,
    getHomeDir: () => homeDir,
    loadGlobalJetrcScanRoots: () => loadGlobalJetrcScanRoots(homeDir),
  }
}
