#!/usr/bin/env node
import { loadConfig } from "./config.js"
import { startHostServer } from "./server.js"

const config = await loadConfig()
const { close } = await startHostServer(config)

const stop = async () => {
  await close()
  process.exit(0)
}
process.on("SIGINT", () => void stop())
process.on("SIGTERM", () => void stop())
