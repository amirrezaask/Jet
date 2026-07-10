import os from "node:os"
import path from "node:path"
import {
  applyLoginShellEnv,
  resolveLaunchTarget,
  type LaunchConfig,
} from "@jet/node-host"
import { startHostHttpServer } from "./http-server.js"
import { sendToRenderer } from "./host-renderer.js"
import { createDefaultSidecarServices, createHostRegistry } from "./register-all.js"
import { stopAllLsp } from "./lsp-bridge.js"
import { stopAllTerminals } from "./terminal.js"
import { stopWorkspaceHost } from "./workspace-host.js"
import { stopAllBackgroundWorkers } from "./background-pool.js"

function parseUserArgs(argv: string[]): string[] {
  const dash = argv.indexOf("--")
  const raw = dash >= 0 ? argv.slice(dash + 1) : argv.slice(2)
  return raw.filter(a => !a.startsWith("-"))
}

function defaultCwd(): string {
  return path.resolve(process.cwd())
}

async function resolveLaunch(userArgs: string[]): Promise<LaunchConfig> {
  if (userArgs.length === 0) {
    return { workspacePath: defaultCwd(), source: "default" }
  }
  const config = await resolveLaunchTarget(userArgs, defaultCwd())
  return { ...config, source: userArgs.length > 0 ? "explicit" : "default" }
}

async function main() {
  applyLoginShellEnv()
  const userArgs = parseUserArgs(process.argv)
  let launchConfig: LaunchConfig | null = await resolveLaunch(userArgs)

  const services = createDefaultSidecarServices(
    {
      async getLaunchConfig() {
        const config = launchConfig
        launchConfig = null
        return config
      },
      deliverLaunch(config) {
        launchConfig = config
        sendToRenderer("jet:launch", config)
      },
    },
    os.homedir(),
  )

  const registry = createHostRegistry(services)
  const server = await startHostHttpServer(registry)

  const ready = `JET_HOST_READY port=${server.port}\n`
  process.stdout.write(ready)

  const shutdown = async () => {
    stopAllLsp()
    stopAllTerminals()
    stopWorkspaceHost()
    stopAllBackgroundWorkers()
    await server.close()
    process.exit(0)
  }

  process.on("SIGINT", () => void shutdown())
  process.on("SIGTERM", () => void shutdown())
}

void main().catch(err => {
  console.error("[jet-host] failed to start:", err)
  process.exit(1)
})
