import { spawn } from "node:child_process"
import type { JetTaskSpawnRequest } from "@jet/workspace"
import type { HostRegistry } from "./registry.js"

export function registerTaskHandlers(registry: HostRegistry): void {
  registry.handle("tasks:spawn", async args => {
    const req = args[0] as JetTaskSpawnRequest
    return new Promise<{ exitCode: number; output: string }>(resolve => {
      let output = ""
      const child = spawn(req.command, req.args, {
        cwd: req.cwd,
        shell: process.platform === "win32",
        env: process.env,
      })
      const append = (chunk: Buffer) => {
        output += chunk.toString()
      }
      child.stdout.on("data", append)
      child.stderr.on("data", append)
      child.on("close", code => resolve({ exitCode: code ?? 1, output }))
      child.on("error", err => resolve({ exitCode: 1, output: `${output}\n${err.message}` }))
    })
  })
}
